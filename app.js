import * as DB from './db.js';
import * as AI from './ai.js';
import {
  DEPTS, QUICK_SEED, dept, cat, pathLabel, flowOf, defaultsFor,
  KIND_LABEL, NEED_LABEL, SCOPE_LABEL, METHOD_LABEL,
} from './taxonomy.js';

/* ==================== עזרים ==================== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const curMonth = () => todayISO().slice(0, 7);

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `${MONTHS_HE[+mo - 1]} ${y}`;
};
const shiftMonth = (m, by) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const daysInMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
};

const money = (agorot, sign = '') => {
  const v = (agorot || 0) / 100;
  const s = Math.abs(v).toLocaleString('he-IL', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2,
  });
  return `${sign}₪${s}`;
};
const moneyShort = (agorot) => {
  const v = Math.abs((agorot || 0) / 100);
  if (v >= 10000) return '₪' + Math.round(v / 1000) + 'K';
  return money(agorot);
};
const toAgorot = (str) => Math.round(parseFloat(String(str).replace(/,/g, '')) * 100) || 0;

const CUR_SIGN = { ILS: '₪', USD: '$', EUR: '€', GBP: '£', OTHER: '¤' };

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), ms);
}

function openSheet(id)  { $('#' + id).classList.add('on'); document.body.style.overflow = 'hidden'; }
function closeSheet(id) { $('#' + id).classList.remove('on'); document.body.style.overflow = ''; }
function closeAllSheets() { $$('.sheet.on').forEach(s => s.classList.remove('on')); document.body.style.overflow = ''; }

/* ==================== מצב ==================== */

const S = {
  txs: [], rules: [], fixed: [],
  budget: 0, fx: { USD: 3.7, EUR: 4.0, GBP: 4.7 },
  month: curMonth(),
  view: 'home',
  q: '', filter: 'all', deptFilter: null,
  lastExport: 0,
  hasKey: false,
};

/** סכום התנועה בשקלים (אגורות) */
const ils = (t) => t.ils ?? t.amount ?? 0;

/** תנועות שנחשבות לסטטיסטיקה — בלי כפילויות */
const counted = (list) => list.filter(t => !t.dupOf);

/* ==================== אתחול ==================== */

