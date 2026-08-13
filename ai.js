// פענוח צילומי מסך דרך Gemini — קריאה ישירה מהדפדפן, בלי שרת באמצע.
//
// אבטחה:
//  · המפתח נשלח בכותרת x-goog-api-key ולא ב-URL. מפתח ב-query string דולף
//    ליומני שרת, להיסטוריית דפדפן ולכותרת Referer.
//  · המפתח נשמר מוצפן ב-IndexedDB ומפוענח רק לרגע הקריאה.
//  · הפלט של המודל הוא קלט לא-מהימן: הוא נחתך, מנורמל ומאומת לפני שנוגעים בו.

import * as DB from './db.js';
import { flatForPrompt } from './taxonomy.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const authHeaders = (key) => ({ 'x-goog-api-key': key });

/* ==================== בחירת מודל ==================== */

// ניקוד גבוה = עדיף. בוחר לבד כדי שהאפליקציה לא תישבר כשגוגל מוציאה מודל משימוש.
function scoreModel(name) {
  const n = name.replace('models/', '');
  if (!/gemini/.test(n)) return -1;
  if (/embedding|aqa|imagen|veo|tts|native-audio|image-generation/.test(n)) return -1;
  let s = 0;
  if (/flash/.test(n)) s += 100;
  if (/lite/.test(n)) s += 10;
  if (/pro/.test(n)) s += 40;
  const ver = n.match(/gemini-(\d+)\.(\d+)/);
  if (ver) s += parseInt(ver[1]) * 10 + parseInt(ver[2]);
  if (/preview|exp/.test(n)) s -= 25;
  if (/thinking/.test(n)) s -= 15;
  return s;
}

export async function listModels(key) {
  const res = await fetch(`${BASE}/models?pageSize=200`, {
    headers: authHeaders(key), referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name)
    .filter(n => scoreModel(n) > 0)
    .sort((a, b) => scoreModel(b) - scoreModel(a));
}

export async function resolveModel(key, { force = false } = {}) {
  const saved = await DB.setting('geminiModel');
  if (saved && !force) return saved;
  const models = await listModels(key);
  if (!models.length) throw new Error('לא נמצא מודל זמין למפתח הזה');
  await DB.setSetting('geminiModel', models[0]);
  await DB.setSetting('geminiModelOptions', models.slice(0, 12));
  return models[0];
}

async function apiError(res) {
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
  if (res.status === 400 && /API key/i.test(msg)) return new Error('מפתח ה-API לא תקין');
  if (res.status === 401) return new Error('המפתח נדחה. בדוק שהוא הועתק במלואו');
  if (res.status === 403) return new Error('המפתח נדחה (403). בדוק שה-API מופעל בפרויקט');
  if (res.status === 429) return new Error('חרגת ממכסת השכבה החינמית. נסה שוב בעוד דקה');
  if (res.status >= 500) return new Error('שגיאת שרת אצל גוגל. נסה שוב');
  return new Error(msg || `שגיאה ${res.status}`);
}

/* ==================== הכנת התמונה ==================== */

const MAX_UPLOAD = 8 * 1024 * 1024;

export async function shrink(blob, maxSide = 1600, quality = 0.85) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  return out || blob;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/* ==================== הסכימה שהמודל מחויב להחזיר ==================== */

const SCHEMA = {
  type: 'object',
  properties: {
    docType: { type: 'string', enum: ['credit_statement', 'bank_statement', 'app_receipt', 'single_receipt', 'wallet', 'other'] },
    account: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dateBuy: { type: 'string' }, dateCharge: { type: 'string' },
          merchant: { type: 'string' }, amount: { type: 'number' },
          currency: { type: 'string', enum: ['ILS', 'USD', 'EUR', 'GBP', 'OTHER'] },
          dept: { type: 'string' }, cat: { type: 'string' },
          kind: { type: 'string', enum: ['fixed', 'variable', 'oneoff'] },
          need: { type: 'string', enum: ['essential', 'discretionary'] },
          scope: { type: 'string', enum: ['personal', 'business'] },
          method: { type: 'string', enum: ['cash', 'credit', 'bank', 'bit', 'other'] },
          installmentN: { type: 'integer' }, installmentOf: { type: 'integer' },
          isIncome: { type: 'boolean' }, confidence: { type: 'number' }, raw: { type: 'string' },
        },
        required: ['merchant', 'amount', 'dept', 'cat'],
      },
    },
  },
  required: ['items'],
};

