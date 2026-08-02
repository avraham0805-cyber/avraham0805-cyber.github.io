// מנוע התייעלות — עובר על ההיסטוריה ומחזיר ממצאים מדורגים לפי ₪ לשנה.
// כל ממצא נושא ראיה: השורות שהובילו אליו. אין ניחושים בלי גיבוי מספרי.

import { dept, cat, pathLabel, flowOf, catLabel } from './taxonomy.js';
import { normMerchant } from './db.js';

const MONTH = (iso) => (iso || '').slice(0, 7);
const DAY = 86400000;
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const monthsBetween = (a, b) => {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

const ils = (t) => t.ils ?? t.amount ?? 0;
const live = (rows) => rows.filter(t => !t.dupOf);
const out = (rows) => live(rows).filter(t => flowOf(t.dept) === 'out');
const inc = (rows) => live(rows).filter(t => flowOf(t.dept) === 'in');

/* ==================== זיהוי חיובים חוזרים ==================== */

/**
 * חיוב חוזר = אותו בית עסק, ב-3 חודשים נפרדים לפחות, בסכום יציב (סטייה עד 25%).
 * זו הבסיס לחצי מהבדיקות — מנויים, זחילת מחיר, כפילויות, ונטישה.
 */
export function findRecurring(txs) {
  const byMerchant = new Map();
  for (const t of out(txs)) {
    // תשלומים הם לא חיוב חוזר: הרכישה כבר נעשתה, והסדרה תיגמר מעצמה.
    // בלי הסינון הזה רכישה ב-12 תשלומים מוצגת כ"מנוי שאפשר לבטל" —
    // עצה שגויה שגם מנפחת את סכום החיסכון.
    if (t.installment) continue;
    const k = normMerchant(t.merchant);
    if (!k || k.length < 2) continue;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }

  const result = [];
  for (const [key, rows] of byMerchant) {
    const months = [...new Set(rows.map(r => r.month))].sort();
    if (months.length < 3) continue;

    // רצף חודשי — מרווח ממוצע של חודש בערך
    const gaps = months.slice(1).map((m, i) => monthsBetween(months[i], m));
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap > 1.6) continue;

    const amounts = rows.map(ils);
    const med = median(amounts);
    if (!med) continue;
    const stable = amounts.filter(a => Math.abs(a - med) / med <= 0.25).length / amounts.length;
    if (stable < 0.7) continue;

    const last = rows.reduce((a, b) => (a.dateBuy > b.dateBuy ? a : b));
    const first = rows.reduce((a, b) => (a.dateBuy < b.dateBuy ? a : b));
    result.push({
      key,
      merchant: last.merchant,
      dept: last.dept, cat: last.cat,
      monthly: med,
      annual: med * 12,
      months: months.length,
      rows: rows.sort((a, b) => a.dateBuy.localeCompare(b.dateBuy)),
      firstAmount: ils(first), lastAmount: ils(last),
      lastDate: last.dateBuy,
      daysSince: Math.floor((Date.now() - new Date(last.dateBuy + 'T00:00:00').getTime()) / DAY),
    });
  }
  return result.sort((a, b) => b.annual - a.annual);
}

/* ==================== הבדיקות ==================== */

/**
 * countInTotal=false לממצא שהחיסכון שלו כבר נספר בממצא אחר.
 * בלי זה הכותרת הגדולה סופרת את אותו שקל פעמיים.
 */
const F = (id, severity, title, why, action, annual, evidence = [], countInTotal = true) =>
  ({ id, severity, title, why, action, annual, evidence, countInTotal });

/** חיוב חוזר שאפשר באמת לבטל — לא שכר דירה, לא ארנונה, לא ביטוח חובה */
const cancellable = (r) => {
  if (r.dept === 'subs') return true;
  if (r.dept === 'health' && r.cat === 'gym') return true;
  if (r.dept === 'leisure') return true;
  if (r.dept === 'home' && ['cleaning', 'furniture'].includes(r.cat)) return true;
  return cat(r.dept, r.cat)?.need === 'discretionary';
};

