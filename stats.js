// שכבת סטטיסטיקה — מה שהופך רשימת תנועות להבנה.
// כל פונקציה טהורה: מקבלת תנועות, מחזירה מספרים. אין כאן DOM ואין אחסון.

import { flowOf, dept, catLabel } from './taxonomy.js';

const ils = (t) => t.ils ?? t.amount ?? 0;
export const live = (rows) => rows.filter(t => !t.dupOf);
export const spend = (rows) => live(rows).filter(t => flowOf(t.dept) === 'out');
export const income = (rows) => live(rows).filter(t => flowOf(t.dept) === 'in');
const sum = (rows) => rows.reduce((s, t) => s + ils(t), 0);

export const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const shiftMonth = (m, by) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const monthsRange = (to, n) => Array.from({ length: n }, (_, i) => shiftMonth(to, -(n - 1 - i)));

/* ==================== קצב וריצה ==================== */

/**
 * קצב שריפה והשלכה לסוף חודש.
 * elapsed = כמה מהחודש כבר עבר; לחודש שהסתיים זה 1 והתחזית מתלכדת עם בפועל.
 */
export function runRate(txs, month, today = new Date()) {
  const rows = spend(txs.filter(t => t.month === month));
  const total = sum(rows);
  const dim = daysInMonth(month);
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const dayOfMonth = isCurrent ? today.getDate() : dim;
  const perDay = dayOfMonth ? total / dayOfMonth : 0;
  return {
    total, dayOfMonth, daysInMonth: dim,
    daysLeft: Math.max(0, dim - dayOfMonth),
    perDay: Math.round(perDay),
    projected: Math.round(perDay * dim),
    elapsed: dayOfMonth / dim,
    isCurrent,
  };
}

/* ==================== תחזית תזרים ==================== */

/**
 * תחזית 3 חודשים קדימה.
 * קבוע = חיובים חוזרים מזוהים; משתנה = חציון 3 החודשים האחרונים בניכוי הקבוע.
 * חציון ולא ממוצע — כדי שחודש חריג אחד לא יעוות את התחזית.
 */
export function forecast(txs, recurring = [], months = 3, from = null) {
  const all = [...new Set(live(txs).map(t => t.month))].filter(Boolean).sort();
  if (all.length < 2) return null;
  const base = from || all.at(-1);
  const recent = monthsRange(base, 4).slice(0, 3);   // שלושת החודשים שקדמו לבסיס

  const fixedMonthly = recurring.reduce((s, r) => s + r.monthly, 0);
  const outs = recent.map(m => sum(spend(txs.filter(t => t.month === m))));
  const ins = recent.map(m => sum(income(txs.filter(t => t.month === m))));
  const medOut = median(outs.filter(v => v > 0));
  const medIn = median(ins.filter(v => v > 0));
  const variable = Math.max(0, medOut - fixedMonthly);

  // התחייבויות תשלומים שכבר ידועות, לפי חודש קדימה
  const inst = live(txs).filter(t => t.installment && t.installment.of > t.installment.n && flowOf(t.dept) === 'out');

  const rows = [];
  let cumulative = 0;
  for (let i = 1; i <= months; i++) {
    const m = shiftMonth(base, i);
    const stillPaying = inst.filter(t => t.installment.of - t.installment.n >= i);
    const instThis = sum(stillPaying);
    const out = fixedMonthly + variable + instThis;
    const net = medIn - out;
    cumulative += net;
    rows.push({
      month: m, fixed: fixedMonthly, variable, installments: instThis,
      out, in: medIn, net, cumulative,
      openInstallments: stillPaying.length,
    });
  }
  return {
    base, rows, fixedMonthly, variable, medIn, medOut,
    confidence: recent.filter((m, i) => outs[i] > 0).length / recent.length,
  };
}

/* ==================== ייחוס שינוי ==================== */

/**
 * "למה החודש שונה" — מפרק את ההפרש בין שני חודשים למחלקות,
 * ממוין לפי גודל התרומה. זה ההסבר, לא רק ההשוואה.
 */
export function attribution(txs, monthA, monthB) {
  const byDept = (m) => {
    const acc = {};
    for (const t of spend(txs.filter(x => x.month === m))) acc[t.dept] = (acc[t.dept] || 0) + ils(t);
    return acc;
  };
  const a = byDept(monthA), b = byDept(monthB);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const parts = keys.map(k => ({
    dept: k, label: dept(k)?.label || k,
    from: a[k] || 0, to: b[k] || 0, delta: (b[k] || 0) - (a[k] || 0),
  })).filter(p => p.delta !== 0);
  parts.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);
  return {
    from: monthA, to: monthB, totalA, totalB, delta: totalB - totalA,
    pct: totalA ? (totalB - totalA) / totalA : 0,
    parts,
    up: parts.filter(p => p.delta > 0),
    down: parts.filter(p => p.delta < 0),
  };
}

/* ==================== יציבות ==================== */