function buildPrompt(today) {
  return `אתה מנוע חילוץ נתונים פיננסיים. לפניך צילום מסך ישראלי — דף פירוט אשראי,
תנועות בנק, קבלה, או מסך אפליקציה (ביט/פייבוקס/ארנק דיגיטלי).

חלץ **כל** שורת תנועה שנראית בתמונה. אל תמציא שורות ואל תשמיט שורות.
התאריך היום הוא ${today}.

כללים מחייבים:
1. amount — תמיד מספר חיובי, בלי סימן מטבע ובלי פסיקים. אם השורה זיכוי/החזר,
   סמן isIncome=true והשאר את amount חיובי.
2. dateBuy — תאריך הקנייה בפורמט YYYY-MM-DD. אם מופיע רק יום+חודש, השלם את
   השנה ההגיונית ביחס להיום. אם אין תאריך כלל, השאר ריק.
3. dateCharge — רק אם הוא מופיע בנפרד מתאריך הקנייה (נפוץ בדפי אשראי).
4. תשלומים — "3 מתוך 12" → installmentN=3, installmentOf=12, ו-amount הוא
   סכום התשלום החודשי בלבד ולא סכום העסקה המלא.
5. dept ו-cat — בדיוק מהרשימה למטה. אם לא ברור, בחר general של המחלקה הסבירה.
6. ביט, פייבוקס, העברה לאדם, משיכת מזומן והעברה בין חשבונות הן **לא הוצאה** —
   סווג ל-transfer/*.
7. משכורת, זיכוי ורווחי מסחר → income/*, עם isIncome=true.
8. confidence — 0 עד 1. ציון נמוך לשורה שקשה לקרוא או שהסיווג שלה מנחש.
9. raw — העתק מדויק של הטקסט המקורי של השורה.
10. merchant — שם נקי, בלי מספרי אסמכתא, בלי בע״מ, בלי מספרי סניף.

קטגוריות מותרות (dept/cat):
${flatForPrompt()}`;
}

/* ==================== הקריאה ==================== */

