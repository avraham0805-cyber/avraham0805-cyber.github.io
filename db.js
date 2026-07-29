// שכבת אחסון — IndexedDB. הכל נשאר על המכשיר.
// סכומים נשמרים כאגורות (מספר שלם) כדי למנוע שגיאות עיגול.

const DB_NAME = 'kesef';
const DB_VER = 3;

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
      if (!db.objectStoreNames.contains('streams')) {
        // מרכזי רווח — כאן נפגשות הכנסות והוצאות של אותה פעילות
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

/* ---------- עסקאות ---------- */

export function uid() {
  return (crypto.randomUUID
    ? crypto.randomUUID()
    : 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

export const monthOf = (isoDate) => (isoDate || '').slice(0, 7);

/** נרמול שם בית עסק לצורך המילון הלומד והשוואת כפילויות */
export function normMerchant(name) {
  return (name || '')
    .replace(/[֑-ׇ]/g, '')          // ניקוד
    .replace(/["'`׳״.,\-_/\\|()[\]]/g, ' ')   // פיסוק
    .replace(/\b(בעמ|בע״מ|בע"מ|ltd|inc|llc)\b/gi, ' ')
    .replace(/\d{3,}/g, ' ')                  // מספרי סניף/אסמכתא
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
  const [txs, rules, fixed, meta, streams] = await Promise.all([
    all('tx'), all('rules'), all('fixed'), all('meta'), all('streams'),
  ]);
  return {
    app: 'kesef',
    version: 3,
    exportedAt: new Date().toISOString(),
    counts: { tx: txs.length, rules: rules.length, fixed: fixed.length, streams: streams.length },
    tx: txs,
    rules,
    fixed,
    streams,
    meta: meta.filter(m => m.k !== 'geminiKey'), // המפתח לא יוצא מהמכשיר
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

export async function importAll(data, { merge = true } = {}) {
  if (!data || data.app !== 'kesef') throw new Error('קובץ לא מזוהה');
  if (!merge) { await clear('tx'); await clear('rules'); await clear('fixed'); await clear('streams'); }
  const stats = { tx: 0, rules: 0, fixed: 0, streams: 0 };
  if (Array.isArray(data.tx))      { await putMany('tx', data.tx);           stats.tx = data.tx.length; }
  if (Array.isArray(data.rules))   { await putMany('rules', data.rules);     stats.rules = data.rules.length; }
  if (Array.isArray(data.fixed))   { await putMany('fixed', data.fixed);     stats.fixed = data.fixed.length; }
  if (Array.isArray(data.streams)) { await putMany('streams', data.streams); stats.streams = data.streams.length; }
  return stats;
}