function checkSubscriptionLoad(txs, rec) {
  const subs = rec.filter(cancellable);
  if (subs.length < 2) return null;
  const annual = subs.reduce((s, r) => s + r.annual, 0);
  return F(
    'subs-load', annual > 400000 ? 'serious' : 'warning',
    `${subs.length} מנויים שניתן לבטל`,
    `יחד הם ${money(annual / 12)} בחודש — ${money(annual)} בשנה. אלה חיובים שממשיכים לרוץ גם כשמפסיקים להשתמש, וזו ההוצאה היחידה שביטול שלה חוסך את מלוא הסכום מיד.`,
    'עבור על הרשימה. כל מה שלא נגעת בו החודש — בטל.',
    annual,
    subs.map(r => ({ label: r.merchant, sub: pathLabel(r.dept, r.cat), value: r.annual, note: `${money(r.monthly)} לחודש` })),
  );
}

/** התחייבויות קבועות — מידע, לא הזדמנות חיסכון */
function checkFixedCommitment(txs, rec) {
  const locked = rec.filter(r => !cancellable(r));
  if (locked.length < 3) return null;
  const annual = locked.reduce((s, r) => s + r.annual, 0);
  return F(
    'fixed-load', 'warning',
    `${money(annual / 12)} בחודש התחייבויות קבועות`,
    `${locked.length} חיובים שחוזרים כל חודש בלי שתחליט מחדש — ${money(annual)} בשנה. אלה לא מנויים לביטול, אבל הם הרצפה שכל שאר התקציב יושב עליה.`,
    'פעם בשנה שווה להתמקח על כל אחד מהם. ביטוח, סלולר וחשמל הם המקומות שבהם שיחה אחת מזיזה הכי הרבה.',
    0,
    locked.map(r => ({ label: r.merchant, sub: pathLabel(r.dept, r.cat), value: r.annual, note: `${money(r.monthly)} לחודש` })),
  );
}

function checkPriceCreep(txs, rec) {
  const creeps = rec
    .filter(r => r.rows.length >= 4 && r.firstAmount > 0)
    .map(r => ({ r, delta: (r.lastAmount - r.firstAmount) / r.firstAmount }))
    .filter(x => x.delta >= 0.08 && (x.r.lastAmount - x.r.firstAmount) * 12 >= 2000)
    .sort((a, b) => (b.r.lastAmount - b.r.firstAmount) - (a.r.lastAmount - a.r.firstAmount));
  if (!creeps.length) return null;
  const annual = creeps.reduce((s, x) => s + (x.r.lastAmount - x.r.firstAmount) * 12, 0);
  return F(
    'price-creep', 'serious',
    `${creeps.length} חיובים חוזרים התייקרו בשקט`,
    `העלייה המצטברת היא ${money(annual)} בשנה מעל מה ששילמת בהתחלה. התייקרות של מנוי כמעט אף פעם לא מודיעה על עצמה.`,
    'בדוק אם עברת לחבילה יקרה יותר, אם הסתיים מבצע היכרות, או אם פשוט העלו מחיר.',
    annual,
    creeps.map(x => ({
      label: x.r.merchant, sub: `${money(x.r.firstAmount)} ← ${money(x.r.lastAmount)}`,
      value: (x.r.lastAmount - x.r.firstAmount) * 12, note: `+${Math.round(x.delta * 100)}%`,
    })),
    false,   // תת-קבוצה של המנויים — כבר נספר שם
  );
}

function checkDuplicateSubs(txs, rec) {
  const byCat = new Map();
  for (const r of rec) {
    const k = `${r.dept}/${r.cat}`;
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(r);
  }
  const dups = [...byCat.entries()].filter(([, rows]) => rows.length >= 2 && rows[0].dept === 'subs');
  if (!dups.length) return null;
  const annual = dups.reduce((s, [, rows]) =>
    s + rows.slice(1).reduce((x, r) => x + r.annual, 0), 0);
  return F(
    'dup-subs', 'warning',
    'מנויים חופפים באותה קטגוריה',
    dups.map(([k, rows]) => `${catLabel(...k.split('/'))}: ${rows.map(r => r.merchant).join(' + ')}`).join(' · ') +
    '. שירותים באותה קטגוריה בדרך כלל מחליפים זה את זה, לא משלימים.',
    'בחר אחד. הביטול של השאר חוסך את מלוא הסכום.',
    annual,
    dups.flatMap(([, rows]) => rows.map(r => ({ label: r.merchant, sub: pathLabel(r.dept, r.cat), value: r.annual }))),
    false,   // תת-קבוצה של המנויים
  );
}