async function init() {
  await DB.open();
  await reload();

  S.budget     = await DB.setting('budget', 0);
  S.fx         = await DB.setting('fx', S.fx);
  S.lastExport = await DB.setting('lastExport', 0);
  S.hasKey     = !!(await DB.setting('geminiKey'));

  await applyFixedForMonth(curMonth());
  wire();
  render();

  // צילומים שהגיעו דרך "שיתוף" מהטלפון
  const pend = await DB.all('pending');
  if (pend.length || new URLSearchParams(location.search).has('shared')) {
    history.replaceState({}, '', location.pathname);
    if (pend.length) openShot(pend.map(p => p.blob), pend.map(p => p.id));
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function reload() {
  [S.txs, S.rules, S.fixed] = await Promise.all([DB.allTx(), DB.all('rules'), DB.all('fixed')]);
}

/* ==================== הוצאות קבועות ==================== */

async function applyFixedForMonth(month) {
  if (!S.fixed.length) return;
  const day = (n) => `${month}-${String(Math.min(n || 1, daysInMonth(month))).padStart(2, '0')}`;
  const existing = new Set(S.txs.filter(t => t.month === month && t.fixedId).map(t => t.fixedId));
  const add = [];
  for (const f of S.fixed) {
    if (!f.active) continue;
    if (existing.has(f.id)) continue;
    if (f.startMonth && month < f.startMonth) continue;
    add.push(mkTx({
      dateBuy: day(f.day), merchant: f.merchant, amount: f.amount, ils: f.amount,
      dept: f.dept, cat: f.cat, kind: 'fixed', need: f.need || 'essential',
      scope: f.scope || 'personal', method: f.method || 'bank',
      note: 'הוצאה קבועה', source: 'recurring', fixedId: f.id, confidence: 1,
    }));
  }
  if (add.length) { await DB.saveTxMany(add); await reload(); }
}

/* ==================== יצירת תנועה ==================== */

function mkTx(p) {
  const d = defaultsFor(p.dept, p.cat);
  return {
    id: p.id || DB.uid(),
    ts: Date.now(),
    dateBuy: p.dateBuy || todayISO(),
    dateCharge: p.dateCharge || null,
    merchant: (p.merchant || '').trim(),
    amount: p.amount || 0,
    currency: p.currency || 'ILS',
    ils: p.ils ?? p.amount ?? 0,
    dept: p.dept || 'food',
    cat: p.cat || 'general',
    kind: p.kind || d.kind,
    need: p.need || d.need,
    scope: p.scope || d.scope,
    method: p.method || 'cash',
    installment: p.installment || null,
    note: p.note || '',
    source: p.source || 'manual',
    confidence: p.confidence ?? 1,
    needsReview: !!p.needsReview,
    dupOf: p.dupOf || null,
    raw: p.raw || '',
    fixedId: p.fixedId || null,
    month: (p.dateBuy || todayISO()).slice(0, 7),
  };
}

function toILS(amount, currency) {
  if (!currency || currency === 'ILS') return amount;
  const rate = S.fx[currency] || 1;
  return Math.round(amount * rate);
}

/* ==================== חישובי חודש ==================== */

function statsFor(month) {
  const rows = counted(S.txs.filter(t => t.month === month));
  const st = {
    out: 0, in: 0, byDept: {}, byCat: {}, byMerchant: {},
    kind: { fixed: 0, variable: 0, oneoff: 0 },
    need: { essential: 0, discretionary: 0 },
    scope: { personal: 0, business: 0 },
    count: rows.length,
  };
  for (const t of rows) {
    const f = flowOf(t.dept);
    const v = ils(t);
    if (f === 'in') { st.in += v; continue; }
    if (f === 'neutral') continue;
    st.out += v;
    st.byDept[t.dept] = (st.byDept[t.dept] || 0) + v;
    const ck = `${t.dept}/${t.cat}`;
    st.byCat[ck] = (st.byCat[ck] || 0) + v;
    const mk = (t.merchant || 'ללא שם').trim();
    st.byMerchant[mk] = (st.byMerchant[mk] || 0) + v;
    st.kind[t.kind] = (st.kind[t.kind] || 0) + v;
    st.need[t.need] = (st.need[t.need] || 0) + v;
    st.scope[t.scope] = (st.scope[t.scope] || 0) + v;
  }
  st.net = st.in - st.out;
  return st;
}

/* ==================== רינדור ==================== */

function render() {
  $$('.view').forEach(v => v.classList.remove('on'));
  $('#v-' + S.view).classList.add('on');
  $$('nav.bottom button[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === S.view));
  ({ home: renderHome, month: renderMonth, all: renderAll, set: renderSettings })[S.view]();
}

/* ---------- בית ---------- */

function renderHome() {
  const m = curMonth();
  const st = statsFor(m);
  const d = new Date();
  $('#home-date').textContent = d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  // המספר הגדול
  if (S.budget > 0) {
    const left = S.budget - st.out;
    const daysLeft = Math.max(1, daysInMonth(m) - d.getDate() + 1);
    const perDay = Math.floor(left / daysLeft);
    $('#hero-lbl').textContent = 'נשאר להוציא היום';
    $('#hero-big').innerHTML = perDay >= 0
      ? money(perDay)
      : `<span class="neg">${money(perDay, '-')}</span>`;
    $('#hero-big').classList.toggle('neg', perDay < 0);
    const pct = Math.min(100, Math.round(st.out / S.budget * 100));
    $('#hero-bar').style.width = pct + '%';
    $('#hero-bar').classList.toggle('over', st.out > S.budget);
    $('#hero-foot').textContent =
      `${money(st.out)} מתוך ${money(S.budget)} · ${daysLeft} ימים נותרו`;
  } else {
    $('#hero-lbl').textContent = 'הוצאת החודש';
    $('#hero-big').textContent = money(st.out);
    $('#hero-big').classList.remove('neg');
    $('#hero-bar').style.width = '0%';
    $('#hero-foot').innerHTML = '<button id="go-budget" style="color:var(--accent);text-decoration:underline">הגדר תקציב חודשי</button> כדי לראות כמה נשאר להיום';
  }

  // פסי התראה
  const strips = [];
  const review = S.txs.filter(t => t.needsReview).length;
  if (review) strips.push(`<div class="strip info"><span>🔎</span><span class="grow">${review} תנועות ממתינות לאישור</span><button data-act="review">פתח</button></div>`);
  if (!S.hasKey) strips.push(`<div class="strip warn"><span>🔑</span><span class="grow">לא הוגדר מפתח Gemini — פענוח צילומים כבוי</span><button data-act="tosettings">הגדר</button></div>`);
  if (S.txs.length > 5) {
    const days = S.lastExport ? Math.floor((Date.now() - S.lastExport) / 864e5) : 999;
    if (days > 7) strips.push(`<div class="strip warn"><span>💾</span><span class="grow">${S.lastExport ? `גיבוי אחרון לפני ${days} ימים` : 'עוד לא גיבית את הנתונים'}</span><button data-act="export">גבה עכשיו</button></div>`);
  }
  $('#home-strips').innerHTML = strips.join('');

  renderQuickChips();

  const recent = S.txs.slice(0, 6);
  $('#home-recent').innerHTML = recent.length
    ? recent.map(txRow).join('')
    : '<div class="center">אין עדיין תנועות.<br>הקש + להוספה או 📷 לצילום מסך.</div>';
}

function renderQuickChips() {
  // שמונה הכפתורים מסתדרים לפי השימוש בפועל, עם זרע התחלתי
  const freq = {};
  for (const t of S.txs) {
    if (flowOf(t.dept) !== 'out') continue;
    const k = `${t.dept}/${t.cat}`;
    freq[k] = (freq[k] || 0) + 1;
  }
  const seeded = QUICK_SEED.map(([d, c]) => `${d}/${c}`);
  const keys = [...new Set([
    ...Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0]),
    ...seeded,
  ])].slice(0, 8);

  $('#quick-chips').innerHTML = keys.map(k => {
    const [dk, ck] = k.split('/');
    const D = dept(dk), C = cat(dk, ck);
    if (!D || !C) return '';
    const label = C.key === 'general' ? D.label : C.label;
    return `<button class="chip" data-quick="${k}" aria-label="${esc(pathLabel(dk, ck))}">
      <span class="ic" aria-hidden="true">${D.icon}</span><span class="tx">${esc(label)}</span></button>`;
  }).join('');
}

function txRow(t) {
  const D = dept(t.dept);
  const f = flowOf(t.dept);
  const cls = f === 'in' ? 'in' : f === 'neutral' ? 'neutral' : '';
  const sign = f === 'in' ? '+' : f === 'neutral' ? '' : '';
  const inst = t.installment ? `<span class="tag">${t.installment.n}/${t.installment.of}</span>` : '';
  const dup = t.dupOf ? '<span class="tag dup">כפילות</span>' : '';
  const rev = t.needsReview ? '<span class="tag rev">לאישור</span>' : '';
  const biz = t.scope === 'business' ? '<span class="tag">עסקי</span>' : '';
  const foreign = t.currency !== 'ILS'
    ? `<span class="tag">${CUR_SIGN[t.currency] || ''}${(t.amount / 100).toLocaleString('he-IL')}</span>` : '';
  return `<div class="tx" data-tx="${t.id}">
    <div class="ic" style="color:${D?.color || '#888'}">${D?.icon || '•'}</div>
    <div class="mid">
      <div class="nm">${esc(t.merchant || pathLabel(t.dept, t.cat))}${inst}${dup}${rev}${biz}${foreign}</div>
      <div class="mt">${esc(pathLabel(t.dept, t.cat))} · ${t.dateBuy.slice(8)}.${t.dateBuy.slice(5, 7)} · ${METHOD_LABEL[t.method] || ''}${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    <div class="amt ${cls}">${sign}${money(ils(t))}</div>
  </div>`;
}

/* ---------- חודש ---------- */

function renderMonth() {
  const m = S.month;
  const st = statsFor(m);
  const prev = statsFor(shiftMonth(m, -1));
  $('#m-label').textContent = monthLabel(m);
  $('#m-next').style.visibility = m >= curMonth() ? 'hidden' : 'visible';

  const diff = prev.out ? Math.round((st.out - prev.out) / prev.out * 100) : 0;
  $('#month-sub').textContent = st.count
    ? `${st.count} תנועות${prev.out ? ` · ${diff >= 0 ? '+' : ''}${diff}% מהחודש שעבר` : ''}`
    : 'אין תנועות בחודש זה';

  $('#m-out').textContent = money(st.out);
  $('#m-in').textContent = money(st.in);
  $('#m-net').textContent = money(st.net, st.net < 0 ? '-' : '');
  $('#m-net').style.color = st.net < 0 ? 'var(--bad)' : 'var(--good)';

  $('#m-kind').innerHTML = barList(
    Object.entries(st.kind).filter(e => e[1] > 0)
      .map(([k, v]) => ({ nm: KIND_LABEL[k], v, color: { fixed: '#60a5fa', variable: '#f2c94c', oneoff: '#bb6bd9' }[k] })),
    st.out) || emptyMsg();

  $('#m-need').innerHTML = barList(
    Object.entries(st.need).filter(e => e[1] > 0)
      .map(([k, v]) => ({ nm: NEED_LABEL[k], v, color: k === 'essential' ? '#4ade80' : '#fb923c' })),
    st.out) || emptyMsg();

  $('#m-depts').innerHTML = barList(
    Object.entries(st.byDept).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ nm: `${dept(k)?.icon || ''} ${dept(k)?.label || k}`, v, color: dept(k)?.color, key: k })),
    st.out, true) || emptyMsg();

  $('#m-merch').innerHTML = barList(
    Object.entries(st.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, v]) => ({ nm: k, v, color: '#6b7688' })),
    st.out) || emptyMsg();

  renderInstallments();
}

