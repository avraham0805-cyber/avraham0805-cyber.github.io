// פענוח צילומי מסך דרך Gemini API — קריאה ישירה מהדפדפן, בלי שרת באמצע.
// המפתח נשמר ב-IndexedDB על המכשיר בלבד ולא נכלל בייצוא.

import * as DB from './db.js';
import { flatForPrompt } from './taxonomy.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/* ---------- בחירת מודל ---------- */

// ניקוד גבוה = עדיף. בוחר לבד כדי שהאפליקציה לא תישבר כשגוגל מוציאה מודל משימוש.
function scoreModel(name) {
  const n = name.replace('models/', '');
  if (!/gemini/.test(n)) return -1;
  if (/embedding|aqa|imagen|veo|tts|native-audio|image-generation/.test(n)) return -1;
  let s = 0;
  if (/flash/.test(n)) s += 100;          // flash = מהיר וזמין בשכבת החינם
  if (/lite/.test(n)) s += 10;
  if (/pro/.test(n)) s += 40;
  const ver = n.match(/gemini-(\d+)\.(\d+)/);
  if (ver) s += parseInt(ver[1]) * 10 + parseInt(ver[2]);
  if (/preview|exp/.test(n)) s -= 25;     // מעדיף יציב
  if (/thinking/.test(n)) s -= 15;
  return s;
}

export async function listModels(key) {
  const res = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`);
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
  if (res.status === 403) return new Error('המפתח נדחה (403). בדוק שה-API מופעל בפרויקט');
  if (res.status === 429) return new Error('חרגת ממכסת השכבה החינמית. נסה שוב בעוד דקה');
  if (res.status >= 500) return new Error('שגיאת שרת אצל גוגל. נסה שוב');
  return new Error(msg || `שגיאה ${res.status}`);
}

/* ---------- הקטנת תמונה לפני שליחה ---------- */

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

/* ---------- הסכימה שהמודל מחויב להחזיר ---------- */

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
          dateBuy:      { type: 'string' },
          dateCharge:   { type: 'string' },
          merchant:     { type: 'string' },
          amount:       { type: 'number' },
          currency:     { type: 'string', enum: ['ILS', 'USD', 'EUR', 'GBP', 'OTHER'] },
          dept:         { type: 'string' },
          cat:          { type: 'string' },
          kind:         { type: 'string', enum: ['fixed', 'variable', 'oneoff'] },
          need:         { type: 'string', enum: ['essential', 'discretionary'] },
          scope:        { type: 'string', enum: ['personal', 'business'] },
          method:       { type: 'string', enum: ['cash', 'credit', 'bank', 'bit', 'other'] },
          installmentN:  { type: 'integer' },
          installmentOf: { type: 'integer' },
          isIncome:     { type: 'boolean' },
          confidence:   { type: 'number' },
          raw:          { type: 'string' },
        },
        required: ['merchant', 'amount', 'dept', 'cat'],
      },
    },
  },
  required: ['items'],
};

function buildPrompt(today, hints) {
  return `אתה מנוע חילוץ נתונים פיננסיים. לפניך צילום מסך ישראלי — דף פירוט אשראי,
תנועות בנק, קבלה, או מסך אפליקציה (ביט/פייבוקס/וולט/ארנק דיגיטלי).

חלץ **כל** שורת תנועה שנראית בתמונה. אל תמציא שורות ואל תשמיט שורות.

התאריך היום הוא ${today}.

כללים מחייבים:
1. amount — תמיד מספר חיובי, בלי סימן מטבע ובלי פסיקים. אם השורה היא זיכוי/החזר, סמן
   isIncome=true והשאר את amount חיובי.
2. dateBuy — תאריך הקנייה בפורמט YYYY-MM-DD. אם מופיע רק יום+חודש, השלם את השנה
   ההגיונית ביחס להיום. אם אין תאריך כלל — השתמש בתאריך היום.
3. dateCharge — תאריך החיוב בפועל, אם ורק אם הוא מופיע בנפרד מתאריך הקנייה
   (נפוץ בדפי אשראי). אחרת השאר ריק.
4. תשלומים — אם מופיע "3 מתוך 12" / "תשלום 3/12": installmentN=3, installmentOf=12,
   ו-amount הוא סכום התשלום החודשי בלבד, לא סכום העסקה המלא.
5. dept ו-cat — חייבים להיות בדיוק מהרשימה למטה. בחר את ההתאמה הטובה ביותר לפי שם
   בית העסק. אם באמת לא ברור, בחר את קטגוריית ה-general של המחלקה הסבירה ביותר.
6. העברות בין אנשים (ביט, פייבוקס, העברה לחבר), משיכת מזומן, והעברה בין חשבונות
   הן **לא הוצאה** — סווג אותן ל-transfer/*.
7. משכורת, זיכוי, ורווחי מסחר → income/*, עם isIncome=true.
8. confidence — 0 עד 1. תן ציון נמוך לשורות שקשה לקרוא או שהסיווג שלהן מנחש.
9. raw — העתק מדויק של הטקסט המקורי של השורה כפי שהוא מופיע בתמונה.
10. merchant — שם בית העסק נקי, בלי מספרי אסמכתא, בלי "בע״מ", בלי מספרי סניף.

${hints ? `רמזים מהמשתמש: ${hints}\n` : ''}
קטגוריות מותרות (dept/cat):
${flatForPrompt()}`;
}

/* ---------- הקריאה ---------- */

export async function parseImage(blob, { hints = '', signal } = {}) {
  const key = await DB.setting('geminiKey');
  if (!key) throw new Error('לא הוגדר מפתח Gemini. עבור להגדרות');
  const model = await resolveModel(key);
  const small = await shrink(blob);
  const b64 = await blobToBase64(small);
  const today = new Date().toISOString().slice(0, 10);

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: b64 } },
        { text: buildPrompt(today, hints) },
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
    },
  };

  const res = await fetch(
    `${BASE}/${model.replace(/^models\//, 'models/')}:generateContent?key=${encodeURIComponent(key)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal },
  );
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
    docType: parsed.docType || 'other',
    account: parsed.account || '',
    items: Array.isArray(parsed.items) ? parsed.items : [],
    model,
  };
}

export async function testKey(key) {
  const models = await listModels(key);
  return models[0] || null;
}