function checkDormant(txs, rec) {
  const dormant = rec.filter(r => r.daysSince > 50 && r.daysSince < 200 && r.months >= 4);
  if (!dormant.length) return null;
  return F(
    'dormant', 'good',
    `${dormant.length} חיובים חוזרים נעצרו`,
    'חיובים שרצו באופן קבוע והפסיקו. אם ביטלת — יופי, זה כסף שחזר. אם לא ביטלת, שווה לוודא שהחיוב לא עבר לכרטיס אחר שאתה לא עוקב אחריו.',
    'ודא שכל אחד מהם באמת בוטל ולא רק זז.',
    0,
    dormant.map(r => ({ label: r.merchant, sub: `אחרון ${r.lastDate}`, value: r.annual, note: `לפני ${r.daysSince} ימים` })),
  );
}

function checkSmallLeaks(txs) {
  const cur = recentMonths(txs, 3);
  const byMerchant = new Map();
  for (const t of out(cur)) {
    const k = normMerchant(t.merchant);
    if (!k) continue;
    if (!byMerchant.has(k)) byMerchant.set(k, { name: t.merchant, n: 0, sum: 0, dept: t.dept, cat: t.cat });
    const e = byMerchant.get(k);
    e.n++; e.sum += ils(t);
  }
  const leaks = [...byMerchant.values()]
    .filter(e => e.n >= 8 && e.sum / e.n < 8000 && cat(e.dept, e.cat)?.need === 'discretionary')
    .sort((a, b) => b.sum - a.sum);
  if (!leaks.length) return null;
  const monthly = leaks.reduce((s, e) => s + e.sum, 0) / 3;
  return F(
    'small-leaks', monthly > 80000 ? 'serious' : 'warning',
    'הוצאות קטנות שמצטברות בשקט',
    `${leaks.length} בתי עסק שכל חיוב בהם קטן — אבל ביחד הם ${money(monthly)} בחודש. זו ההוצאה שהכי קשה להרגיש כי אף חיוב בודד לא מרגיש יקר.`,
    'לא צריך לבטל — צריך לחצות. הורדה של שליש מהתדירות מחזירה ' + money(monthly * 4) + ' בשנה.',
    Math.round(monthly * 12 / 3),
    leaks.slice(0, 8).map(e => ({
      label: e.name, sub: `${e.n} חיובים ב-3 חודשים`, value: Math.round(e.sum / 3),
      note: `${money(Math.round(e.sum / e.n))} בממוצע`,
    })),
  );
}

function checkDiscretionaryDrift(txs) {
  const months = lastNMonths(txs, 4);
  if (months.length < 3) return null;
  const disc = months.map(m => ({
    m,
    v: out(txs.filter(t => t.month === m)).filter(t => t.need === 'discretionary').reduce((s, t) => s + ils(t), 0),
  }));
  const current = disc.at(-1);
  const base = median(disc.slice(0, -1).map(d => d.v));
  if (!base || current.v <= base * 1.2) return null;
  const delta = current.v - base;
  return F(
    'disc-drift', 'warning',
    'הוצאות הרשות קפצו החודש',
    `${money(current.v)} מול חציון של ${money(base)} בחודשים הקודמים — עלייה של ${Math.round(delta / base * 100)}%. הוצאות רשות הן החלק שבאמת בשליטה שלך.`,
    'הסתכל על החודש הזה ותבדוק אם זה אירוע חד-פעמי או הרגל חדש.',
    delta * 12,
    disc.map(d => ({ label: d.m, sub: d.m === current.m ? 'החודש' : '', value: d.v })),
    false,   // חופף להוצאות הקטנות — לא נספר פעמיים
  );
}

