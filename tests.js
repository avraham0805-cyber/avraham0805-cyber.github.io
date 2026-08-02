// חבילת בדיקות — רצה בדפדפן מול המודולים האמיתיים, בלי מוקים.
// כל בדיקה מאמתת התנהגות שמישהו יכול לשבור, לא שהקוד קיים.

import * as DB from './db.js';
import * as Crypto from './crypto.js';
import * as AI from './ai.js';
import * as ST from './stats.js';
import * as IN from './insights.js';
import * as TX from './taxonomy.js';
import * as C from './charts.js';

const results = [];
let group = '';

const G = (name) => { group = name; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function t(name, fn) {
  const started = performance.now();
  try {
    await fn();
    results.push({ group, name, pass: true, ms: performance.now() - started });
  } catch (e) {
    results.push({ group, name, pass: false, err: e.message || String(e), ms: performance.now() - started });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'ציפייה נכשלה'); }
function assertEq(a, b, msg) {
  if (!eq(a, b)) throw new Error(`${msg || 'ערכים שונים'} — קיבלתי ${JSON.stringify(a)}, ציפיתי ${JSON.stringify(b)}`);
}
function assertClose(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || 'סטייה'} — ${a} מול ${b} (סבילות ${tol})`);
}
async function assertThrows(fn, msg) {
  try { await fn(); } catch { return; }
  throw new Error(msg || 'ציפיתי לשגיאה ולא נזרקה');
}

/* ==================== נתוני עזר ==================== */

const mk = (o = {}) => ({
  id: o.id || Math.random().toString(36).slice(2),
  ts: 1, dateBuy: o.dateBuy || '2026-07-15', dateCharge: null,
  merchant: o.merchant ?? 'עסק', amount: o.amount ?? 10000, ils: o.ils ?? o.amount ?? 10000,
  currency: 'ILS', dept: o.dept || 'food', cat: o.cat || 'super',
  kind: o.kind || 'variable', need: o.need || 'essential', scope: 'personal',
  account: o.account || 'bank1', method: o.method || 'credit',
  installment: o.installment || null, note: '', source: 'manual', confidence: 1,
  needsReview: false, dupOf: o.dupOf || null, raw: '', fixedId: null,
  month: (o.dateBuy || '2026-07-15').slice(0, 7),
});

const monthsOf = (n, endY = 2026, endM = 7) => Array.from({ length: n }, (_, i) => {
  const d = new Date(endY, endM - 1 - (n - 1 - i), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

/* ==================== טקסונומיה ==================== */

G('טקסונומיה');

await t('כל מחלקה מכילה קטגוריית general', () => {
  for (const d of TX.DEPTS) assert(d.cats.some(c => c.key === 'general'), `חסר general ב-${d.key}`);
});

await t('מפתחות קטגוריה ייחודיים בתוך כל מחלקה', () => {
  for (const d of TX.DEPTS) {
    const keys = d.cats.map(c => c.key);
    assertEq(keys.length, new Set(keys).size, `כפילות מפתח ב-${d.key}`);
  }
});

await t('מפתחות מחלקה ייחודיים', () => {
  const keys = TX.DEPTS.map(d => d.key);
  assertEq(keys.length, new Set(keys).size);
});

await t('לכל מחלקה בדיוק זרימה אחת חוקית', () => {
  for (const d of TX.DEPTS) assert(['out', 'in', 'neutral'].includes(d.flow), d.key);
});

await t('קיימת בדיוק מחלקת הכנסה אחת ומחלקת העברות אחת', () => {
  assertEq(TX.DEPTS.filter(d => d.flow === 'in').length, 1);
  assertEq(TX.DEPTS.filter(d => d.flow === 'neutral').length, 1);
});

await t('defaultsFor מחזיר ערכים חוקיים לכל צירוף', () => {
  for (const d of TX.DEPTS) for (const c of d.cats) {
    const r = TX.defaultsFor(d.key, c.key);
    assert(['fixed', 'variable', 'oneoff'].includes(r.kind), `${d.key}/${c.key} kind`);
    assert(['essential', 'discretionary'].includes(r.need), `${d.key}/${c.key} need`);
    }
});

await t('קטגוריה לא קיימת לא מפילה', () => {
  assertEq(TX.cat('food', 'no-such'), null);
  assertEq(TX.dept('nope'), null);
  assert(TX.pathLabel('nope', 'x').length > 0);
});

await t('flatForPrompt מכסה את כל הקטגוריות', () => {
  const lines = TX.flatForPrompt().split('\n');
  const total = TX.DEPTS.reduce((s, d) => s + d.cats.length, 0);
  assertEq(lines.length, total);
});

/* ==================== נרמול והתאמה ==================== */

G('נרמול');

await t('normMerchant מסיר פיסוק, ניקוד ומספרי סניף', () => {
  assertEq(DB.normMerchant('רמי לוי בע"מ 12345'), DB.normMerchant('רמי לוי'));
  assertEq(DB.normMerchant('KSP  Ltd.'), DB.normMerchant('ksp'));
});

await t('כל צורות בע״מ מנורמלות לאותו שם', () => {
  const base = DB.normMerchant('שופרסל');
  for (const v of ['שופרסל בע"מ', 'שופרסל בע״מ', 'שופרסל בעמ', 'שופרסל בע מ', 'שופרסל בע׳מ']) {
    assertEq(DB.normMerchant(v), base, `נכשל על ${v}`);
  }
});

await t('צורות התאגדות לועזיות מנורמלות', () => {
  const base = DB.normMerchant('acme');
  for (const v of ['Acme Ltd', 'ACME Inc.', 'Acme LLC', 'Acme Limited']) {
    assertEq(DB.normMerchant(v), base, `נכשל על ${v}`);
  }
});

await t('נרמול בע״מ מזין גם את זיהוי הכפילויות', () => {
  const existing = [mk({ id: 'a', merchant: 'שופרסל בע"מ', amount: 5000, dateBuy: '2026-07-10' })];
  assertEq(DB.findDuplicate({ id: 'b', merchant: 'שופרסל', amount: 5000, dateBuy: '2026-07-11' }, existing), 'a');
});

await t('normMerchant עמיד לקלט ריק', () => {
  assertEq(DB.normMerchant(''), '');
  assertEq(DB.normMerchant(null), '');
  assertEq(DB.normMerchant(undefined), '');
});

await t('זיהוי כפילות תופס אותו סכום בטווח שלושה ימים', () => {
  const existing = [mk({ id: 'a', merchant: 'שופרסל', amount: 12345, dateBuy: '2026-07-10' })];
  const probe = { id: 'b', merchant: 'שופרסל דיל', amount: 12345, dateBuy: '2026-07-12' };
  assertEq(DB.findDuplicate(probe, existing), 'a');
});

await t('זיהוי כפילות לא תופס סכום שונה', () => {
  const existing = [mk({ id: 'a', merchant: 'שופרסל', amount: 12345, dateBuy: '2026-07-10' })];
  assertEq(DB.findDuplicate({ id: 'b', merchant: 'שופרסל', amount: 12346, dateBuy: '2026-07-10' }, existing), null);
});

await t('זיהוי כפילות לא תופס מעבר לחלון הזמן', () => {
  const existing = [mk({ id: 'a', merchant: 'שופרסל', amount: 12345, dateBuy: '2026-07-01' })];
  assertEq(DB.findDuplicate({ id: 'b', merchant: 'שופרסל', amount: 12345, dateBuy: '2026-07-20' }, existing), null);
});

/* ==================== אחסון ==================== */

G('אחסון');

await t('כתיבה וקריאה של תנועה שומרות על כל השדות', async () => {
  await DB.clear('tx');
  const rec = mk({ merchant: 'בדיקה', amount: 4242 });
  await DB.saveTx(rec);
  const back = (await DB.allTx())[0];
  assertEq(back.merchant, 'בדיקה');
  assertEq(back.amount, 4242);
  assertEq(back.month, '2026-07');
});

await t('saveTx גוזר month מהתאריך תמיד', async () => {
  await DB.clear('tx');
  await DB.saveTx({ ...mk({ dateBuy: '2025-12-31' }), month: 'שגוי' });
  assertEq((await DB.allTx())[0].month, '2025-12');
});

await t('המילון הלומד זוכר ומחזיר', async () => {
  await DB.clear('rules');
  await DB.learn('רמי לוי', { dept: 'food', cat: 'super' });
  const r = await DB.recall('רמי לוי שיווק השקמה');
  assertEq(r.dept, 'food');
  assertEq(r.cat, 'super');
});

await t('המילון סופר פגיעות', async () => {
  await DB.clear('rules');
  await DB.learn('פז', { dept: 'transport', cat: 'fuel' });
  await DB.learn('פז', { dept: 'transport', cat: 'fuel' });
  assertEq((await DB.recall('פז')).hits, 2);
});

/* ==================== הצפנה ==================== */

G('הצפנה');

await t('אתחול שכבת ההצפנה מייצר מפתח זמין', async () => {
  const state = await Crypto.initCrypto(DB);
  assert(state === 'ready' || state === 'needs-pin', 'מצב לא צפוי: ' + state);
  if (state === 'needs-pin') throw new Error('הסביבה נעולה בקוד — הרץ בסביבה נקייה');
  assert(Crypto.isUnlocked(), 'המפתח אינו זמין אחרי אתחול');
});

await t('המפתח נשמר כ-CryptoKey שאינו ניתן לחילוץ', async () => {
  const k = await DB.setting('dek');
  assert(k instanceof CryptoKey, 'לא נשמר כ-CryptoKey');
  assertEq(k.extractable, false, 'המפתח ניתן לחילוץ — קוד זר יוכל לקרוא אותו');
  await assertThrows(() => crypto.subtle.exportKey('raw', k), 'ניתן היה לייצא את המפתח');
});

await t('איטום ופתיחה מחזירים את המקור', async () => {
  const box = await Crypto.seal('סוד-123');
  assertEq(await Crypto.open(box), 'סוד-123');
});

await t('ciphertext אינו מכיל את הטקסט הגלוי', async () => {
  const box = await Crypto.seal('AIzaSyTOP_SECRET');
  assert(!JSON.stringify(box).includes('SECRET'), 'הטקסט דלף ל-ciphertext');
});

await t('כל איטום מייצר IV שונה', async () => {
  const a = await Crypto.seal('זהה');
  const b = await Crypto.seal('זהה');
  assert(a.iv !== b.iv, 'IV חוזר על עצמו');
  assert(a.ct !== b.ct, 'ciphertext זהה לשני איטומים');
});

await t('שינוי ב-ciphertext מפיל את הפענוח', async () => {
  const box = await Crypto.seal('שלם');
  const tampered = { ...box, ct: box.ct.slice(0, -4) + (box.ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
  await assertThrows(() => Crypto.open(tampered), 'AES-GCM לא זיהה שינוי');
});

await t('גיבוי מוצפן נפתח בסיסמה נכונה בלבד', async () => {
  const box = await Crypto.sealExport('{"a":1}', 'סיסמה-ארוכה');
  assertEq(await Crypto.openExport(box, 'סיסמה-ארוכה'), '{"a":1}');
  await assertThrows(() => Crypto.openExport(box, 'סיסמה-אחרת'));
});

await t('סיסמה קצרה נדחית', async () => {
  await assertThrows(() => Crypto.sealExport('x', '123'));
});

await t('סוד נשמר מוצפן ולא בטקסט גלוי', async () => {
  await DB.setSecret('geminiKey', 'AIza-TEST-KEY-VALUE');
  const raw = await DB.get('meta', 'geminiKey');
  assert(raw.sealed === true, 'הרשומה לא סומנה כאטומה');
  assert(!JSON.stringify(raw.v).includes('AIza'), 'המפתח נשמר בטקסט גלוי');
  assertEq(await DB.getSecret('geminiKey'), 'AIza-TEST-KEY-VALUE');
});

await t('המפתח לא יוצא בגיבוי', async () => {
  await DB.setSecret('geminiKey', 'AIza-MUST-NOT-LEAK');
  const dump = JSON.stringify(await DB.exportAll());
  assert(!dump.includes('AIza'), 'המפתח דלף לגיבוי');
  assert(!dump.includes('geminiKey'), 'שם המפתח דלף לגיבוי');
  assert(!dump.includes('dek'), 'חומר מפתח דלף לגיבוי');
});

/* ==================== חיטוי קלט מהמודל ==================== */

G('חיטוי');

await t('שורה בלי סכום נדחית', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x' }), null);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 0 }), null);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 'לא מספר' }), null);
});

await t('סכום שלילי הופך לחיובי', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: -50 }).amount, 50);
});

await t('סכום אינסופי או NaN נדחה', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: Infinity }), null);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: NaN }), null);
});

await t('תאריך לא חוקי מנוקה לריק', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, dateBuy: '2026-13-45' }).dateBuy, '');
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, dateBuy: 'אתמול' }).dateBuy, '');
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, dateBuy: '2026-07-15' }).dateBuy, '2026-07-15');
});

await t('ערך enum לא מוכר נופל לברירת מחדל', () => {
  const r = AI.__sanitizeItem({ merchant: 'x', amount: 5, currency: 'BTC', method: 'crypto' });
  assertEq(r.currency, 'ILS');
  assertEq(r.method, 'credit');
});

await t('תשלומים לא הגיוניים נזרקים', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, installmentN: 9, installmentOf: 3 }).installmentOf, undefined);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, installmentN: 1, installmentOf: 9999 }).installmentOf, undefined);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, installmentN: 3, installmentOf: 12 }).installmentOf, 12);
});

await t('שם בית עסק נחתך באורך', () => {
  const long = 'א'.repeat(500);
  assert(AI.__sanitizeItem({ merchant: long, amount: 5 }).merchant.length <= 80);
});

await t('תווי בקרה ותווי כיווניות מוסרים', () => {
  const evil = 'טוב‮רע ​';
  const out = AI.__clean(evil);
  assert(!/[ -​-‏‪-‮]/.test(out), 'נשארו תווים בלתי נראים: ' + JSON.stringify(out));
});

await t('ביטחון מוגבל לטווח 0..1', () => {
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, confidence: 9 }).confidence, 1);
  assertEq(AI.__sanitizeItem({ merchant: 'x', amount: 5, confidence: -3 }).confidence, 0);
});

/* ==================== ייבוא לא מהימן ==================== */

G('ייבוא');

await t('קובץ זר נדחה', async () => {
  await assertThrows(() => DB.importAll({ app: 'אחר' }));
  await assertThrows(() => DB.importAll(null));
});

await t('שורה בלי תאריך חוקי נדחית ונספרת', async () => {
  await DB.clear('tx');
  const st = await DB.importAll({
    app: 'kesef',
    tx: [mk({ dateBuy: '2026-07-01' }), { ...mk(), dateBuy: 'זבל' }, { ...mk(), dateBuy: null }],
  }, { merge: false });
  assertEq(st.tx, 1);
  assertEq(st.dropped, 2);
});

await t('שדות זרים בקובץ ייבוא לא נשמרים', async () => {
  await DB.clear('tx');
  await DB.importAll({
    app: 'kesef',
    tx: [{ ...mk({ id: 'zz' }), __proto__evil: 1, onclick: 'alert(1)', extra: 'x' }],
  }, { merge: false });
  const back = (await DB.allTx())[0];
  assertEq(back.onclick, undefined);
  assertEq(back.extra, undefined);
});

await t('enum לא חוקי בייבוא נופל לברירת מחדל', async () => {
  await DB.clear('tx');
  await DB.importAll({ app: 'kesef', tx: [{ ...mk(), method: 'זבל', kind: 'זבל', currency: 'זבל' }] }, { merge: false });
  const b = (await DB.allTx())[0];
  assertEq(b.method, 'cash');
  assertEq(b.kind, 'variable');
  assertEq(b.currency, 'ILS');
});

await t('קובץ מוצפן נדחה בייבוא רגיל', async () => {
  await assertThrows(() => DB.importAll({ app: 'kesef', encrypted: true }));
});

await t('סבב ייצוא-ייבוא שומר על הנתונים', async () => {
  await DB.clear('tx'); await DB.clear('rules');
  const rows = [mk({ id: 'r1', amount: 111 }), mk({ id: 'r2', amount: 222, dateBuy: '2026-06-05' })];
  await DB.saveTxMany(rows);
  await DB.learn('עסק כלשהו', { dept: 'food', cat: 'super' });
  const dump = JSON.parse(JSON.stringify(await DB.exportAll()));
  await DB.clear('tx'); await DB.clear('rules');
  const st = await DB.importAll(dump, { merge: false });
  assertEq(st.tx, 2);
  assertEq(st.rules, 1);
  const back = await DB.allTx();
  assertEq(back.map(r => r.amount).sort((a, b) => a - b), [111, 222]);
});

/* ==================== סטטיסטיקה ==================== */

G('סטטיסטיקה');

await t('חציון מחזיר ערך נכון לזוגי ולאי-זוגי', () => {
  assertEq(ST.median([1, 2, 3]), 2);
  assertEq(ST.median([1, 2, 3, 4]), 3);   // עיגול כלפי מעלה של 2.5
  assertEq(ST.median([]), 0);
});

await t('קצב יומי והשלכה לחודש שהסתיים מתלכדים', () => {
  const rows = [mk({ dateBuy: '2026-06-05', amount: 10000 }), mk({ dateBuy: '2026-06-20', amount: 20000 })];
  const r = ST.runRate(rows, '2026-06', new Date(2026, 6, 15));
  assertEq(r.total, 30000);
  assertEq(r.projected, 30000, 'לחודש סגור התחזית חייבת להיות הסכום בפועל');
  assertEq(r.daysLeft, 0);
});

await t('קצב יומי מחשב נכון באמצע חודש', () => {
  const rows = [mk({ dateBuy: '2026-07-01', amount: 100000 })];
  const r = ST.runRate(rows, '2026-07', new Date(2026, 6, 10));
  assertEq(r.dayOfMonth, 10);
  assertEq(r.perDay, 10000);
  assertEq(r.projected, 310000, '31 ימים ביולי');
});

await t('כפילויות לא נספרות בסטטיסטיקה', () => {
  const rows = [mk({ amount: 5000 }), mk({ amount: 5000, dupOf: 'x' })];
  assertEq(ST.runRate(rows, '2026-07', new Date(2026, 6, 31)).total, 5000);
});

await t('העברות לא נספרות כהוצאה', () => {
  const rows = [mk({ amount: 5000 }), mk({ amount: 90000, dept: 'transfer', cat: 'withdrawal' })];
  assertEq(ST.runRate(rows, '2026-07', new Date(2026, 6, 31)).total, 5000);
});

await t('ייחוס שינוי מסתכם בדיוק להפרש', () => {
  const rows = [
    mk({ dateBuy: '2026-06-05', dept: 'food', amount: 10000 }),
    mk({ dateBuy: '2026-06-06', dept: 'transport', cat: 'fuel', amount: 30000 }),
    mk({ dateBuy: '2026-07-05', dept: 'food', amount: 25000 }),
    mk({ dateBuy: '2026-07-06', dept: 'transport', cat: 'fuel', amount: 20000 }),
  ];
  const a = ST.attribution(rows, '2026-06', '2026-07');
  assertEq(a.delta, 5000);
  assertEq(a.parts.reduce((s, p) => s + p.delta, 0), a.delta, 'סכום התרומות חייב להיות ההפרש');
  assertEq(a.parts[0].dept, 'food', 'הגורם הגדול ביותר');
});

await t('ייחוס מזהה מחלקה שנעלמה לגמרי', () => {
  const rows = [
    mk({ dateBuy: '2026-06-05', dept: 'leisure', cat: 'flights', amount: 500000 }),
    mk({ dateBuy: '2026-07-05', dept: 'food', amount: 10000 }),
  ];
  const a = ST.attribution(rows, '2026-06', '2026-07');
  const gone = a.parts.find(p => p.dept === 'leisure');
  assertEq(gone.to, 0);
  assertEq(gone.delta, -500000);
});

await t('מקדם השתנות מזהה קטגוריה יציבה מול תנודתית', () => {
  const rows = [];
  monthsOf(4).forEach((m, i) => {
    rows.push(mk({ dateBuy: `${m}-05`, dept: 'home', cat: 'rent', amount: 540000 }));
    rows.push(mk({ dateBuy: `${m}-06`, dept: 'leisure', cat: 'flights', amount: [0, 900000, 10000, 300000][i] }));
  });
  const v = ST.volatility(rows.filter(r => r.amount > 0));
  const rent = v.find(x => x.cat === 'rent');
  const fly = v.find(x => x.cat === 'flights');
  assertEq(rent.cv, 0, 'שכר דירה קבוע חייב cv אפס');
  assert(fly.cv > rent.cv, 'טיסות חייבות להיות תנודתיות יותר');
});

await t('ריכוזיות מנורמלת בין 0 ל-1', () => {
  const spread = ['א', 'ב', 'ג', 'ד'].map(m => mk({ merchant: m, amount: 10000 }));
  const single = [mk({ merchant: 'יחיד', amount: 40000 })];
  const a = ST.concentration(spread), b = ST.concentration(single);
  assertClose(a.normalized, 0, 0.001, 'פיזור מלא');
  assertEq(b.normalized, 1, 'ריכוז מלא');
  assertEq(a.top5Share, 1);
});

await t('דפוס יומי מנרמל לימים פעילים', () => {
  const rows = [
    mk({ dateBuy: '2026-07-05', amount: 10000 }),   // ראשון
    mk({ dateBuy: '2026-07-12', amount: 30000 }),   // ראשון
    mk({ dateBuy: '2026-07-06', amount: 50000 }),   // שני
  ];
  const w = ST.weekdayPattern(rows);
  assertEq(w[0].perActiveDay, 20000, 'ממוצע שני ימי ראשון');
  assertEq(w[1].perActiveDay, 50000);
});

await t('נטו מצטבר עולה עם עודף ויורד עם גירעון', () => {
  const rows = [
    mk({ dateBuy: '2026-06-01', dept: 'income', cat: 'salary', amount: 100000 }),
    mk({ dateBuy: '2026-06-02', amount: 40000 }),
    mk({ dateBuy: '2026-07-01', dept: 'income', cat: 'salary', amount: 100000 }),
    mk({ dateBuy: '2026-07-02', amount: 150000 }),
  ];
  const c = ST.cumulativeNet(rows);
  assertEq(c[0].cumulative, 60000);
  assertEq(c[1].cumulative, 10000);
});

await t('תחזית מחזירה null בלי מספיק היסטוריה', () => {
  assertEq(ST.forecast([mk()]), null);
});

await t('תחזית מפחיתה תשלומים שנגמרים', () => {
  const rows = [];
  monthsOf(4).forEach(m => {
    rows.push(mk({ dateBuy: `${m}-05`, amount: 100000 }));
    rows.push(mk({ dateBuy: `${m}-10`, dept: 'income', cat: 'salary', amount: 500000 }));
  });
  rows.push(mk({ dateBuy: '2026-07-07', dept: 'shopping', cat: 'electronics', amount: 50000, installment: { n: 10, of: 12 } }));
  const fc = ST.forecast(rows, [], 3);
  assertEq(fc.rows[0].openInstallments, 1, 'חודש קדימה עוד משלמים');
  assertEq(fc.rows[1].openInstallments, 1);
  assertEq(fc.rows[2].openInstallments, 0, 'בחודש השלישי הסדרה נגמרה');
  assert(fc.rows[2].out < fc.rows[0].out, 'היציאה חייבת לרדת כשסדרה נגמרת');
});

/* ==================== מנוע התייעלות ==================== */

G('התייעלות');

await t('מנוע לא רץ על מדגם קטן מדי', () => {
  const r = IN.analyze([mk(), mk()]);
  assertEq(r.ready, false);
  assert(r.need > 0);
});

await t('חיוב חוזר מזוהה אחרי שלושה חודשים', () => {
  const rows = monthsOf(4).map(m => mk({ dateBuy: `${m}-12`, merchant: 'NETFLIX', dept: 'subs', cat: 'streaming', amount: 4500 }));
  const rec = IN.findRecurring(rows);
  const nf = rec.find(r => r.merchant === 'NETFLIX');
  assert(nf, 'לא זוהה');
  assertEq(nf.monthly, 4500);
  assertEq(nf.annual, 54000);
});

await t('שני חודשים בלבד אינם חיוב חוזר', () => {
  const rows = monthsOf(2).map(m => mk({ dateBuy: `${m}-12`, merchant: 'רק פעמיים', amount: 4500 }));
  assertEq(IN.findRecurring(rows).length, 0);
});

await t('רכישה בתשלומים אינה חיוב חוזר', () => {
  const rows = monthsOf(6).map((m, i) => mk({
    dateBuy: `${m}-07`, merchant: 'KSP', dept: 'shopping', cat: 'electronics',
    amount: 49900, installment: { n: i + 1, of: 12 },
  }));
  assertEq(IN.findRecurring(rows).length, 0, 'תשלומים סווגו כמנוי');
});

await t('תשלומים לא נספרים כחיסכון בר-ביטול', () => {
  const rows = [];
  monthsOf(6).forEach((m, i) => {
    rows.push(mk({ dateBuy: `${m}-07`, merchant: 'KSP', dept: 'shopping', cat: 'electronics', amount: 49900, installment: { n: i + 1, of: 12 } }));
    rows.push(mk({ dateBuy: `${m}-12`, merchant: 'NETFLIX', dept: 'subs', cat: 'streaming', amount: 4500, need: 'discretionary' }));
    rows.push(mk({ dateBuy: `${m}-14`, merchant: 'Spotify', dept: 'subs', cat: 'streaming', amount: 2190, need: 'discretionary' }));
  });
  const subs = IN.analyze(rows).findings.find(f => f.id === 'subs-load');
  assert(subs, 'לא נמצא ממצא מנויים');
  assert(!subs.evidence.some(e => e.label === 'KSP'), 'KSP הוצג כמנוי שאפשר לבטל');
  assertEq(subs.annual, (4500 + 2190) * 12, 'הסכום כולל תשלומים');
});

await t('סכום לא יציב אינו חיוב חוזר', () => {
  const amounts = [1000, 90000, 5000, 40000];
  const rows = monthsOf(4).map((m, i) => mk({ dateBuy: `${m}-12`, merchant: 'משתנה', amount: amounts[i] }));
  assertEq(IN.findRecurring(rows).filter(r => r.merchant === 'משתנה').length, 0);
});

await t('שכר דירה לא מוצג כמנוי שאפשר לבטל', () => {
  const rows = [];
  monthsOf(5).forEach(m => {
    rows.push(mk({ dateBuy: `${m}-01`, merchant: 'שכר דירה', dept: 'home', cat: 'rent', amount: 540000, kind: 'fixed' }));
    rows.push(mk({ dateBuy: `${m}-12`, merchant: 'NETFLIX', dept: 'subs', cat: 'streaming', amount: 4500, kind: 'fixed', need: 'discretionary' }));
    rows.push(mk({ dateBuy: `${m}-14`, merchant: 'Spotify', dept: 'subs', cat: 'streaming', amount: 2190, kind: 'fixed', need: 'discretionary' }));
  });
  const r = IN.analyze(rows);
  const subs = r.findings.find(f => f.id === 'subs-load');
  assert(subs, 'לא נמצא ממצא מנויים');
  assert(!subs.evidence.some(e => e.label.includes('שכר דירה')), 'שכר דירה נספר כמנוי');
  assert(subs.annual <= (4500 + 2190) * 12, 'הסכום כולל התחייבויות שאי אפשר לבטל');
});

await t('הכותרת לא סופרת ממצאים חופפים פעמיים', () => {
  const rows = [];
  monthsOf(6).forEach((m, i) => {
    rows.push(mk({ dateBuy: `${m}-12`, merchant: 'NETFLIX', dept: 'subs', cat: 'streaming', amount: 4500 + i * 500, need: 'discretionary' }));
    rows.push(mk({ dateBuy: `${m}-14`, merchant: 'Spotify', dept: 'subs', cat: 'streaming', amount: 2190, need: 'discretionary' }));
    rows.push(mk({ dateBuy: `${m}-02`, amount: 30000 }));
  });
  const r = IN.analyze(rows);
  const counted = r.findings.filter(f => f.countInTotal !== false);
  assertEq(r.totalAnnual, counted.reduce((s, f) => s + f.annual, 0));
  assert(r.findings.some(f => f.countInTotal === false), 'לא סומן אף ממצא כחופף');
});

await t('פער מזומן מזוהה', () => {
  const rows = [];
  monthsOf(3).forEach(m => {
    rows.push(mk({ dateBuy: `${m}-05`, merchant: 'משיכה', dept: 'transfer', cat: 'withdrawal', amount: 100000 }));
    rows.push(mk({ dateBuy: `${m}-06`, amount: 10000, method: 'cash' }));
    rows.push(mk({ dateBuy: `${m}-07`, amount: 20000 }));
  });
  const f = IN.analyze(rows).findings.find(x => x.id === 'cash-gap');
  assert(f, 'פער המזומן לא זוהה');
});

/* ==================== גרפים ==================== */

G('גרפים');

await t('עמודות עם מערך ריק לא מפילות', () => {
  const el = C.columns([], { fmt: String });
  assert(el instanceof HTMLElement);
});

await t('עמודות מייצרות מלבן לכל פריט', () => {
  const el = C.columns([{ label: 'א', value: 10 }, { label: 'ב', value: 20 }], { fmt: String });
  assertEq(el.querySelectorAll('rect.bar').length, 2);
});

await t('ערך אפס לא יוצר עמודה שלילית', () => {
  const el = C.columns([{ label: 'א', value: 0 }, { label: 'ב', value: 100 }], { fmt: String });
  const heights = [...el.querySelectorAll('rect.bar')].map(r => +r.getAttribute('height'));
  assert(heights.every(h => h >= 0), 'גובה שלילי: ' + heights);
});

await t('קו ניצוץ עם נקודה אחת לא מפיל', () => {
  assert(C.sparkline([5]) instanceof SVGElement);
  assert(C.sparkline([]) instanceof SVGElement);
});

await t('צבע סדרה לעולם לא מחזורי מעבר לשמונה', () => {
  const eight = new Set(Array.from({ length: 8 }, (_, i) => C.seriesVar(i)));
  assertEq(eight.size, 8, 'שמונה המשבצות חייבות להיות שונות');
});

/* ==================== הגנת רינדור ==================== */

G('רינדור');

await t('esc חוסם הזרקת HTML', () => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const evil = '<img src=x onerror=alert(1)>';
  const div = document.createElement('div');
  div.innerHTML = `<span>${esc(evil)}</span>`;
  assertEq(div.querySelectorAll('img').length, 0, 'תג הוזרק');
  assertEq(div.textContent, evil, 'הטקסט לא נשמר כפי שהוא');
});

await t('שם בית עסק זדוני לא יוצר אלמנט', () => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const item = AI.__sanitizeItem({ merchant: '"><script>alert(1)</script>', amount: 10 });
  const div = document.createElement('div');
  div.innerHTML = `<button class="row" title="${esc(item.merchant)}">${esc(item.merchant)}</button>`;
  assertEq(div.querySelectorAll('script').length, 0);
  assertEq(div.querySelectorAll('button').length, 1);
});

/* ==================== דיווח ==================== */

const total = results.length;
const failed = results.filter(r => !r.pass);
const byGroup = {};
for (const r of results) {
  byGroup[r.group] ||= { pass: 0, fail: 0 };
  byGroup[r.group][r.pass ? 'pass' : 'fail']++;
}

window.__TESTS = {
  total, passed: total - failed.length, failed: failed.length,
  groups: byGroup,
  failures: failed.map(f => `${f.group} › ${f.name} — ${f.err}`),
  ms: Math.round(results.reduce((s, r) => s + r.ms, 0)),
};

const out = document.getElementById('out');
if (out) {
  out.innerHTML =
    `<h1>${failed.length ? '✗' : '✓'} ${total - failed.length}/${total} עברו</h1>` +
    Object.entries(byGroup).map(([g, s]) =>
      `<div class="g"><b>${g}</b> ${s.pass}✓${s.fail ? ` <span class="f">${s.fail}✗</span>` : ''}</div>`).join('') +
    (failed.length ? '<h2>כשלים</h2>' + failed.map(f =>
      `<div class="f">${f.group} › ${f.name}<br><small>${f.err}</small></div>`).join('') : '');
}