function emptyMsg() { return '<div class="center" style="padding:14px">—</div>'; }

function barList(items, total, expandable = false) {
  if (!items.length) return '';
  return items.map(it => `
    <div class="row" ${expandable && it.key ? `data-dept="${it.key}" style="cursor:pointer"` : ''}>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:baseline">
          <div class="nm">${esc(it.nm)}</div>
          <div class="pc num">${total ? Math.round(it.v / total * 100) : 0}%</div>
          <div class="v num">${money(it.v)}</div>
        </div>
        <div class="mbar"><i style="width:${total ? (it.v / total * 100) : 0}%;background:${it.color || '#666'}"></i></div>
      </div>
    </div>`).join('');
}

function renderInstallments() {
  const future = [];
  for (const t of counted(S.txs)) {
    if (!t.installment || flowOf(t.dept) !== 'out') continue;
    const { n, of } = t.installment;
    if (!(of > n)) continue;
    future.push({ merchant: t.merchant, per: ils(t), left: of - n, total: (of - n) * ils(t), dept: t.dept });
  }
  if (!future.length) {
    $('#m-inst').innerHTML = '<div class="center" style="padding:14px">אין תשלומים פתוחים</div>';
    return;
  }
  future.sort((a, b) => b.total - a.total);
  const sum = future.reduce((s, f) => s + f.total, 0);
  $('#m-inst').innerHTML =
    `<div class="split" style="margin-bottom:12px"><div><div class="k">סה״כ מחויב קדימה</div><div class="v num">${money(sum)}</div></div></div>` +
    future.map(f => `<div class="row">
      <div class="ic" style="width:8px"></div>
      <div class="nm">${esc(f.merchant || pathLabel(f.dept, ''))} <span class="tag">עוד ${f.left}</span></div>
      <div class="v num">${money(f.total)}</div>
    </div>`).join('');
}

/* ---------- הכל ---------- */

const FILTERS = [
  ['all', 'הכל'], ['review', 'לאישור'], ['cash', 'מזומן'], ['credit', 'אשראי'],
  ['business', 'עסקי'], ['fixed', 'קבוע'], ['discretionary', 'רשות'], ['income', 'הכנסות'],
  ['transfer', 'העברות'], ['dup', 'כפילויות'],
];

function renderAll() {
  const D = S.deptFilter ? dept(S.deptFilter) : null;
  $('#filters').innerHTML =
    (D ? `<button data-f="cleardept" class="on">${D.icon} ${esc(D.label)} ✕</button>` : '') +
    FILTERS.map(([k, l]) =>
      `<button data-f="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`).join('');

  let rows = S.txs;
  if (S.deptFilter) rows = rows.filter(t => t.dept === S.deptFilter);
  const q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter(t =>
    (t.merchant || '').toLowerCase().includes(q) ||
    (t.note || '').toLowerCase().includes(q) ||
    pathLabel(t.dept, t.cat).toLowerCase().includes(q));

  const F = S.filter;
  if (F === 'review')       rows = rows.filter(t => t.needsReview);
  else if (F === 'cash')    rows = rows.filter(t => t.method === 'cash');
  else if (F === 'credit')  rows = rows.filter(t => t.method === 'credit');
  else if (F === 'business') rows = rows.filter(t => t.scope === 'business');
  else if (F === 'fixed')   rows = rows.filter(t => t.kind === 'fixed');
  else if (F === 'discretionary') rows = rows.filter(t => t.need === 'discretionary' && flowOf(t.dept) === 'out');
  else if (F === 'income')  rows = rows.filter(t => flowOf(t.dept) === 'in');
  else if (F === 'transfer') rows = rows.filter(t => flowOf(t.dept) === 'neutral');
  else if (F === 'dup')     rows = rows.filter(t => t.dupOf);

  const sum = counted(rows).filter(t => flowOf(t.dept) === 'out').reduce((s, t) => s + ils(t), 0);
  $('#all-sub').textContent = `${rows.length} תנועות · ${money(sum)}`;

  $('#all-list').innerHTML = rows.length
    ? rows.slice(0, 400).map(txRow).join('') + (rows.length > 400 ? '<div class="center">מוצגות 400 הראשונות</div>' : '')
    : '<div class="center">לא נמצאו תנועות</div>';
}

/* ---------- הגדרות ---------- */

async function renderSettings() {
  $('#s-budget').value = S.budget ? S.budget / 100 : '';
  $('#s-count').textContent = `${S.txs.length} תנועות · ${S.rules.length} כללים`;
  $('#s-backupinfo').textContent = S.lastExport
    ? `גיבוי אחרון: ${new Date(S.lastExport).toLocaleString('he-IL')}`
    : 'עוד לא בוצע גיבוי. הנתונים קיימים רק על המכשיר הזה.';

  const key = await DB.setting('geminiKey');
  $('#s-key').value = key || '';
  const opts = await DB.setting('geminiModelOptions', []);
  const chosen = await DB.setting('geminiModel');
  if (opts.length) {
    $('#s-modelwrap').style.display = 'block';
    $('#s-model').innerHTML = opts.map(o =>
      `<option value="${esc(o)}" ${o === chosen ? 'selected' : ''}>${esc(o.replace('models/', ''))}</option>`).join('');
  }

  $('#s-fixed').innerHTML = S.fixed.length
    ? S.fixed.map(f => `<div class="tx" data-fixed="${f.id}">
        <div class="ic">${dept(f.dept)?.icon || '•'}</div>
        <div class="mid"><div class="nm">${esc(f.merchant)}${f.active ? '' : '<span class="tag">כבוי</span>'}</div>
        <div class="mt">${esc(pathLabel(f.dept, f.cat))} · ב-${f.day} לחודש</div></div>
        <div class="amt">${money(f.amount)}</div></div>`).join('')
    : '<div class="muted">לא הוגדרו הוצאות קבועות.</div>';

  const top = [...S.rules].sort((a, b) => (b.hits || 0) - (a.hits || 0)).slice(0, 8);
  $('#s-rules').innerHTML = S.rules.length
    ? `${S.rules.length} בתי עסק נלמדו. הנפוצים: ` +
      top.map(r => `${esc(r.merchant || r.key)} → ${esc(pathLabel(r.dept, r.cat))}`).join(' · ')
    : 'המילון ריק. כל תיוג שתעשה נשמר כאן ולא יישאל שוב.';
}