function checkInstallments(txs) {
  const open = live(txs).filter(t => t.installment && t.installment.of > t.installment.n && flowOf(t.dept) === 'out');
  if (!open.length) return null;
  const committed = open.reduce((s, t) => s + ils(t) * (t.installment.of - t.installment.n), 0);
  const monthly = open.reduce((s, t) => s + ils(t), 0);
  const endingSoon = open.filter(t => t.installment.of - t.installment.n <= 3);
  const freeing = endingSoon.reduce((s, t) => s + ils(t), 0);
  return F(
    'installments', committed > 1000000 ? 'serious' : 'warning',
    `${money(monthly)} בחודש מחויב מראש בתשלומים`,
    `סה״כ ${money(committed)} כבר מובטחים לחיוב קדימה. זה כסף שכבר הוצא — הוא פשוט עוד לא עזב את החשבון.` +
    (freeing ? ` ${money(freeing)} לחודש משתחררים תוך 3 חודשים.` : ''),
    freeing
      ? `כשהתשלומים האלה נגמרים, ${money(freeing)} בחודש מתפנים. תחליט מראש לאן הם הולכים, אחרת הם ייעלמו.`
      : 'לפני כל עסקה בתשלומים — בדוק כמה כבר מחויב.',
    0,
    open.sort((a, b) => ils(b) * (b.installment.of - b.installment.n) - ils(a) * (a.installment.of - a.installment.n))
      .slice(0, 8)
      .map(t => ({
        label: t.merchant || pathLabel(t.dept, t.cat),
        sub: `תשלום ${t.installment.n} מתוך ${t.installment.of}`,
        value: ils(t) * (t.installment.of - t.installment.n),
        note: `${money(ils(t))} לחודש`,
      })),
  );
}

function checkFeeLoad(txs) {
  const cur = recentMonths(txs, 3);
  const fees = out(cur).filter(t => t.dept === 'finance' && ['bankfees', 'cardfees', 'interest'].includes(t.cat));
  if (!fees.length) return null;
  const sum = fees.reduce((s, t) => s + ils(t), 0);
  const monthly = sum / 3;
  if (monthly < 3000) return null;
  const totalOut = out(cur).reduce((s, t) => s + ils(t), 0) / 3;
  const pct = totalOut ? (monthly / totalOut * 100) : 0;
  return F(
    'fees', monthly > 15000 ? 'critical' : 'serious',
    `${money(monthly)} בחודש עמלות וריבית`,
    `${pct.toFixed(1)}% מכל ההוצאה החודשית הולכת לעמלות בנק, דמי כרטיס וריבית — כסף שלא קנה שום דבר.`,
    'זו ההוצאה הכי קלה למחיקה. שיחה אחת עם הבנק על מסלול עמלות מחזירה בדרך כלל את רובה.',
    Math.round(monthly * 12 * 0.6),
    Object.entries(fees.reduce((m, t) => {
      const k = catLabel(t.dept, t.cat);
      m[k] = (m[k] || 0) + ils(t);
      return m;
    }, {})).map(([label, v]) => ({ label, sub: 'ב-3 חודשים', value: v })),
  );
}

function checkAnomalies(txs) {
  const byMerchant = new Map();
  for (const t of out(txs)) {
    const k = normMerchant(t.merchant);
    if (!k) continue;
    if (!byMerchant.has(k)) byMerchant.set(k, []);
    byMerchant.get(k).push(t);
  }
  const odd = [];
  const cutoff = Date.now() - 60 * DAY;
  for (const rows of byMerchant.values()) {
    if (rows.length < 5) continue;
    const med = median(rows.map(ils));
    if (med < 2000) continue;
    for (const t of rows) {
      if (new Date(t.dateBuy + 'T00:00:00').getTime() < cutoff) continue;
      if (ils(t) > med * 2.5) odd.push({ t, med });
    }
  }
  if (!odd.length) return null;
  const extra = odd.reduce((s, o) => s + (ils(o.t) - o.med), 0);
  return F(
    'anomaly', 'warning',
    `${odd.length} חיובים חריגים ביחס לרגיל`,
    `בבתי עסק שאתה מכיר היטב הופיעו חיובים גבוהים פי 2.5 ומעלה מהרגיל שלך שם. ההפרש המצטבר ${money(extra)}.`,
    'שווה לוודא שאין כאן חיוב כפול, טעות, או משהו שנרכש בטעות.',
    0,
    odd.sort((a, b) => ils(b.t) - ils(a.t)).slice(0, 6).map(o => ({
      label: o.t.merchant, sub: `${o.t.dateBuy} · רגיל ${money(o.med)}`,
      value: ils(o.t), note: `פי ${(ils(o.t) / o.med).toFixed(1)}`,
    })),
  );
}