export async function parseImage(blob, { signal } = {}) {
  const key = await DB.getSecret('geminiKey');
  if (!key) throw new Error('לא הוגדר מפתח Gemini. עבור להגדרות');
  const model = await resolveModel(key);
  const small = await shrink(blob);
  if (small.size > MAX_UPLOAD) throw new Error('התמונה גדולה מדי גם אחרי הקטנה');
  const b64 = await blobToBase64(small);
  const today = new Date().toISOString().slice(0, 10);

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
        { text: buildPrompt(today) },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };

  const res = await fetch(`${BASE}/${model.replace(/^models\//, 'models/')}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(key) },
    body: JSON.stringify(body),
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!res.ok) throw await apiError(res);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
    throw new Error(reason ? `המודל לא החזיר תוצאה (${reason})` : 'המודל לא החזיר תוצאה');
  }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('התשובה מהמודל לא הייתה JSON תקין'); }

  return {
    docType: SAFE_DOC.has(parsed.docType) ? parsed.docType : 'other',
    account: clean(parsed.account, 40),
    items: Array.isArray(parsed.items)
      ? parsed.items.slice(0, MAX_ITEMS).map(sanitizeItem).filter(Boolean)
      : [],
    model,
  };
}

export async function testKey(key) {
  const models = await listModels(key);
  return models[0] || null;
}

/* ==================== שאילתה בשפה חופשית ==================== */

/**
 * "כמה הוצאתי על אוכל החודש?" — שאלה + סיכומים מצטברים נשלחים למודל.
 * נשלחים סיכומים בלבד, לא תנועות בודדות; המשתמש רואה גילוי נאות בממשק.
 */
export async function ask(question, contextJson, { signal } = {}) {
  const key = await DB.getSecret('geminiKey');
  if (!key) throw new Error('לא הוגדר מפתח Gemini. עבור להגדרות');
  const model = await resolveModel(key);
  const q = clean(question, 300);
  if (!q) throw new Error('שאלה ריקה');

  const prompt = `אתה עוזר פיננסי אישי בעברית. ענה על שאלת המשתמש אך ורק על סמך
נתוני הסיכום המצורפים. כללים:
1. תשובה קצרה וישירה, עד 4 משפטים. סכומים בש״ח עם הפרדת אלפים.
2. אל תמציא נתון שאינו מופיע. אם הנתון חסר — אמור זאת במפורש.
3. ציין לאיזה חודש התשובה מתייחסת כשזה רלוונטי.
4. אל תיתן ייעוץ השקעות.

שאלת המשתמש: ${q}

נתוני סיכום (JSON):
${contextJson}`;

  const res = await fetch(`${BASE}/${model.replace(/^models\//, 'models/')}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(key) },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    }),
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('המודל לא החזיר תשובה');
  return text.trim().slice(0, 2000);
}

/* ==================== חיטוי הפלט של המודל ==================== */

const MAX_ITEMS = 200;
const SAFE_DOC = new Set(['credit_statement', 'bank_statement', 'app_receipt', 'single_receipt', 'wallet', 'other']);
const SAFE_CUR = new Set(['ILS', 'USD', 'EUR', 'GBP', 'OTHER']);
const SAFE_METHOD = new Set(['cash', 'credit', 'bank', 'bit', 'other']);
const SAFE_KIND = new Set(['fixed', 'variable', 'oneoff']);
const SAFE_NEED = new Set(['essential', 'discretionary']);
const SAFE_SCOPE = new Set(['personal', 'business']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// תווי בקרה ותווי כיווניות בלתי-נראים. שילוב של אלה מאפשר להסתיר
// טקסט בתוך שם בית עסק — בעברית זה מסוכן במיוחד בגלל RTL.
const CTRL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g');

function clean(v, max = 80) {
  if (typeof v !== 'string') return '';
  return v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const num = (v, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

const int = (v, { min = 1, max = 240 } = {}) => {
  const n = Math.round(Number(v));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

function sanitizeItem(r) {
  if (!r || typeof r !== 'object') return null;
  const amount = num(Math.abs(Number(r.amount)));
  if (amount === null || amount <= 0) return null;   // שורה בלי סכום אינה תנועה

  const n = int(r.installmentN), of = int(r.installmentOf);
  const validInst = n !== null && of !== null && of > 1 && n <= of;

  return {
    merchant: clean(r.merchant, 80),
    amount,
    currency: SAFE_CUR.has(r.currency) ? r.currency : 'ILS',
    dateBuy: ISO.test(r.dateBuy) && !isNaN(Date.parse(r.dateBuy)) ? r.dateBuy : '',
    dateCharge: ISO.test(r.dateCharge) && !isNaN(Date.parse(r.dateCharge)) ? r.dateCharge : '',
    dept: clean(r.dept, 24),
    cat: clean(r.cat, 24),
    kind: SAFE_KIND.has(r.kind) ? r.kind : undefined,
    need: SAFE_NEED.has(r.need) ? r.need : undefined,
    scope: SAFE_SCOPE.has(r.scope) ? r.scope : undefined,
    method: SAFE_METHOD.has(r.method) ? r.method : 'credit',
    installmentN: validInst ? n : undefined,
    installmentOf: validInst ? of : undefined,
    isIncome: r.isIncome === true,
    confidence: num(r.confidence, { min: 0, max: 1 }) ?? 0.8,
    raw: clean(r.raw, 160),
  };
}

export const __sanitizeItem = sanitizeItem;   // חשוף לבדיקות
export const __clean = clean;