/* ==================== הוספה מהירה ==================== */

const ADD = {
  amount: '', dept: 'food', cat: 'general', method: 'cash',
  date: todayISO(), merchant: '', income: false, business: false, currency: 'ILS',
  editId: null,
};

function openAdd(preset = {}) {
  Object.assign(ADD, {
    amount: '', dept: 'food', cat: 'general', method: 'cash',
    date: todayISO(), merchant: '', income: false, business: false, currency: 'ILS',
    editId: null, _touched: false,
  }, preset);
  $('#add-title').textContent = ADD.editId ? 'עריכת תנועה' : 'הוצאה חדשה';
  $('#add-merch').value = ADD.merchant;
  $('#add-date').value = ADD.date;
  drawAdd();
  openSheet('sh-add');
}

function drawAdd() {
  // שומר בדיוק את מה שהוקלד — כולל אפס אחרי הנקודה — ומוסיף מפרידי אלפים
  const el = $('#add-amt');
  const [whole, frac] = (ADD.amount || '').split('.');
  el.textContent = ADD.amount
    ? Number(whole || 0).toLocaleString('he-IL') + (frac !== undefined ? '.' + frac : '')
    : '0';
  el.classList.toggle('zero', !ADD.amount);
  $('#add-cur').textContent = ' ' + (CUR_SIGN[ADD.currency] || '₪');

  // קטגוריות מהירות בתוך המגירה
  const list = ADD.income
    ? dept('income').cats.map(c => ['income', c.key, c.label])
    : QUICK_SEED.map(([d, c]) => [d, c, cat(d, c).key === 'general' ? dept(d).label : cat(d, c).label]);
  $('#add-quickcats').innerHTML = list.map(([d, c, l]) =>
    `<button class="opt ${ADD.dept === d && ADD.cat === c ? 'on' : ''}" data-setcat="${d}/${c}">${esc(l)}</button>`).join('');

  $('#add-catbtn').textContent = pathLabel(ADD.dept, ADD.cat);

  $('#add-methods').innerHTML = Object.entries(METHOD_LABEL).map(([k, l]) =>
    `<button class="opt ${ADD.method === k ? 'on' : ''}" data-method="${k}">${l}</button>`).join('');

  $('#add-flags').innerHTML = `
    <button class="opt ${ADD.income ? 'on' : ''}" data-flag="income">הכנסה</button>
    <button class="opt ${ADD.business ? 'on' : ''}" data-flag="business">עסקי</button>
    <button class="opt ${ADD.currency === 'USD' ? 'on' : ''}" data-flag="usd">דולר</button>`;

  $('#add-save').disabled = !toAgorot(ADD.amount);
}

function padPress(k) {
  if (k === 'del') ADD.amount = ADD.amount.slice(0, -1);
  else if (k === 'c') ADD.amount = '';
  else if (k === '.') { if (!ADD.amount.includes('.')) ADD.amount = (ADD.amount || '0') + '.'; }
  else {
    if (ADD.amount.includes('.') && ADD.amount.split('.')[1].length >= 2) return;
    if (ADD.amount.replace('.', '').length >= 9) return;
    ADD.amount = (ADD.amount === '0' ? '' : ADD.amount) + k;
  }
  drawAdd();
}

async function saveAdd() {
  const amount = toAgorot(ADD.amount);
  if (!amount) return;
  const merchant = $('#add-merch').value.trim();
  const rec = mkTx({
    id: ADD.editId || undefined,
    dateBuy: $('#add-date').value || todayISO(),
    merchant, amount,
    currency: ADD.currency,
    ils: toILS(amount, ADD.currency),
    dept: ADD.dept, cat: ADD.cat, method: ADD.method,
    scope: ADD.business ? 'business' : undefined,
    source: 'manual',
  });
  if (ADD.editId) {
    const old = S.txs.find(t => t.id === ADD.editId);
    if (old) Object.assign(rec, { ts: old.ts, source: old.source, raw: old.raw, fixedId: old.fixedId });
  }
  await DB.saveTx(rec);
  if (merchant) await DB.learn(merchant, { dept: rec.dept, cat: rec.cat, kind: rec.kind, need: rec.need, scope: rec.scope });
  await reload();
  closeSheet('sh-add');
  toast(ADD.editId ? 'עודכן' : `נשמר ${money(rec.ils)}`);
  render();
}

/* ==================== בורר קטגוריה ==================== */

let catTarget = null; // 'add' | {itemIndex} | 'edit' | 'fixed'

function openCatPicker(target, current) {
  catTarget = target;
  $('#cat-picker').innerHTML = DEPTS.map(d => `
    <div class="dept">
      <div class="h"><span>${d.icon}</span><span>${esc(d.label)}</span></div>
      <div class="cats">${d.cats.map(c =>
        `<button data-pick="${d.key}/${c.key}" class="${current === `${d.key}/${c.key}` ? 'on' : ''}">${esc(c.label)}</button>`).join('')}</div>
    </div>`).join('');
  openSheet('sh-cat');
}

function onCatPicked(dk, ck) {
  closeSheet('sh-cat');
  if (catTarget === 'add') {
    ADD.dept = dk; ADD.cat = ck;
    ADD.income = flowOf(dk) === 'in';
    const d = defaultsFor(dk, ck);
    ADD.business = d.scope === 'business';
    drawAdd();
  } else if (typeof catTarget === 'number') {
    const it = SHOT.items[catTarget];
    it.dept = dk; it.cat = ck;
    Object.assign(it, defaultsFor(dk, ck));
    drawShotItems();
  } else if (catTarget === 'fixed') {
    FIXED.dept = dk; FIXED.cat = ck;
    drawFixed();
  }
}

/* ==================== צילום מסך ==================== */

const SHOT = { items: [], busy: false, err: '', doc: '', pendingIds: [], localMode: false };

