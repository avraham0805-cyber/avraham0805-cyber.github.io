// שכבת אחסון — IndexedDB. הכל נשאר על המכשיר.
// סכומים נשמרים כאגורות (מספר שלם) כדי למנוע שגיאות עיגול.

import * as Crypto from './crypto.js';

const DB_NAME = 'kesef';
const DB_VER = 4;

/** @type {IDBDatabase|null} */
let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tx')) {
        const tx = db.createObjectStore('tx', { keyPath: 'id' });
        tx.createIndex('dateBuy', 'dateBuy');
        tx.createIndex('month', 'month');
        tx.createIndex('dept', 'dept');
        tx.createIndex('needsReview', 'needsReview');
      }
      if (!db.objectStoreNames.contains('rules')) {
        // מילון לומד: מפתח = שם עסק מנורמל
        db.createObjectStore('rules', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('fixed')) {
        db.createObjectStore('fixed', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains('pending')) {
        // צילומי מסך שהגיעו דרך "שיתוף" וממתינים לפענוח
        db.createObjectStore('pending', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        // גיבויים מקומיים מתגלגלים — הגנה מפני מחיקה בטעות או קלקול
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('accounts')) {
        // חשבונות — הציר שמאפשר לראות כל בנק לחוד ואת שניהם יחד
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      // גרסאות מוקדמות קראו לזה streams. משאירים את המחסן הישן קיים
      // כדי שהשדרוג לא ייכשל, אבל אין אליו יותר כתיבה.
      if (!db.objectStoreNames.contains('streams')) {
        db.createObjectStore('streams', { keyPath: 'id' });
      }
      void e;
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(store, value) {
  const s = await tx(store, 'readwrite');
  return wrap(s.put(value));
}

export async function putMany(store, values) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve(values.length);
    t.onerror = () => reject(t.error);
  });
}

export async function get(store, key) {
  const s = await tx(store);
  return wrap(s.get(key));
}

export async function all(store) {
  const s = await tx(store);
  return wrap(s.getAll());
}

export async function del(store, key) {
  const s = await tx(store, 'readwrite');
  return wrap(s.delete(key));
}

export async function clear(store) {
  const s = await tx(store, 'readwrite');
  return wrap(s.clear());
}

/* ---------- הגדרות (meta) ---------- */

export async function setting(k, fallback = null) {
  const row = await get('meta', k);
  return row === undefined || row === null ? fallback : row.v;
}

export async function setSetting(k, v) {
  return put('meta', { k, v });
}

/* ---------- סודות מוצפנים ---------- */
// מפתחות API אף פעם לא יושבים בטקסט גלוי. גם מי שמושך את בסיס הנתונים
// מהמכשיר מקבל רק ciphertext, וחומר המפתח עצמו אינו ניתן לחילוץ.

const SECRET_KEYS = new Set(['geminiKey']);
/** מפתחות שלעולם אינם יוצאים בגיבוי */
const NEVER_EXPORT = new Set(['geminiKey', 'dek', 'dekWrapped']);

export async function setSecret(k, plain) {
  if (!SECRET_KEYS.has(k)) throw new Error('מפתח לא מוכר: ' + k);
  if (!plain) return del('meta', k);
  const box = await Crypto.seal(plain);
  return put('meta', { k, v: box, sealed: true });
}

export async function getSecret(k) {
  const row = await get('meta', k);
  if (!row) return null;
  if (!row.sealed) return row.v;               // נתון ישן מלפני ההצפנה
  try { return await Crypto.open(row.v); }
  catch { return null; }
}

export async function hasSecret(k) {
  return !!(await get('meta', k));
}

/** מעלה סודות שנשמרו בטקסט גלוי לפני שההצפנה קיימה */
export async function migrateSecrets() {
  for (const k of SECRET_KEYS) {
    const row = await get('meta', k);
    if (row && !row.sealed && row.v) await setSecret(k, row.v);
  }
}

/* ---------- עסקאות ---------- */

export function uid() {
  return (crypto.randomUUID
    ? crypto.randomUUID()
    : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

export const monthOf = (isoDate) => (isoDate || '').slice(0, 7);

/**
 * נרמול שם בית עסק — הבסיס גם למילון הלומד וגם לזיהוי כפילויות.
 *
 * הסדר כאן קריטי: צורות התאגדות חייבות לרדת **לפני** ניקוי הפיסוק,
 * אחרת בע״מ הופך ל"בע מ" ושום דפוס כבר לא תופס אותו — ואז אותו עסק
 * נרשם פעמיים ומפספסים גם את הכלל שנלמד עליו וגם את הכפילות.
 * \b של JS נשען על ASCII ולכן חסר תועלת בעברית; משתמשים בסיומות מפורשות.
 */
const ORG_FORMS = [
  /בע\s*[״"'׳`]?\s*מ/g,        // בע"מ · בע״מ · בעמ · בע מ
  /\(?\s*ע\s*[״"'׳`]?\s*ר\s*\)?/g, // ע"ר
  /\b(?:ltd|limited|inc|incorporated|llc|plc|gmbh|s\.?a\.?r\.?l)\b\.?/gi,
];

export function normMerchant(name) {
  let s = (name || '').replace(/[֑-ׇ]/g, '');   // ניקוד וטעמים
  for (const re of ORG_FORMS) s = s.replace(re, ' ');
  return s
    .replace(/["'`׳״.,\-_/\\|()[\]{}*+]/g, ' ')            // פיסוק
    .replace(/\d{3,}/g, ' ')                               // מספרי סניף ואסמכתא
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function saveTx(rec) {
  rec.month = monthOf(rec.dateBuy);
  return put('tx', rec);
}

export async function saveTxMany(recs) {
  for (const r of recs) r.month = monthOf(r.dateBuy);
  return putMany('tx', recs);
}

export async function allTx() {
  const rows = await all('tx');
  rows.sort((a, b) => (b.dateBuy || '').localeCompare(a.dateBuy || '') || b.ts - a.ts);
  return rows;
}

/* ---------- מילון לומד ---------- */

export async function learn(merchant, fields) {
  const key = normMerchant(merchant);
  if (!key) return;
  const prev = (await get('rules', key)) || { key, hits: 0 };
  return put('rules', {
    ...prev,
    ...fields,
    key,
    merchant: merchant,
    hits: (prev.hits || 0) + 1,
    updated: Date.now(),
  });
}

export async function recall(merchant) {
  const key = normMerchant(merchant);
  if (!key) return null;
  const exact = await get('rules', key);
  if (exact) return exact;
  // התאמה חלקית — "רמי לוי שיווק" מול "רמי לוי"
  const rules = await all('rules');
  let best = null;
  for (const r of rules) {
    if (!r.key || r.key.length < 3) continue;
    if (key.includes(r.key) || r.key.includes(key)) {
      if (!best || r.key.length > best.key.length) best = r;
    }
  }
  return best;
}

/* ---------- זיהוי כפילויות ---------- */

/** אותה קנייה שהגיעה גם מהארנק וגם מדף האשראי */
export function findDuplicate(rec, existing) {
  const day = (d) => new Date(d + 'T00:00:00').getTime();
  const nm = normMerchant(rec.merchant);
  for (const e of existing) {
    if (e.id === rec.id) continue;
    if (e.amount !== rec.amount) continue;
    if (Math.abs(day(e.dateBuy) - day(rec.dateBuy)) > 3 * 86400000) continue;
    const en = normMerchant(e.merchant);
    if (!nm || !en || nm === en || nm.includes(en) || en.includes(nm)) return e.id;
  }
  return null;
}

/* ---------- ייצוא / ייבוא ---------- */

export async function exportAll() {
  const [txs, rules, fixed, meta, accounts] = await Promise.all([
    all('tx'), all('rules'), all('fixed'), all('meta'), all('accounts'),
  ]);
  return {
    app: 'kesef',
    version: 4,
    exportedAt: new Date().toISOString(),
    counts: { tx: txs.length, rules: rules.length, fixed: fixed.length, accounts: accounts.length },
    tx: txs,
    rules,
    fixed,
    accounts,
    // מפתחות API וחומר הצפנה לעולם לא עוזבים את המכשיר
    meta: meta.filter(m => !NEVER_EXPORT.has(m.k)),
  };
}

/* ---------- גיבויים מקומיים מתגלגלים ---------- */

const KEEP_SNAPSHOTS = 12;

/** יוצר גיבוי מקומי. reason מופיע ברשימה כדי שיהיה ברור למה הוא נוצר. */
export async function snapshot(reason = 'אוטומטי') {
  const data = await exportAll();
  if (!data.tx.length) return null;
  const rec = { id: String(Date.now()), at: Date.now(), reason, counts: data.counts, data };
  await put('snapshots', rec);
  const rows = await all('snapshots');
  rows.sort((a, b) => b.at - a.at);
  for (const old of rows.slice(KEEP_SNAPSHOTS)) await del('snapshots', old.id);
  await setSetting('lastSnapshot', rec.at);
  return rec;
}

/** גיבוי אוטומטי לכל היותר פעם ב-12 שעות — שקוף למשתמש */
export async function maybeSnapshot(reason = 'אוטומטי') {
  const last = await setting('lastSnapshot', 0);
  if (Date.now() - last < 12 * 3600 * 1000) return null;
  return snapshot(reason);
}

export async function snapshots() {
  const rows = await all('snapshots');
  rows.sort((a, b) => b.at - a.at);
  return rows.map(r => ({ id: r.id, at: r.at, reason: r.reason, counts: r.counts }));
}

export async function restoreSnapshot(id) {
  const rec = await get('snapshots', id);
  if (!rec) throw new Error('הגיבוי לא נמצא');
  await snapshot('לפני שחזור');
  return importAll(rec.data, { merge: false });
}

/* ---------- ייבוא מאומת ---------- */
// קובץ גיבוי הוא קלט לא-מהימן: הוא יכול להגיע מוואטסאפ, ממייל, או מקובץ
// שמישהו ערך. לכן כל רשומה נבנית מחדש משדות מותרים בלבד — לא מועתקת כמו שהיא.

const MAX_ROWS = 100000;
const STR = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
const NUM = (v, max = 1e12) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-max, Math.min(max, Math.round(n))) : 0;
};
const ONE_OF = (v, set, dflt) => (set.includes(v) ? v : dflt);
const ISO_DATE = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);

function cleanTx(r) {
  if (!r || typeof r !== 'object') return null;
  const dateBuy = ISO_DATE(r.dateBuy);
  if (!dateBuy) return null;
  const inst = r.installment && Number.isInteger(r.installment.n) && Number.isInteger(r.installment.of)
    && r.installment.of > 1 && r.installment.n <= r.installment.of && r.installment.of <= 240
    ? { n: r.installment.n, of: r.installment.of } : null;
  return {
    id: STR(r.id, 64) || uid(),
    ts: NUM(r.ts) || Date.now(),
    dateBuy, dateCharge: ISO_DATE(r.dateCharge),
    merchant: STR(r.merchant, 80),
    amount: NUM(r.amount), ils: NUM(r.ils ?? r.amount),
    currency: ONE_OF(r.currency, ['ILS', 'USD', 'EUR', 'GBP', 'OTHER'], 'ILS'),
    dept: STR(r.dept, 24), cat: STR(r.cat, 24),
    kind: ONE_OF(r.kind, ['fixed', 'variable', 'oneoff'], 'variable'),
    need: ONE_OF(r.need, ['essential', 'discretionary'], 'essential'),
    scope: ONE_OF(r.scope, ['personal', 'business'], 'personal'),
    account: STR(r.account || r.stream, 64) || 'bank1',   // stream = השם הישן
    method: ONE_OF(r.method, ['cash', 'credit', 'bank', 'bit', 'other'], 'cash'),
    installment: inst,
    note: STR(r.note, 200), source: ONE_OF(r.source, ['manual', 'ocr', 'recurring'], 'manual'),
    confidence: Math.max(0, Math.min(1, Number(r.confidence) || 1)),
    needsReview: r.needsReview === true,
    dupOf: STR(r.dupOf, 64) || null,
    raw: STR(r.raw, 200),
    fixedId: STR(r.fixedId, 64) || null,
    month: dateBuy.slice(0, 7),
  };
}

const cleanRule = (r) => (r && typeof r.key === 'string' && r.key ? {
  key: STR(r.key, 120), merchant: STR(r.merchant, 80),
  dept: STR(r.dept, 24), cat: STR(r.cat, 24),
  kind: STR(r.kind, 16), need: STR(r.need, 16), scope: STR(r.scope, 16),
  hits: NUM(r.hits, 1e6), updated: NUM(r.updated),
} : null);

const cleanFixed = (f) => (f && typeof f === 'object' && f.id ? {
  id: STR(f.id, 64), merchant: STR(f.merchant, 80), amount: NUM(f.amount),
  dept: STR(f.dept, 24), cat: STR(f.cat, 24),
  account: STR(f.account || f.stream, 64) || 'bank1',
  day: Math.max(1, Math.min(31, NUM(f.day) || 1)),
  method: ONE_OF(f.method, ['cash', 'credit', 'bank', 'bit', 'other'], 'bank'),
  need: ONE_OF(f.need, ['essential', 'discretionary'], 'essential'),
  active: f.active !== false, startMonth: STR(f.startMonth, 7),
} : null);

const cleanAccount = (s) => (s && typeof s === 'object' && s.id ? {
  id: STR(s.id, 64), name: STR(s.name, 60) || 'ללא שם',
  type: ONE_OF(s.type, ['bank', 'cash', 'card', 'other'], 'bank'),
  slot: Math.max(0, Math.min(7, NUM(s.slot))), active: s.active !== false,
  builtin: s.builtin === true,
} : null);

const cleanMeta = (m) => (m && typeof m.k === 'string' && !NEVER_EXPORT.has(m.k)
  ? { k: STR(m.k, 60), v: m.v } : null);

export async function importAll(data, { merge = true } = {}) {
  if (!data || data.app !== 'kesef') throw new Error('קובץ לא מזוהה');
  if (data.encrypted) throw new Error('הקובץ מוצפן — נדרשת סיסמה');

  const take = (arr, fn) =>
    (Array.isArray(arr) ? arr.slice(0, MAX_ROWS).map(fn).filter(Boolean) : []);

  const tx = take(data.tx, cleanTx);
  const rules = take(data.rules, cleanRule);
  const fixed = take(data.fixed, cleanFixed);
  const accounts = take(data.accounts || data.streams, cleanAccount);
  const meta = take(data.meta, cleanMeta);

  const dropped = (Array.isArray(data.tx) ? data.tx.length : 0) - tx.length;

  if (!merge) { await clear('tx'); await clear('rules'); await clear('fixed'); await clear('accounts'); }
  if (tx.length) await putMany('tx', tx);
  if (rules.length) await putMany('rules', rules);
  if (fixed.length) await putMany('fixed', fixed);
  if (accounts.length) await putMany('accounts', accounts);
  for (const m of meta) await put('meta', m);

  return { tx: tx.length, rules: rules.length, fixed: fixed.length, accounts: accounts.length, dropped };
}