function checkCashBlindSpot(txs) {
  const cur = recentMonths(txs, 3);
  const withdrawn = live(cur).filter(t => t.dept === 'transfer' && t.cat === 'withdrawal').reduce((s, t) => s + ils(t), 0);
  if (withdrawn < 30000) return null;
  const cashSpent = out(cur).filter(t => t.method === 'cash').reduce((s, t) => s + ils(t), 0);
  const gap = withdrawn - cashSpent;
  if (gap < withdrawn * 0.3) return null;
  return F(
    'cash-gap', 'warning',
    `${money(gap)} מזומן לא מתועד`,
    `משכת ${money(withdrawn)} ורשמת הוצאות מזומן של ${money(cashSpent)} בלבד. ההפרש הוא כסף שיצא בלי שתדע על מה.`,
    'זה החור הכי גדול בכל מעקב הוצאות. הכנסה מהירה במזומן לוקחת 4 שניות — היא בדיוק בשביל זה.',
    0,
    [{ label: 'נמשך', sub: '3 חודשים', value: withdrawn },
     { label: 'תועד', sub: 'הוצאות מזומן', value: cashSpent },
     { label: 'לא ידוע', sub: 'הפער', value: gap }],
  );
}

function checkSavingsRate(txs) {
  const months = lastNMonths(txs, 3);
  if (months.length < 2) return null;
  const rows = txs.filter(t => months.includes(t.month));
  const i = inc(rows).reduce((s, t) => s + ils(t), 0);
  const o = out(rows).reduce((s, t) => s + ils(t), 0);
  if (!i) return null;
  const rate = (i - o) / i;
  const good = rate >= 0.2;
  return F(
    'savings-rate', good ? 'good' : rate < 0 ? 'critical' : 'warning',
    `שיעור חיסכון ${(rate * 100).toFixed(0)}%`,
    good
      ? `מכל ${money(i)} שנכנסו ב-3 החודשים האחרונים, ${money(i - o)} נשארו. זה קצב בריא.`
      : rate < 0
        ? `יצא ${money(o - i)} יותר ממה שנכנס ב-3 החודשים האחרונים. הפער נסגר מחיסכון קיים או מאשראי.`
        : `נשאר ${money(i - o)} מתוך ${money(i)}. מתחת ל-20% הכרית דקה מדי לאירוע לא צפוי.`,
    good ? 'שמור על הקצב.' : 'המנוף הכי גדול הוא ההוצאות הקבועות — הן חוזרות כל חודש בלי שתחליט מחדש.',
    0,
    [{ label: 'נכנס', sub: '3 חודשים', value: i },
     { label: 'יצא', sub: '3 חודשים', value: o },
     { label: 'נשאר', sub: '', value: i - o }],
  );
}

/* ==================== עזרים ==================== */

function lastNMonths(txs, n) {
  return [...new Set(txs.map(t => t.month))].filter(Boolean).sort().slice(-n);
}
function recentMonths(txs, n) {
  const ms = lastNMonths(txs, n);
  return txs.filter(t => ms.includes(t.month));
}

let _money = (a) => '₪' + Math.round(a / 100).toLocaleString('he-IL');
function money(a) { return _money(a); }
/** מזריקים את מעצב המטבע של האפליקציה כדי שהטקסטים ידברו באותה שפה */
export function setFormatter(fn) { _money = fn; }

/* ==================== נקודת הכניסה ==================== */

export function analyze(txs) {
  const rows = live(txs);
  if (rows.length < 5) {
    return {
      findings: [],
      recurring: [],
      ready: false,
      need: 5 - rows.length,
    };
  }
  const rec = findRecurring(rows);
  const checks = [
    checkSavingsRate(rows),
    checkFeeLoad(rows),
    checkPriceCreep(rows, rec),
    checkSubscriptionLoad(rows, rec),
    checkFixedCommitment(rows, rec),
    checkDuplicateSubs(rows, rec),
    checkSmallLeaks(rows),
    checkDiscretionaryDrift(rows),
    checkInstallments(rows),
    checkCashBlindSpot(rows),
    checkAnomalies(rows),
    checkDormant(rows, rec),
  ].filter(Boolean);

  const SEV = { critical: 0, serious: 1, warning: 2, good: 3 };
  checks.sort((a, b) => (b.annual - a.annual) || (SEV[a.severity] - SEV[b.severity]));

  // סוכמים רק ממצאים שלא חופפים זה לזה, אחרת אותו שקל נספר פעמיים
  const totalAnnual = checks
    .filter(f => f.countInTotal !== false)
    .reduce((s, f) => s + (f.annual || 0), 0);

  return { findings: checks, recurring: rec, ready: true, totalAnnual };
}