function openShot(blobs = null, pendingIds = []) {
  SHOT.items = []; SHOT.err = ''; SHOT.busy = false; SHOT.pendingIds = pendingIds;
  openSheet('sh-shot');
  drawShot();
  if (blobs && blobs.length) runParse(blobs);
}

function drawShot() {
  const b = $('#shot-body');
  if (SHOT.busy) {
    b.innerHTML = `<div class="center"><div class="spin"></div><div style="margin-top:12px">מפענח…</div>
      <div class="hint" style="margin-top:6px">${esc(SHOT.progress || '')}</div></div>`;
    return;
  }
  if (SHOT.err) {
    b.innerHTML = `<div class="err">${esc(SHOT.err)}</div>
      <button class="btn ghost" data-shot="pick">בחירת תמונות</button>`;
    return;
  }
  if (!SHOT.items.length) {
    b.innerHTML = `
      <button class="btn" data-shot="pick">בחירת צילומי מסך</button>
      <div class="hint" style="margin:10px 0 16px">
        דף אשראי, תנועות בנק, קבלה, או מסך של ביט/פייבוקס/וולט. אפשר לבחור כמה תמונות יחד.
        ${S.hasKey ? '' : '<br><b style="color:var(--warn)">לא הוגדר מפתח Gemini — עבור להגדרות.</b>'}
      </div>
      <button class="btn ghost" data-shot="manual">הזנה ידנית במקום</button>
      <div class="hint" style="margin-top:8px">מצב מקומי — התמונה לא נשלחת לשום מקום ואתה מקליד בעצמך. מומלץ לצילומים רגישים.</div>`;
    return;
  }
  const on = SHOT.items.filter(i => i.on);
  const sum = shotSum(on);
  b.innerHTML = `
    <div class="ok" style="display:flex;gap:8px;align-items:center">
      <span class="grow" style="flex:1">זוהו ${SHOT.items.length} שורות${SHOT.doc ? ` · ${DOC_LABEL[SHOT.doc] || SHOT.doc}` : ''}</span>
      <button data-shot="toggleall" style="text-decoration:underline;color:inherit">${on.length === SHOT.items.length ? 'בטל הכל' : 'סמן הכל'}</button>
    </div>
    <div id="shot-items"></div>
    <button class="btn" data-shot="save" ${on.length ? '' : 'disabled'}>שמירת ${on.length} שורות · ${money(sum)}</button>
    <button class="btn ghost" data-shot="pick" style="margin-top:9px">תמונות נוספות</button>`;
  drawShotItems();
}

/** סכום ההוצאה בלבד — הכנסות והעברות לא נספרות בתצוגת "כמה עומד להישמר" */
function shotSum(items) {
  return items.reduce((s, i) => flowOf(i.dept) === 'out' ? s + toILS(i.amount, i.currency) : s, 0);
}

const DOC_LABEL = {
  credit_statement: 'דף אשראי', bank_statement: 'תנועות בנק', app_receipt: 'קבלה מאפליקציה',
  single_receipt: 'קבלה', wallet: 'ארנק דיגיטלי', other: 'אחר',
};

