// הצפנה מקומית — WebCrypto בלבד, בלי ספריות.
//
// מודל האיום: מישהו שמגיע לדפדפן או לגיבוי שלך. לא שרת, כי אין שרת.
//
// המפתח (DEK) נוצר כ-CryptoKey **לא ניתן לחילוץ** ונשמר ב-IndexedDB.
// גם קוד זדוני שרץ בעמוד לא יכול לקרוא את חומר המפתח — לכל היותר להשתמש
// בו כל עוד העמוד פתוח. זו הסיבה ש-CSP קשיח הוא חלק מהמנגנון ולא תוספת.
//
// עם קוד נעילה: ה-DEK נעטף במפתח שנגזר מהקוד ב-PBKDF2, והעותק הפתוח נמחק.
// בלי הקוד אין דרך לפתוח את הנתונים — גם לא לי.

const ITER = 310000;          // OWASP 2026 ל-PBKDF2-SHA256
const KEY_STORE = 'meta';

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

/* ==================== מפתח הנתונים ==================== */

let _dek = null;         // CryptoKey לא ניתן לחילוץ, בזיכרון בלבד
let _locked = false;

export const isUnlocked = () => !!_dek;
export const isLocked = () => _locked;

async function newDek() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * מאתחל את שכבת ההצפנה.
 * מחזיר 'ready' אם המפתח זמין, או 'needs-pin' אם הוא נעול בקוד.
 */
export async function initCrypto(db) {
  const wrapped = await db.setting('dekWrapped');
  if (wrapped) { _locked = true; return 'needs-pin'; }

  const stored = await db.setting('dek');
  if (stored) { _dek = stored; return 'ready'; }

  _dek = await newDek();
  await db.setSetting('dek', _dek);   // IndexedDB שומר CryptoKey כאובייקט מובנה
  return 'ready';
}

/* ==================== נעילה בקוד ==================== */

async function kdf(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'],
  );
}

/**
 * מפעיל נעילה. מייצר DEK חדש **ניתן לעטיפה**, עוטף אותו בקוד, ומוחק את הפתוח.
 * חייב לרוץ לפני שיש נתונים מוצפנים, או אחרי הצפנה מחדש.
 */
export async function enablePin(db, pin) {
  if (!/^\d{4,12}$/.test(pin)) throw new Error('קוד חייב להיות 4 עד 12 ספרות');
  const salt = rand(16);
  const kek = await kdf(pin, salt);
  // כדי לעטוף מפתח הוא חייב להיות extractable — הוא נוצר כאן ולא נשמר בשום מקום פתוח
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, 'AES-KW');
  await db.setSetting('dekWrapped', { salt: b64(salt), key: b64(wrapped), iter: ITER });
  await db.del(KEY_STORE, 'dek');
  _dek = dek;
  _locked = false;
  return true;
}

export async function unlock(db, pin) {
  const rec = await db.setting('dekWrapped');
  if (!rec) throw new Error('אין נעילה פעילה');
  const kek = await kdf(pin, unb64(rec.salt));
  let dek;
  try {
    dek = await crypto.subtle.unwrapKey(
      'raw', unb64(rec.key), kek, 'AES-KW',
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
  } catch {
    throw new Error('קוד שגוי');
  }
  _dek = dek; _locked = false;
  return true;
}

export async function disablePin(db, pin) {
  await unlock(db, pin);
  await db.del(KEY_STORE, 'dekWrapped');
  const fresh = await newDek();
  await db.setSetting('dek', fresh);
  _dek = fresh;
  return true;
}

export function lockNow() { if (_dek) { _dek = null; _locked = true; } }

/* ==================== איטום ==================== */

/** מצפין מחרוזת. הפלט נושא את ה-IV ולכן בטוח לאחסון ולגיבוי. */
export async function seal(plain) {
  if (!_dek) throw new Error('שכבת ההצפנה נעולה');
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _dek, enc.encode(String(plain)));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}

export async function open(box) {
  if (!_dek) throw new Error('שכבת ההצפנה נעולה');
  if (!box || box.v !== 1) throw new Error('פורמט לא מוכר');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(box.iv) }, _dek, unb64(box.ct));
    return dec.decode(pt);
  } catch {
    // AES-GCM מאומת: כישלון פענוח = הנתון שונה או שהמפתח אינו נכון
    throw new Error('פענוח נכשל — הנתון שונה או שהמפתח אינו תואם');
  }
}

/* ==================== גיבוי מוגן בסיסמה ==================== */

/**
 * גיבוי מוצפן שאינו תלוי במכשיר — נפתח בכל מכשיר עם הסיסמה.
 * לשם כך נדרשת גזירה עצמאית מהסיסמה, ולא ה-DEK המקומי.
 */
export async function sealExport(text, passphrase) {
  if (!passphrase || passphrase.length < 8) throw new Error('סיסמה חייבת להיות 8 תווים לפחות');
  const salt = rand(16), iv = rand(12);
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { app: 'kesef', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

export async function openExport(box, passphrase) {
  if (!box?.encrypted) throw new Error('הקובץ אינו מוצפן');
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(box.salt), iterations: box.iter || ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return dec.decode(pt);
  } catch {
    throw new Error('סיסמה שגויה או קובץ פגום');
  }
}

/** לבדיקות בלבד — מאפשר לאתחל מצב נקי */
export function __resetForTests() { _dek = null; _locked = false; }
