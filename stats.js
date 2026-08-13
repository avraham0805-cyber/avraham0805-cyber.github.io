// שכבת סטטיסטיקה — מה שהופך רשימת תנועות להבנה.
// כל פונקציה טהורה: מקבלת תנועות, מחזירה מספרים. אין כאן DOM ואין אחסון.

import { flowOf, dept, catLabel } from './taxonomy.js';
export { flowOf };

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
/** מספר חודשים שלמים בין שני YYYY-MM */
export function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * תשלומים פעילים נכון להיום.
 * שורת "3 מתוך 12" בדף אשראי היא צילום מצב מהחודש שבו הופיעה — חודשיים
 * אחריה נותרו 7, לא 9. בלי יישון, סדרה ישנה מנפחת את התחזית לנצח;
 * ובלי איחוד, כל שורה חודשית של אותה סדרה נספרת שוב במקביל.
 */
export function activeInstallments(txs, today = new Date()) {
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const best = new Map();
  for (const t of live(txs)) {
    if (!t.installment || flowOf(t.dept) !== 'out') continue;
    const aged = t.installment.n + Math.max(0, monthsBetween(t.month, cur));
    const key = `${(t.merchant || '').trim()}|${t.installment.of}|${ils(t)}`;
    const prev = best.get(key);
    if (!prev || aged > prev.aged) best.set(key, { t, aged, of: t.installment.of, left: t.installment.of - aged });
  }
  return [...best.values()].filter(r => r.left > 0);
}

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

  // התחייבויות תשלומים — מיושנות לזמן שעבר ומאוחדות לסדרה אחת,
  // אחרת כל שורת דף-אשראי היסטורית של אותה סדרה נספרת שוב ושוב
  const inst = activeInstallments(txs, new Date(base + '-15T00:00:00'));

  const rows = [];
  let cumulative = 0;
  for (let i = 1; i <= months; i++) {
    const m = shiftMonth(base, i);
    const stillPaying = inst.filter(r => r.left >= i);
    const instThis = stillPaying.reduce((s, r) => s + ils(r.t), 0);
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
    // היציבות נמדדת מחודש הלידה של הקטגוריה — אפסים מלפני שהתחילה
    // לחיות אינם תנודתיות, הם היעדר, והם ניפחו cv לקטגוריות חדשות
    const born = series.findIndex(v => v > 0);
    const lived = series.slice(born);
    const m = mean(lived), sd = stdev(lived);
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

/* ==================== יתרות ושווי נקי ==================== */

/**
 * האפליקציה עוקבת אחרי תזרים, לא אחרי מלאי. כדי לענות על "כמה יש לי"
 * נדרשת נקודת עיגון אחת: יתרה שהוזנה ידנית ותאריך שאליו היא נכונה.
 * משם והלאה כל תנועה מזיזה אותה — הכנסה מוסיפה, הוצאה מחסירה,
 * והעברה בין חשבונות לא משנה את הסך הכולל.
 */
export function balances(txs, accounts, today = new Date()) {
  const rows = live(txs);
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const out = accounts.map(a => {
    const anchored = !!a.balanceDate;
    // העוגן הוא היתרה **בתחילת** התאריך שנבחר, ולכן תנועות מאותו יום
    // ואילך נספרות. עם > במקום >= הוצאה שנרשמת מיד אחרי העדכון לא הייתה
    // מזיזה את היתרה, וזה נראה כמו תקלה.
    const since = anchored
      ? rows.filter(t => effectOn(a, t) !== 0 && t.dateBuy >= a.balanceDate && t.dateBuy <= iso)
      : [];
    const inflow = since.reduce((s, t) => s + Math.max(0, effectOn(a, t)), 0);
    const outflow = since.reduce((s, t) => s + Math.max(0, -effectOn(a, t)), 0);
    return {
      id: a.id, name: a.name, slot: a.slot, type: a.type,
      anchored,
      anchor: a.balance || 0, anchorDate: a.balanceDate || null,
      inflow, outflow, movement: inflow - outflow,
      current: anchored ? (a.balance || 0) + inflow - outflow : null,
      moves: since.length,
    };
  });
  const known = out.filter(a => a.anchored);
  return {
    accounts: out,
    netWorth: known.reduce((s, a) => s + a.current, 0),
    covered: known.length,
    total: accounts.length,
    complete: known.length === accounts.length && accounts.length > 0,
    // הישן ביותר קובע עד כמה המספר טרי
    oldestAnchor: known.length ? known.map(a => a.anchorDate).sort()[0] : null,
  };
}

/* ==================== תקציב לפי קטגוריה ==================== */

/**
 * budgets: [{key:'dept' | 'dept/cat', amount}]
 * מחזיר מצב לכל תקציב מוגדר, כולל קצב — האם ההוצאה מקדימה את החודש.
 */
export function budgetStatus(txs, budgets, month, today = new Date()) {
  const rows = spend(txs.filter(t => t.month === month));
  const dim = daysInMonth(month);
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const elapsed = isCurrent ? today.getDate() / dim : 1;

  const spentFor = (key) => {
    const [d, c] = key.split('/');
    return rows.filter(t => (c ? t.dept === d && t.cat === c : t.dept === d))
      .reduce((s, t) => s + ils(t), 0);
  };

  // מפתחות goal: הם יעדי חיסכון שחיים באותו מחסן — לא תקציבי הוצאה
  const items = budgets.filter(b => b.amount > 0 && !b.key.startsWith('goal:')).map(b => {
    const spentV = spentFor(b.key);
    const [d, c] = b.key.split('/');
    const ratio = b.amount ? spentV / b.amount : 0;
    // "מקדים" = הוצאת יותר ממה שהיה צפוי לפי החלק שעבר מהחודש
    const pace = elapsed > 0 ? ratio / elapsed : 0;
    return {
      key: b.key, dept: d, cat: c || null,
      label: c ? catLabel(d, c) : (dept(d)?.label || d),
      amount: b.amount, spent: spentV, left: b.amount - spentV,
      ratio, pace,
      state: ratio > 1 ? 'over' : pace > 1.15 ? 'ahead' : ratio > 0 ? 'ok' : 'unused',
    };
  });
  items.sort((a, b) => b.ratio - a.ratio);
  return {
    items, elapsed,
    totalBudget: items.reduce((s, i) => s + i.amount, 0),
    totalSpent: items.reduce((s, i) => s + i.spent, 0),
    over: items.filter(i => i.state === 'over').length,
    ahead: items.filter(i => i.state === 'ahead').length,
  };
}

/* ==================== כמה באמת פנוי ==================== */

/**
 * "נשאר להוציא" תמים משקר: הוא לא יודע ששכר הדירה עוד לא ירד.
 * הענף כולו פתר את זה באותו אופן — PocketGuard קורא לזה In My Pocket,
 * Copilot קורא לזה spending line. העיקרון זהה: מחסירים את מה שכבר ידוע
 * שעומד לרדת, ורק מה שנשאר הוא באמת פנוי.
 */
export function safeToSpend(txs, budget, month, upcomingTotal = 0, today = new Date()) {
  if (!budget) return null;
  const spent = sum(spend(txs.filter(t => t.month === month)));
  const dim = daysInMonth(month);
  const isCurrent = month === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const daysLeft = isCurrent ? Math.max(1, dim - today.getDate() + 1) : 0;

  const rawLeft = budget - spent;
  const committed = Math.min(Math.max(0, upcomingTotal), Math.max(0, rawLeft));
  const free = rawLeft - committed;

  return {
    budget, spent, rawLeft, committed, free, daysLeft,
    perDay: daysLeft ? Math.floor(free / daysLeft) : free,
    // בלי החיוב הידוע המספר היה גבוה בזה
    inflated: daysLeft ? Math.floor(rawLeft / daysLeft) - Math.floor(free / daysLeft) : 0,
  };
}

/* ==================== גלגול תקציב ==================== */

/**
 * יתרה שלא נוצלה מתגלגלת קדימה. זו הדרישה הנפוצה ביותר בענף —
 * PocketGuard, Monarch, Lunch Money ו-PocketSmith כולם מימשו אותה,
 * כי בלעדיה חודש חריג אחד הופך כל תקציב שנתי ללא-רלוונטי.
 * הגלגול מצטבר אחורה עד חודש הפתיחה של התקציב.
 */
export function rollover(txs, budgets, month, back = 12) {
  const byKey = new Map();

  for (const b of budgets) {
    if (!b.rollover || !b.amount) { byKey.set(b.key, 0); continue; }
    // מגלגלים רק מהחודש שבו התקציב הוגדר. בלי העוגן הזה, הפעלת גלגול
    // "מגלה" יתרה של חודשים שבהם התקציב כלל לא היה קיים — מתנה מדומה.
    // החלון מתרחב לפי since — אחרת תקציב ותיק מ-13+ חודשים היה מאבד
    // בשקט את העודפים שמעבר לחלון הקבוע.
    const from = b.since || month;
    const span = Math.max(back, monthsBetween(from, month) + 1);
    let carry = 0;
    for (const m of monthsRange(month, span).slice(0, -1)) {
      if (m < from) continue;
      const item = budgetStatus(txs, [b], m).items[0];
      if (!item) continue;
      carry = Math.max(0, carry + item.amount - item.spent);
    }
    byKey.set(b.key, carry);
  }
  return byKey;
}

/* ==================== תגיות ==================== */

export function tagTotals(txs, month = null) {
  const rows = spend(month ? txs.filter(t => t.month === month) : txs);
  const acc = new Map();
  for (const t of rows) {
    for (const tag of (t.tags || [])) {
      const e = acc.get(tag) || { tag, total: 0, count: 0 };
      e.total += ils(t); e.count++;
      acc.set(tag, e);
    }
  }
  return [...acc.values()].sort((a, b) => b.total - a.total);
}

export function allTags(txs) {
  const s = new Set();
  for (const t of txs) for (const tag of (t.tags || [])) s.add(tag);
  return [...s].sort();
}

/* ==================== שווי נקי לאורך זמן ==================== */

/**
 * יתרת חשבון בסוף תאריך נתון, מחושבת מהעוגן לשני הכיוונים.
 * העוגן הוא תחילת balanceDate, ולכן קדימה נספרים ימים מ-balanceDate
 * ואילך, ואחורה מוחסרים הימים שבין התאריך המבוקש לעוגן — לא כולל
 * את יום העוגן עצמו, שתנועותיו קרו אחרי רגע העיגון.
 */
/**
 * ההשפעה של תנועה על חשבון נתון.
 * העברה (transfer) עוזבת את חשבון המקור — היא לא הוצאה בסטטיסטיקה,
 * אבל הכסף כן יצא מהחשבון. משיכת מזומן היא ההעברה היחידה שהיעד שלה
 * ידוע (הארנק), ולכן היא גם נכנסת לחשבון המזומן. בלי זה יתרות
 * החשבונות נסחפו מהמציאות כבר מהמשיכה הראשונה.
 */
function effectOn(account, t) {
  const f = flowOf(t.dept);
  if (t.account === account.id) {
    if (f === 'in') return ils(t);
    return -ils(t);                       // הוצאה וגם העברה — הכסף עוזב את המקור
  }
  if (account.type === 'cash' && t.dept === 'transfer' && t.cat === 'withdrawal') return ils(t);
  return 0;
}

export function balanceAt(txs, account, dateISO) {
  if (!account.balanceDate) return null;
  const rows = live(txs).filter(t => effectOn(account, t) !== 0);
  if (dateISO >= account.balanceDate) {
    return (account.balance || 0) + rows
      .filter(t => t.dateBuy >= account.balanceDate && t.dateBuy <= dateISO)
      .reduce((s, t) => s + effectOn(account, t), 0);
  }
  return (account.balance || 0) - rows
    .filter(t => t.dateBuy > dateISO && t.dateBuy < account.balanceDate)
    .reduce((s, t) => s + effectOn(account, t), 0);
}

/** סדרת שווי נקי חודשית — סוף כל חודש, והחודש הנוכחי עד היום */
export function netWorthSeries(txs, accounts, months = 12, today = new Date()) {
  const anchored = accounts.filter(a => a.balanceDate && a.active !== false);
  if (!anchored.length) return [];
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const firstTx = live(txs).map(t => t.month).filter(Boolean).sort()[0] || cur;
  const ms = monthsRange(cur, months).filter(m => m >= firstTx);
  if (!ms.length) return [];
  return ms.map(m => {
    const endDay = m === cur ? today.getDate() : daysInMonth(m);
    const date = `${m}-${String(endDay).padStart(2, '0')}`;
    return { month: m, date, total: anchored.reduce((s, a) => s + (balanceAt(txs, a, date) ?? 0), 0) };
  });
}

/* ==================== שיעור חיסכון ==================== */

/**
 * כמה מההכנסה הפכה לחיסכון (transfer/invest) וכמה נשארה נטו.
 * זה המדד שהענף כולו מסתיר מאחורי גרפים של הוצאות: לא כמה יצא —
 * כמה מכל שקל שנכנס נשאר אצלך.
 */
export function savingsRateSeries(txs, months = 6, today = new Date()) {
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  return monthsRange(cur, months).map(m => {
    const rows = live(txs.filter(t => t.month === m));
    const inc = rows.filter(t => flowOf(t.dept) === 'in').reduce((s, t) => s + ils(t), 0);
    const sav = rows.filter(t => t.dept === 'transfer' && t.cat === 'invest').reduce((s, t) => s + ils(t), 0);
    const out = rows.filter(t => flowOf(t.dept) === 'out').reduce((s, t) => s + ils(t), 0);
    return { month: m, income: inc, saved: sav, out, rate: inc ? sav / inc : null };
  });
}

/* ==================== הון לפי אפיק ==================== */

/** כמה נצבר בכל יעד חיסכון — קופות, ברוקר, חסכונות — מאז שהתחלת לתעד */
export function wealthByDestination(txs, today = new Date()) {
  const rows = live(txs).filter(t => t.dept === 'transfer' && t.cat === 'invest');
  const by = new Map();
  for (const t of rows) {
    const k = (t.merchant || 'ללא שם').trim();
    if (!by.has(k)) by.set(k, { name: k, total: 0, count: 0, byMonth: new Map(), first: t.month });
    const e = by.get(k);
    e.total += ils(t); e.count++;
    e.byMonth.set(t.month, (e.byMonth.get(t.month) || 0) + ils(t));
    if (t.month < e.first) e.first = t.month;
  }
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthsLeft = 12 - today.getMonth() - 1;
  return [...by.values()].map(e => {
    const recent = monthsRange(cur, 3).map(m => e.byMonth.get(m) || 0).filter(v => v > 0);
    const monthly = median(recent);
    return {
      name: e.name, total: e.total, count: e.count, first: e.first, monthly,
      series: monthsRange(cur, 6).map(m => e.byMonth.get(m) || 0),
      projectedYearEnd: e.total + monthly * monthsLeft,
    };
  }).sort((a, b) => b.total - a.total);
}

/* ==================== מסחר — שורה תחתונה ==================== */

/**
 * ההכנסות מהמסחר מול כל עלויות המסחר, חודש בחודש. עונה על השאלה
 * שאף גרף הוצאות לא עונה עליה: האם הפעילות הזו מרוויחה אחרי הכל.
 */
export function tradingPnL(txs, months = 12, today = new Date()) {
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const rows = monthsRange(cur, months).map(m => {
    const mtx = live(txs.filter(t => t.month === m));
    const inc = mtx.filter(t => t.dept === 'income' && (t.cat === 'payout' || t.cat === 'dividend'))
      .reduce((s, t) => s + ils(t), 0);
    const cost = mtx.filter(t => t.dept === 'trading').reduce((s, t) => s + ils(t), 0);
    return { month: m, income: inc, cost, net: inc - cost };
  }).filter(r => r.income || r.cost);
  let acc = 0;
  for (const r of rows) { acc += r.net; r.cumulative = acc; }
  return {
    rows,
    income: rows.reduce((s, r) => s + r.income, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    net: rows.reduce((s, r) => s + r.net, 0),
  };
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

  // קבועים שעוד לא נחתו החודש. בכוונה בלי תנאי "היום הרגיל כבר עבר" —
  // חיוב קבוע שמאחר עדיין צפוי לרדת החודש, והשמטתו הטתה את התחזית מטה.
  const seen = new Set(rows.map(t => (t.merchant || '').trim()));
  const remainingFixed = recurring
    .filter(r => !seen.has((r.merchant || '').trim()))
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

  // יום 29-31 נצמד לסוף החודש האמיתי של אותו חודש — לא ל-28 שרירותי,
  // שהזיז חיובי סוף-חודש יומיים ולפעמים הכניס/הוציא אותם מהחלון בטעות
  const nextOccurrence = (dayOfMonth) => {
    const at = (y, m) => new Date(y, m, Math.min(dayOfMonth || 1, new Date(y, m + 1, 0).getDate()));
    let d = at(start.getFullYear(), start.getMonth());
    if (d < start) d = at(start.getFullYear(), start.getMonth() + 1);
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
    const day = +(r.lastDate || '').slice(8) || 1;
    const when = nextOccurrence(day);
    if (when <= end) out.push({ label: r.merchant, amount: r.monthly, date: iso(when), kind: 'recurring', dept: r.dept, cat: r.cat });
  }

  // תשלומים — מיושנים ומאוחדים, אחרת סדרות שנגמרו מזמן ממשיכות להופיע
  for (const rec of activeInstallments(txs, today)) {
    const when = nextOccurrence(+rec.t.dateBuy.slice(8));
    if (when <= end) {
      out.push({
        label: rec.t.merchant || catLabel(rec.t.dept, rec.t.cat), amount: ils(rec.t), date: iso(when),
        kind: 'installment', dept: rec.t.dept, cat: rec.t.cat,
        note: `תשלום ${Math.min(rec.aged + 1, rec.of)} מתוך ${rec.of}`,
      });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return { items: out, total: out.reduce((s, x) => s + x.amount, 0), days };
}

// headline() הישן הוסר: הוא השווה חודש קודם מלא מול חודש נוכחי חלקי —
// באמצע חודש הכל נראה כאילו "ירד". הממשק משתמש ב-projectMonth וב-attribution
// ישירות, עם השוואות הוגנות בלבד.