function drawShotItems() {
  const host = $('#shot-items');
  if (!host) return;
  host.innerHTML = SHOT.items.map((it, i) => {
    const D = dept(it.dept);
    const low = (it.confidence ?? 1) < 0.7;
    const inc = flowOf(it.dept) === 'in';
    return `<div class="pitem ${it.on ? 'on' : 'off'} ${it.dup ? 'dupw' : ''} ${it.exp ? 'exp' : ''}" data-i="${i}">
      <div class="hd">
        <div class="ck" data-tog="${i}">${it.on ? '✓' : ''}</div>
        <div class="nm" data-exp="${i}">${D?.icon || ''} ${esc(it.merchant || '—')}</div>
        <div class="amt" style="${inc ? 'color:var(--good)' : ''}">${inc ? '+' : ''}${CUR_SIGN[it.currency] || '₪'}${(it.amount / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}</div>
      </div>
      <div class="md">
        <button class="cat" data-catbtn="${i}">${esc(pathLabel(it.dept, it.cat))}</button>
        <span class="dt">${esc(it.dateBuy)}</span>
        ${it.installmentOf > 1 ? `<span class="tag">תשלום ${it.installmentN}/${it.installmentOf}</span>` : ''}
        ${it.dup ? '<span class="tag dup">כפילות אפשרית</span>' : ''}
        ${low ? '<span class="tag rev lowc">ודאות נמוכה</span>' : ''}
        <button class="dt" data-exp="${i}" style="text-decoration:underline">${it.exp ? 'סגור' : 'ערוך'}</button>
      </div>
      <div class="edit">
        <div class="two" style="margin-bottom:8px">
          <div><label style="font-size:11px;color:var(--dim)">סכום</label>
            <input type="number" step="0.01" inputmode="decimal" value="${(it.amount / 100)}" data-fld="amount" data-i="${i}"></div>
          <div><label style="font-size:11px;color:var(--dim)">תאריך</label>
            <input type="date" value="${esc(it.dateBuy)}" data-fld="dateBuy" data-i="${i}"></div>
        </div>
        <input placeholder="בית עסק" value="${esc(it.merchant)}" data-fld="merchant" data-i="${i}" style="margin-bottom:8px">
        <div class="opts">
          ${Object.entries(METHOD_LABEL).map(([k, l]) =>
            `<button class="opt ${it.method === k ? 'on' : ''}" data-imethod="${i}:${k}">${l}</button>`).join('')}
          <button class="opt ${it.scope === 'business' ? 'on' : ''}" data-ibiz="${i}">עסקי</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function runParse(blobs) {
  SHOT.busy = true; SHOT.err = ''; drawShot();
  const out = [];
  try {
    for (let n = 0; n < blobs.length; n++) {
      SHOT.progress = blobs.length > 1 ? `תמונה ${n + 1} מתוך ${blobs.length}` : '';
      drawShot();
      const res = await AI.parseImage(blobs[n]);
      SHOT.doc = res.docType;
      for (const raw of res.items) out.push(await normalizeItem(raw));
    }
  } catch (e) {
    SHOT.busy = false;
    SHOT.err = e.message || String(e);
    drawShot();
    return;
  }
  // איתור כפילויות מול מה שכבר במערכת
  for (const it of out) {
    const probe = { id: '_', amount: toILS(it.amount, it.currency), dateBuy: it.dateBuy, merchant: it.merchant };
    it.dup = !!DB.findDuplicate(probe, S.txs.map(t => ({ ...t, amount: ils(t) })));
    if (it.dup) it.on = false;
  }
  SHOT.items = out;
  SHOT.busy = false;
  SHOT.progress = '';
  if (!out.length) SHOT.err = 'לא זוהו שורות בתמונה. נסה צילום ברור יותר או הזנה ידנית.';
  drawShot();
}

async function normalizeItem(r) {
  const amount = Math.round(Math.abs(Number(r.amount) || 0) * 100);
  let dk = r.dept, ck = r.cat;
  if (!dept(dk)) dk = r.isIncome ? 'income' : 'food';
  if (!cat(dk, ck)) ck = 'general';

  // המילון הלומד גובר על ניחוש המודל
  const rule = await DB.recall(r.merchant);
  if (rule?.dept && dept(rule.dept)) { dk = rule.dept; ck = cat(rule.dept, rule.cat) ? rule.cat : 'general'; }

  const d = defaultsFor(dk, ck);
  const inst = (r.installmentOf > 1) ? { n: r.installmentN || 1, of: r.installmentOf } : null;
  return {
    on: true, exp: false, dup: false,
    dateBuy: /^\d{4}-\d{2}-\d{2}$/.test(r.dateBuy || '') ? r.dateBuy : todayISO(),
    dateCharge: /^\d{4}-\d{2}-\d{2}$/.test(r.dateCharge || '') ? r.dateCharge : null,
    merchant: (r.merchant || '').trim(),
    amount,
    currency: CUR_SIGN[r.currency] ? r.currency : 'ILS',
    dept: dk, cat: ck,
    kind: rule?.kind || r.kind || d.kind,
    need: rule?.need || r.need || d.need,
    scope: rule?.scope || r.scope || d.scope,
    method: r.method || 'credit',
    installmentN: inst?.n, installmentOf: inst?.of,
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.8,
    raw: r.raw || '',
  };
}

async function saveShot() {
  const on = SHOT.items.filter(i => i.on);
  if (!on.length) return;
  const recs = on.map(it => mkTx({
    dateBuy: it.dateBuy, dateCharge: it.dateCharge, merchant: it.merchant,
    amount: it.amount, currency: it.currency, ils: toILS(it.amount, it.currency),
    dept: it.dept, cat: it.cat, kind: it.kind, need: it.need, scope: it.scope,
    method: it.method,
    installment: it.installmentOf > 1 ? { n: it.installmentN, of: it.installmentOf } : null,
    source: 'ocr', confidence: it.confidence, raw: it.raw,
    needsReview: (it.confidence ?? 1) < 0.7,
  }));
  await DB.saveTxMany(recs);
  for (const it of on) {
    if (it.merchant) await DB.learn(it.merchant, { dept: it.dept, cat: it.cat, kind: it.kind, need: it.need, scope: it.scope });
  }
  for (const id of SHOT.pendingIds) await DB.del('pending', id);
  await reload();
  closeSheet('sh-shot');
  toast(`נשמרו ${recs.length} תנועות`);
  render();
}

/* ==================== עריכת תנועה ==================== */

function openEdit(id) {
  const t = S.txs.find(x => x.id === id);
  if (!t) return;
  $('#edit-body').innerHTML = `
    <div class="card tight" style="margin-bottom:12px">
      <div style="font-weight:700;font-size:16px">${esc(t.merchant || '—')}</div>
      <div class="muted">${esc(pathLabel(t.dept, t.cat))} · ${t.dateBuy} · ${METHOD_LABEL[t.method]}</div>
      <div style="font-size:24px;font-weight:800;margin-top:6px">${money(ils(t))}</div>
      ${t.raw ? `<div class="hint" style="margin-top:8px">מקור: ${esc(t.raw)}</div>` : ''}
      ${t.dateCharge ? `<div class="hint">חיוב בפועל: ${t.dateCharge}</div>` : ''}
      ${t.installment ? `<div class="hint">תשלום ${t.installment.n} מתוך ${t.installment.of}</div>` : ''}
    </div>
    ${t.needsReview ? '<button class="btn" data-ed="ok" style="margin-bottom:9px">אשר ונקה מהתור</button>' : ''}
    ${t.dupOf ? '<button class="btn ghost" data-ed="undup" style="margin-bottom:9px">זו לא כפילות</button>'
              : '<button class="btn ghost" data-ed="dup" style="margin-bottom:9px">סמן ככפילות</button>'}
    <button class="btn ghost" data-ed="edit" style="margin-bottom:9px">עריכת פרטים</button>
    <button class="btn danger" data-ed="del">מחיקה</button>`;
  $('#edit-body').dataset.id = id;
  openSheet('sh-edit');
}

/* ==================== הוצאה קבועה ==================== */

const FIXED = { id: null, merchant: '', amount: 0, dept: 'home', cat: 'rent', day: 1, method: 'bank', active: true };

function openFixed(id = null) {
  const f = id ? S.fixed.find(x => x.id === id) : null;
  Object.assign(FIXED, f || { id: null, merchant: '', amount: 0, dept: 'home', cat: 'rent', day: 1, method: 'bank', active: true });
  drawFixed();
  openSheet('sh-fixed');
}

function drawFixed() {
  $('#fixed-body').innerHTML = `
    <div class="fld"><label>שם</label><input id="f-merch" value="${esc(FIXED.merchant)}" placeholder="שכר דירה"></div>
    <div class="two">
      <div class="fld"><label>סכום חודשי ₪</label><input id="f-amt" type="number" step="0.01" inputmode="decimal" value="${FIXED.amount ? FIXED.amount / 100 : ''}"></div>
      <div class="fld"><label>יום בחודש</label><input id="f-day" type="number" min="1" max="31" value="${FIXED.day}"></div>
    </div>
    <div class="fld"><label>קטגוריה</label>
      <button class="opt" data-fixedcat style="width:100%;padding:10px 12px;text-align:right">${esc(pathLabel(FIXED.dept, FIXED.cat))}</button></div>
    <div class="opts">${Object.entries(METHOD_LABEL).map(([k, l]) =>
      `<button class="opt ${FIXED.method === k ? 'on' : ''}" data-fmethod="${k}">${l}</button>`).join('')}</div>
    <div class="opts"><button class="opt ${FIXED.active ? 'on' : ''}" data-factive>${FIXED.active ? 'פעיל' : 'כבוי'}</button></div>
    <button class="btn" data-fsave>שמירה</button>
    ${FIXED.id ? '<button class="btn danger" data-fdel style="margin-top:9px">מחיקה</button>' : ''}`;
}

async function saveFixed() {
  FIXED.merchant = $('#f-merch').value.trim();
  FIXED.amount = toAgorot($('#f-amt').value);
  FIXED.day = Math.min(31, Math.max(1, parseInt($('#f-day').value) || 1));
  if (!FIXED.merchant || !FIXED.amount) { toast('חסר שם או סכום'); return; }
  const rec = { ...FIXED, id: FIXED.id || DB.uid(), startMonth: FIXED.startMonth || curMonth() };
  await DB.put('fixed', rec);
  await reload();
  await applyFixedForMonth(curMonth());
  closeSheet('sh-fixed');
  toast('נשמר');
  render();
}

/* ==================== ייצוא / ייבוא ==================== */

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function doExport() {
  const data = await DB.exportAll();
  download(`kesef-${todayISO()}.json`, JSON.stringify(data, null, 1));
  S.lastExport = Date.now();
  await DB.setSetting('lastExport', S.lastExport);
  toast('גובה');
  render();
}

function doCsv() {
  const head = ['תאריך קנייה', 'תאריך חיוב', 'בית עסק', 'מחלקה', 'קטגוריה', 'תווית', 'סכום מקורי', 'מטבע', 'שקלים',
    'סוג', 'חיוניות', 'היקף', 'אמצעי', 'תשלומים', 'הערה', 'מקור', 'זרימה'];
  const rows = S.txs.map(t => [
    t.dateBuy, t.dateCharge || '', t.merchant, t.dept, t.cat, pathLabel(t.dept, t.cat),
    (t.amount / 100).toFixed(2), t.currency, (ils(t) / 100).toFixed(2),
    KIND_LABEL[t.kind], NEED_LABEL[t.need], SCOPE_LABEL[t.scope], METHOD_LABEL[t.method],
    t.installment ? `${t.installment.n}/${t.installment.of}` : '', t.note, t.source, flowOf(t.dept),
  ]);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [head.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n');
  download(`kesef-${todayISO()}.csv`, csv, 'text/csv');
  toast('CSV ירד');
}

/* ==================== חיווט ==================== */

function wire() {
  // ניווט
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const go = t.closest('[data-go]');
    if (go) { S.view = go.dataset.go; render(); return; }

    if (t.closest('[data-close]')) { closeAllSheets(); return; }
    if (t.closest('#fab')) { openAdd(); return; }
    if (t.closest('#btn-shot')) { openShot(); return; }
    if (t.closest('#go-budget')) { S.view = 'set'; render(); return; }

    // פסי התראה
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'review')     { S.view = 'all'; S.filter = 'review'; render(); return; }
    if (act === 'tosettings') { S.view = 'set'; render(); return; }
    if (act === 'export')     { await doExport(); return; }

    // צ'יפים מהירים
    const q = t.closest('[data-quick]');
    if (q) {
      const [d, c] = q.dataset.quick.split('/');
      openAdd({ dept: d, cat: c, ...defaultsFor(d, c), business: defaultsFor(d, c).scope === 'business' });
      return;
    }

    // תנועה
    const tx = t.closest('[data-tx]');
    if (tx) { openEdit(tx.dataset.tx); return; }

    // מקלדת
    const pad = t.closest('[data-pad]');
    if (pad) { padPress(pad.dataset.pad); return; }

    const sc = t.closest('[data-setcat]');
    if (sc) { const [d, c] = sc.dataset.setcat.split('/'); ADD.dept = d; ADD.cat = c; drawAdd(); return; }
    if (t.closest('#add-catbtn')) { openCatPicker('add', `${ADD.dept}/${ADD.cat}`); return; }
    const me = t.closest('[data-method]');
    if (me) { ADD.method = me.dataset.method; drawAdd(); return; }
    const fl = t.closest('[data-flag]')?.dataset.flag;
    if (fl === 'income')  { ADD.income = !ADD.income; ADD.dept = ADD.income ? 'income' : 'food'; ADD.cat = 'general'; drawAdd(); return; }
    if (fl === 'business'){ ADD.business = !ADD.business; drawAdd(); return; }
    if (fl === 'usd')     { ADD.currency = ADD.currency === 'USD' ? 'ILS' : 'USD'; drawAdd(); return; }
    if (t.closest('#add-save')) { await saveAdd(); return; }

    // בורר קטגוריה
    const pk = t.closest('[data-pick]');
    if (pk) { const [d, c] = pk.dataset.pick.split('/'); onCatPicked(d, c); return; }

    // צילום מסך
    const sh = t.closest('[data-shot]')?.dataset.shot;
    if (sh === 'pick')      { $('#filein').click(); return; }
    if (sh === 'manual')    { closeSheet('sh-shot'); openAdd({ method: 'credit' }); return; }
    if (sh === 'toggleall') {
      const allOn = SHOT.items.every(i => i.on);
      SHOT.items.forEach(i => i.on = !allOn); drawShot(); return;
    }
    if (sh === 'save') { await saveShot(); return; }

    const tog = t.closest('[data-tog]');
    if (tog) { const i = +tog.dataset.tog; SHOT.items[i].on = !SHOT.items[i].on; drawShot(); return; }
    const ex = t.closest('[data-exp]');
    if (ex) { const i = +ex.dataset.exp; SHOT.items[i].exp = !SHOT.items[i].exp; drawShotItems(); return; }
    const cb = t.closest('[data-catbtn]');
    if (cb) { const i = +cb.dataset.catbtn; openCatPicker(i, `${SHOT.items[i].dept}/${SHOT.items[i].cat}`); return; }
    const im = t.closest('[data-imethod]');
    if (im) { const [i, k] = im.dataset.imethod.split(':'); SHOT.items[+i].method = k; drawShotItems(); return; }
    const ib = t.closest('[data-ibiz]');
    if (ib) { const i = +ib.dataset.ibiz; const it = SHOT.items[i]; it.scope = it.scope === 'business' ? 'personal' : 'business'; drawShotItems(); return; }

    // מגירת עריכה
    const ed = t.closest('[data-ed]')?.dataset.ed;
    if (ed) { await onEditAction(ed, $('#edit-body').dataset.id); return; }

    // מסננים
    const f = t.closest('[data-f]');
    if (f) {
      if (f.dataset.f === 'cleardept') S.deptFilter = null;
      else S.filter = f.dataset.f;
      renderAll(); return;
    }

    // מחלקה בדוח החודשי → סינון לפי אותה מחלקה
    const dp = t.closest('[data-dept]');
    if (dp) {
      S.view = 'all'; S.filter = 'all'; S.q = ''; $('#q').value = '';
      S.deptFilter = dp.dataset.dept;
      render(); return;
    }

    // הוצאות קבועות
    const fx = t.closest('[data-fixed]');
    if (fx) { openFixed(fx.dataset.fixed); return; }
    if (t.closest('#s-addfixed')) { openFixed(); return; }
    if (t.closest('[data-fixedcat]')) { openCatPicker('fixed', `${FIXED.dept}/${FIXED.cat}`); return; }
    const fm = t.closest('[data-fmethod]');
    if (fm) { FIXED.method = fm.dataset.fmethod; drawFixed(); return; }
    if (t.closest('[data-factive]')) { FIXED.active = !FIXED.active; drawFixed(); return; }
    if (t.closest('[data-fsave]')) { await saveFixed(); return; }
    if (t.closest('[data-fdel]')) {
      await DB.del('fixed', FIXED.id); await reload(); closeSheet('sh-fixed'); toast('נמחק'); render(); return;
    }

    // חודש
    if (t.closest('#m-prev')) { S.month = shiftMonth(S.month, -1); renderMonth(); return; }
    if (t.closest('#m-next')) { S.month = shiftMonth(S.month, 1); renderMonth(); return; }

    // הגדרות
    if (t.closest('#s-savekey'))   { await saveKey(); return; }
    if (t.closest('#s-test'))      { await testKey(); return; }
    if (t.closest('#s-savebudget')){
      S.budget = toAgorot($('#s-budget').value);
      await DB.setSetting('budget', S.budget); toast('נשמר'); return;
    }
    if (t.closest('#s-export')) { await doExport(); return; }
    if (t.closest('#s-csv'))    { doCsv(); return; }
    if (t.closest('#s-import')) { $('#jsonin').click(); return; }
    if (t.closest('#s-clearrules')) {
      if (!confirm('לאפס את המילון הלומד?')) return;
      await DB.clear('rules'); await reload(); toast('אופס'); render(); return;
    }
    if (t.closest('#s-wipe')) {
      if (!confirm('למחוק את כל התנועות, הכללים וההוצאות הקבועות? אין דרך חזרה.')) return;
      if (!confirm('בטוח? מומלץ לייצא גיבוי קודם.')) return;
      await DB.clear('tx'); await DB.clear('rules'); await DB.clear('fixed');
      await reload(); toast('נמחק'); render(); return;
    }
  });

  // מקלדת סכום
  $('#add-pad').innerHTML =
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']
      .map(k => `<button data-pad="${k}" class="${k === 'del' || k === '.' ? 'act' : ''}">${k === 'del' ? '⌫' : k}</button>`).join('');

  // שדות
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderAll(); });
  $('#add-merch').addEventListener('input', async (e) => {
    const rule = await DB.recall(e.target.value);
    if (rule?.dept && dept(rule.dept) && !ADD._touched) {
      ADD.dept = rule.dept; ADD.cat = cat(rule.dept, rule.cat) ? rule.cat : 'general';
      ADD.business = rule.scope === 'business';
      drawAdd();
    }
  });
  $('#add-quickcats').addEventListener('click', () => { ADD._touched = true; });

  // עריכה בתוך תוצאות הפענוח
  $('#shot-body').addEventListener('input', (e) => {
    const el = e.target.closest('[data-fld]');
    if (!el) return;
    const it = SHOT.items[+el.dataset.i];
    const f = el.dataset.fld;
    if (f === 'amount') it.amount = toAgorot(el.value);
    else it[f] = el.value;
    const on = SHOT.items.filter(i => i.on);
    const btn = $('[data-shot="save"]');
    if (btn) btn.textContent = `שמירת ${on.length} שורות · ${money(shotSum(on))}`;
  });

  // בחירת קבצים
  $('#filein').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    if (!$('#sh-shot').classList.contains('on')) openShot();
    SHOT.pendingIds = [];
    await runParse(files);
  });

  $('#jsonin').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const st = await DB.importAll(data);
      await reload();
      toast(`יובאו ${st.tx} תנועות`);
      render();
    } catch (err) { toast('ייבוא נכשל: ' + err.message, 3500); }
  });

  $('#s-model').addEventListener('change', async (e) => {
    await DB.setSetting('geminiModel', e.target.value); toast('המודל עודכן');
  });
}

async function onEditAction(action, id) {
  const t = S.txs.find(x => x.id === id);
  if (!t) return;
  if (action === 'del') {
    await DB.del('tx', id); await reload(); closeSheet('sh-edit'); toast('נמחק'); render(); return;
  }
  if (action === 'ok')    { t.needsReview = false; await DB.saveTx(t); }
  if (action === 'dup')   { t.dupOf = '_manual'; await DB.saveTx(t); }
  if (action === 'undup') { t.dupOf = null; await DB.saveTx(t); }
  if (action === 'edit') {
    closeSheet('sh-edit');
    openAdd({
      editId: t.id, amount: String(t.amount / 100), dept: t.dept, cat: t.cat,
      method: t.method, date: t.dateBuy, merchant: t.merchant,
      income: flowOf(t.dept) === 'in', business: t.scope === 'business', currency: t.currency,
    });
    return;
  }
  await reload(); closeSheet('sh-edit'); render();
}

async function saveKey() {
  const key = $('#s-key').value.trim();
  if (!key) { $('#s-keymsg').innerHTML = '<div class="err">לא הוזן מפתח</div>'; return; }
  $('#s-keymsg').innerHTML = '<div class="muted"><span class="spin"></span> בודק…</div>';
  try {
    const model = await AI.testKey(key);
    await DB.setSetting('geminiKey', key);
    await AI.resolveModel(key, { force: true });
    S.hasKey = true;
    $('#s-keymsg').innerHTML = `<div class="ok">המפתח עובד. מודל נבחר: ${esc((model || '').replace('models/', ''))}</div>`;
    renderSettings();
  } catch (e) {
    $('#s-keymsg').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

async function testKey() {
  const key = $('#s-key').value.trim() || await DB.setting('geminiKey');
  if (!key) { $('#s-keymsg').innerHTML = '<div class="err">לא הוזן מפתח</div>'; return; }
  $('#s-keymsg').innerHTML = '<div class="muted"><span class="spin"></span> בודק…</div>';
  try {
    const models = await AI.listModels(key);
    $('#s-keymsg').innerHTML = `<div class="ok">תקין · ${models.length} מודלים זמינים · מומלץ ${esc(models[0].replace('models/', ''))}</div>`;
  } catch (e) {
    $('#s-keymsg').innerHTML = `<div class="err">${esc(e.message)}</div>`;
  }
}

// ידית בדיקה — נפתחת רק עם ?debug=1, שימושית לאבחון מול הקונסולה
if (new URLSearchParams(location.search).has('debug')) {
  window.__kesef = { S, SHOT, ADD, DB, AI, mkTx, normalizeItem, openShot, drawShot, statsFor, render, reload };
}

init();