/**
 * מקדם השתנות לכל קטגוריה על פני החודשים.
 * cv נמוך = אפשר לתקצב את זה. cv גבוה = כל תחזית עליו היא ניחוש.
 */
export function volatility(txs, minMonths = 3) {
  const months = [...new Set(live(txs).map(t => t.month))].filter(Boolean).sort();
  if (months.length < minMonths) return [];
  const byCat = new Map();
  for (const t of spend(txs)) {
    const k = `${t.dept}/${t.cat}`;
    if (!byCat.has(k)) byCat.set(k, new Map());
    const mm = byCat.get(k);
    mm.set(t.month, (mm.get(t.month) || 0) + ils(t));
  }
  const out = [];
  for (const [k, mm] of byCat) {
    const series = months.map(m => mm.get(m) || 0);
    const active = series.filter(v => v > 0);
    if (active.length < minMonths) continue;
    const m = mean(series), sd = stdev(series);
    const [dk, ck] = k.split('/');
    out.push({
      key: k, dept: dk, cat: ck, label: catLabel(dk, ck),
      mean: Math.round(m), sd: Math.round(sd),
      cv: m ? sd / m : 0,
      series, total: Math.round(series.reduce((s, v) => s + v, 0)),
      months: active.length,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/* ==================== ריכוזיות ==================== */

/** כמה מההוצאה מרוכזת במעט בתי עסק — HHI מנורמל + חלק חמשת הגדולים */
export function concentration(txs, month = null) {
  const rows = spend(month ? txs.filter(t => t.month === month) : txs);
  const total = sum(rows);
  if (!total) return null;
  const by = new Map();
  for (const t of rows) {
    const k = (t.merchant || '').trim() || catLabel(t.dept, t.cat);
    by.set(k, (by.get(k) || 0) + ils(t));
  }
  const vals = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const shares = vals.map(([, v]) => v / total);
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  const n = vals.length;
  return {
    total, merchants: n,
    top5: vals.slice(0, 5),
    top5Share: shares.slice(0, 5).reduce((s, x) => s + x, 0),
    hhi,
    // 0 = מפוזר לגמרי, 1 = הכל בבית עסק אחד
    normalized: n > 1 ? (hhi - 1 / n) / (1 - 1 / n) : 1,
  };
}

/* ==================== דפוס יומי ==================== */

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function weekdayPattern(txs) {
  const acc = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  const seen = new Set();
  for (const t of spend(txs)) {
    const d = new Date(t.dateBuy + 'T00:00:00');
    if (isNaN(d)) continue;
    const w = d.getDay();
    acc[w].total += ils(t);
    acc[w].count++;
    seen.add(t.dateBuy);
  }
  // מנרמלים לממוצע ליום כדי שחודש עם 5 שבתות לא ייראה כמו הרגל
  const daysPerDow = Array.from({ length: 7 }, () => 0);
  for (const iso of seen) daysPerDow[new Date(iso + 'T00:00:00').getDay()]++;
  return acc.map((a, i) => ({
    dow: i, label: DOW_HE[i],
    total: a.total, count: a.count,
    perActiveDay: daysPerDow[i] ? Math.round(a.total / daysPerDow[i]) : 0,
  }));
}

/* ==================== עקומת נטו מצטבר ==================== */

export function cumulativeNet(txs) {
  const months = [...new Set(live(txs).map(t => t.month))].filter(Boolean).sort();
  let acc = 0;
  return months.map(m => {
    const rows = txs.filter(t => t.month === m);
    const i = sum(income(rows)), o = sum(spend(rows));
    acc += i - o;
    return { month: m, in: i, out: o, net: i - o, cumulative: acc };
  });
}

/* ==================== בסיס לתקציב ==================== */

/** חציון 3 החודשים הקודמים — עמיד לחודש חריג, בניגוד ל"מול החודש שעבר" */
export function baseline(txs, month, selector = () => true) {
  const prev = monthsRange(shiftMonth(month, -1), 3);
  const vals = prev.map(m => sum(spend(txs.filter(t => t.month === m)).filter(selector)));
  return { months: prev, values: vals, median: median(vals.filter(v => v > 0)) };
}

/* ==================== השלכה לסוף חודש ==================== */

/**
 * השלכה לינארית פשוטה שקרית בתחילת חודש: שכר דירה, ארנונה וביטוחים
 * נוחתים ב-1 עד ה-5, ולכן ב-2 בחודש "קצב יומי כפול מספר הימים" מנפח
 * אותם פי עשרות. במקום זה מפרידים בין מה שכבר ידוע לבין מה שמשתנה:
 *
 *   צפי = מה שכבר יצא + חיובים קבועים שעוד לא נחתו + קצב משתנה × ימים
 *
 * הקצב המשתנה נלמד מחציון החודשים הקודמים בניכוי הקבוע — לא מהחודש
 * הנוכחי, שבתחילתו אין בו מספיק דגימות.
 */
export function projectMonth(txs, month, recurring = [], today = new Date()) {
  const rows = spend(txs.filter(t => t.month === month));
  const spentSoFar = sum(rows);
  const dim = daysInMonth(month);
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const day = isCurrent ? today.getDate() : dim;
  const daysLeft = Math.max(0, dim - day);

  if (!isCurrent) {
    return { spentSoFar, projected: spentSoFar, daysLeft: 0, remainingFixed: 0, remainingVariable: 0, day, dim };
  }

  // קבועים שעוד לא נחתו החודש
  const seen = new Set(rows.map(t => (t.merchant || '').trim()));
  const remainingFixed = recurring
    .filter(r => !seen.has((r.merchant || '').trim()))
    .filter(r => +r.lastDate.slice(8) > day)
    .reduce((s, r) => s + r.monthly, 0);

  // קצב משתנה מהחודשים הקודמים
  const fixedMonthly = recurring.reduce((s, r) => s + r.monthly, 0);
  const prev = monthsRange(shiftMonth(month, -1), 3);
  const prevTotals = prev.map(m => sum(spend(txs.filter(t => t.month === m)))).filter(v => v > 0);
  const baseline = median(prevTotals);
  const variableMonthly = Math.max(0, baseline - fixedMonthly);
  const remainingVariable = Math.round(variableMonthly * (daysLeft / dim));

  return {
    spentSoFar, remainingFixed, remainingVariable,
    projected: spentSoFar + remainingFixed + remainingVariable,
    daysLeft, day, dim, baseline,
    confident: prevTotals.length >= 2,
  };
}

/* ==================== הוצאה מצטברת יומית ==================== */

/** מערך מצטבר לפי יום בחודש — הבסיס לקו "אני מול עצמי בחודש שעבר" */
export function cumulativeDaily(txs, month, capToday = false, today = new Date()) {
  const dim = daysInMonth(month);
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const last = capToday && isCurrent ? today.getDate() : dim;
  const byDay = new Array(dim + 1).fill(0);
  for (const t of spend(txs.filter(x => x.month === month))) {
    const d = +t.dateBuy.slice(8);
    if (d >= 1 && d <= dim) byDay[d] += ils(t);
  }
  const out = [];
  let acc = 0;
  for (let d = 1; d <= last; d++) { acc += byDay[d]; out.push(acc); }
  return out;
}

/* ==================== מה עומד לרדת ==================== */

/**
 * חיובים צפויים ב-N הימים הקרובים: חיובים חוזרים שזוהו, הוצאות קבועות
 * מוגדרות, ותשלומים פתוחים. זה ההבדל בין "כמה הוצאתי" ל"כמה כבר מחויב".
 */
export function upcoming(txs, recurring = [], fixed = [], days = 30, today = new Date()) {
  const out = [];
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start); end.setDate(end.getDate() + days);

  const nextOccurrence = (dayOfMonth) => {
    const d = new Date(start.getFullYear(), start.getMonth(), Math.min(dayOfMonth, 28));
    if (d < start) d.setMonth(d.getMonth() + 1);
    return d;
  };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  for (const f of fixed) {
    if (f.active === false) continue;
    const when = nextOccurrence(f.day || 1);
    if (when <= end) out.push({ label: f.merchant, amount: f.amount, date: iso(when), kind: 'fixed', dept: f.dept, cat: f.cat });
  }

  const fixedNames = new Set(fixed.map(f => (f.merchant || '').trim()));
  for (const r of recurring) {
    if (fixedNames.has((r.merchant || '').trim())) continue;   // כבר נספר כהוצאה קבועה
    if (r.daysSince > 45) continue;                            // כנראה בוטל
    const day = +r.lastDate.slice(8);
    const when = nextOccurrence(day);
    if (when <= end) out.push({ label: r.merchant, amount: r.monthly, date: iso(when), kind: 'recurring', dept: r.dept, cat: r.cat });
  }

  for (const t of live(txs)) {
    if (!t.installment || t.installment.of <= t.installment.n) continue;
    if (flowOf(t.dept) !== 'out') continue;
    const when = nextOccurrence(+t.dateBuy.slice(8));
    if (when <= end) {
      out.push({
        label: t.merchant || catLabel(t.dept, t.cat), amount: ils(t), date: iso(when),
        kind: 'installment', dept: t.dept, cat: t.cat,
        note: `תשלום ${t.installment.n + 1} מתוך ${t.installment.of}`,
      });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return { items: out, total: out.reduce((s, x) => s + x.amount, 0), days };
}

/* ==================== סיכום לכותרת ==================== */

export function headline(txs, month, budget, recurring = [], today = new Date()) {
  const rate = runRate(txs, month, today);
  const base = baseline(txs, month);
  const attr = attribution(txs, shiftMonth(month, -1), month);
  const conc = concentration(txs, month);
  const fc = forecast(txs, recurring, 3, month);
  const onPace = budget ? rate.projected / budget : null;
  return {
    rate, baseline: base, attribution: attr, concentration: conc, forecast: fc,
    onPace,
    verdict: !budget ? null
      : rate.projected > budget * 1.05 ? 'over'
      : rate.projected < budget * 0.9 ? 'under' : 'on',
  };
}
