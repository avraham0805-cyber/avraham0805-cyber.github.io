import * as DB from './db.js';
import * as AI from './ai.js';
import * as C from './charts.js';
import * as IN from './insights.js';
import * as ST from './stats.js';
import * as Crypto from './crypto.js';
import {
  DEPTS, EXPENSE_DEPTS, QUICK_SEED, DEFAULT_ACCOUNTS, DEFAULT_ACCOUNT_NAMES, ACCOUNT_TYPE_LABEL,
  dept, cat, pathLabel, catLabel, flowOf, defaultsFor, guessAccount,
  KIND_LABEL, NEED_LABEL, METHOD_LABEL,
} from './taxonomy.js';

/* ==================== עזרים ==================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n, size = 16) => `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#ic-${n}"/></svg>`;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const curMonth = () => todayISO().slice(0, 7);
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MONTHS_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const monthLabel = (m) => `${MONTHS_HE[+m.split('-')[1] - 1]} ${m.split('-')[0]}`;
const monthShort = (m) => MONTHS_SHORT[+m.split('-')[1] - 1];
const shiftMonth = (m, by) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };

const money = (agorot) => {
  const v = Math.abs(agorot || 0) / 100;
  const s = v.toLocaleString('he-IL', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  return (agorot < 0 ? '−₪' : '₪') + s;
};
const money0 = (agorot) => '₪' + Math.round(Math.abs(agorot || 0) / 100).toLocaleString('he-IL');
const moneyShort = (agorot) => {
  const v = Math.abs(agorot || 0) / 100;
  return v >= 10000 ? '₪' + (v / 1000).toFixed(0) + 'K' : money0(agorot);
};
const heroFig = (agorot) => {
  const v = Math.abs(agorot || 0) / 100;
  return `${agorot < 0 ? '−' : ''}<span class="cur">₪</span>${v.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
};
const toAgorot = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100) || 0;
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const CUR_SIGN = { ILS: '₪', USD: '$', EUR: '€', GBP: '£', OTHER: '¤' };

IN.setFormatter(money0);

function toast(msg, ms = 2300) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), ms);
}
const openSheet = (id) => { $('#' + id).classList.add('on'); document.body.style.overflow = 'hidden'; };
const closeSheet = (id) => { $('#' + id).classList.remove('on'); document.body.style.overflow = ''; };
const closeAll = () => { $$('.sheet.on').forEach(s => s.classList.remove('on')); document.body.style.overflow = ''; C.hideTip(); };

/* ==================== מצב ==================== */

const S = {
  txs: [], rules: [], fixed: [], accounts: [], budgets: [],
  adv: { from: '', to: '', min: null, max: null, tag: '' },
  budget: 0, fx: { USD: 3.7, EUR: 4.0, GBP: 4.7 },
  month: curMonth(), view: 'home',
  q: '', filter: 'all', deptFilter: null, acctFilter: null,
  lastExport: 0, hasKey: false,
  modes: { accounts: 'chart', depts: 'chart', stack: 'chart', heat: 'chart' },
  analysis: null, insights: null,
};

const ils = (t) => t.ils ?? t.amount ?? 0;
const live = (rows) => rows.filter(t => !t.dupOf);
const acctOf = (t) => t.account || 'bank1';
const acctName = (id) => S.accounts.find(s => s.id === id)?.name || 'לא משויך';
const acctColor = (id) => {
  const s = S.accounts.find(x => x.id === id);
  return s ? C.seriesVar(s.slot ?? 0) : C.OTHER_COLOR;
};

/* ==================== אתחול ==================== */

async function init() {
  // אחסון שנכשל בשקט הוא התרחיש הגרוע ביותר: המשתמש מקליד שבוע שלם
  // ורק אז מגלה ששום דבר לא נשמר. נכשלים ברעש, לפני שנוגעים בכלום.
  try {
    await DB.open();
    await DB.setSetting('__probe', Date.now());
  } catch (e) {
    showStorageFailure(e);
    return;
  }

  // שכבת ההצפנה קודמת לכל דבר אחר — בלעדיה אין גישה לסודות
  const state = await Crypto.initCrypto(DB);
  if (state === 'needs-pin') { showLock(); return; }
  await DB.migrateSecrets();

  await ensureAccounts();
  await reload();

  S.budget = await DB.setting('budget', 0);
  S.fx = await DB.setting('fx', S.fx);
  S.lastExport = await DB.setting('lastExport', 0);
  S.hasKey = await DB.hasSecret('geminiKey');
  S.autoLock = await DB.setting('autoLockMin', 0);
  const theme = await DB.setting('theme', 'auto');
  applyTheme(theme);
  armAutoLock();

  await applyFixedForMonth(curMonth());
  await backfillAccounts();
  wire();
  render();

  const pend = await DB.all('pending');
  if (pend.length) {
    history.replaceState({}, '', location.pathname);
    openShot(pend.map(p => p.blob), pend.map(p => p.id));
  }
  const qs = new URLSearchParams(location.search);
  if (qs.has('add')) openAdd();
  if (qs.has('shot')) openShot();

  DB.maybeSnapshot('פתיחת אפליקציה').catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    // כשקוד חדש נכנס לתוקף, מציעים רענון במקום להשאיר גרסה ישנה רצה
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'sw-updated' && !S.updatePrompted) {
        S.updatePrompted = true;
        showUpdateBar();
      }
    });
  }
}

async function reload() {
  [S.txs, S.rules, S.fixed, S.accounts, S.budgets] = await Promise.all([
    DB.allTx(), DB.all('rules'), DB.all('fixed'), DB.all('accounts'), DB.all('budgets'),
  ]);
  S.accounts.sort((a, b) => (a.slot ?? 9) - (b.slot ?? 9));
  S.analysis = null; S.insights = null;
}

async function ensureAccounts() {
  const have = await DB.all('accounts');
  if (have.length) return;
  await DB.putMany('accounts', DEFAULT_ACCOUNTS.map(s => ({ ...s, active: true })));
}

/** תנועות ישנות שנשמרו לפני שהיו מקורות מקבלות שיוך לפי המחלקה */
async function backfillAccounts() {
  const missing = S.txs.filter(t => !t.account);
  if (!missing.length) return;
  for (const t of missing) t.account = guessAccount(t.method);
  await DB.saveTxMany(missing);
  await reload();
}

function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  S.theme = mode;
}

/* ==================== נעילה ==================== */

let lockTimer = null;

function armAutoLock() {
  clearTimeout(lockTimer);
  if (!S.autoLock) return;
  const reset = () => {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { Crypto.lockNow(); location.reload(); }, S.autoLock * 60000);
  };
  ['pointerdown', 'keydown', 'visibilitychange'].forEach(ev =>
    document.addEventListener(ev, reset, { passive: true }));
  reset();
}

/** פס עדכון — גרסה חדשה כבר ירדה וממתינה לרענון */
function showUpdateBar() {
  const bar = document.createElement('div');
  bar.className = 'note info';
  bar.style.cssText = 'position:fixed;inset-inline:12px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:80;box-shadow:0 8px 24px -10px rgba(0,0,0,.4)';
  bar.innerHTML = `${icon('info')}<span class="grow">יש גרסה חדשה של האפליקציה</span>
    <button id="do-reload" style="font-weight:660;text-decoration:underline">רענן</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#do-reload').onclick = () => location.reload();
}

function showStorageFailure(err) {
  document.body.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:60px 24px;font-family:system-ui,sans-serif;
                background:#f9f9f7;color:#0b0b0b;min-height:100vh">
      <h1 style="font-size:21px;font-weight:640;letter-spacing:-.02em;margin:0 0 14px">
        אין אפשרות לשמור נתונים כאן</h1>
      <p style="font-size:15px;line-height:1.6;color:#52514e;margin:0 0 16px">
        הדפדפן חוסם אחסון מקומי בהקשר הזה, ולכן שום דבר שתקליד לא יישמר.
        <b>לא אתן לך להתחיל להזין נתונים שייעלמו.</b>
      </p>
      <p style="font-size:15px;line-height:1.6;color:#52514e;margin:0 0 16px">
        זה קורה כמעט תמיד כשפותחים את הקובץ ישירות מהאחסון בטלפון
        (<code>file://</code>). הפתרון: פתח את האפליקציה מהכתובת שלה ברשת.
        במחשב, פתיחת הקובץ בכרום עובדת כרגיל.
      </p>
      <p style="font-size:12.5px;color:#898781;margin-top:24px;direction:ltr;text-align:left">
        ${esc(err?.name || '')}: ${esc(err?.message || String(err))}</p>
    </div>`;
}

function showLock(err = '') {
  $('#lock-body').innerHTML = `
    <div class="empty" style="padding:10px 0 22px">${icon('lock', 30)}
      <div style="margin-top:12px">הנתונים מוצפנים. הקלד את קוד הנעילה כדי לפתוח.</div></div>
    ${err ? `<div class="note bad">${icon('alert')}<span>${esc(err)}</span></div>` : ''}
    <div class="field"><input class="inp" id="lock-pin" type="password" inputmode="numeric"
      autocomplete="off" placeholder="קוד" style="text-align:center;font-size:22px;letter-spacing:.3em"></div>
    <button class="btn accent" id="lock-go">פתיחה</button>
    <div class="hint">אין דרך לעקוף את הקוד. הוא לא נשמר בשום מקום — הוא מה שגוזר את מפתח ההצפנה.</div>`;
  openSheet('sh-lock');
  setTimeout(() => $('#lock-pin')?.focus(), 120);
  const go = async () => {
    const pin = $('#lock-pin').value.trim();
    try {
      await Crypto.unlock(DB, pin);
      closeSheet('sh-lock');
      location.reload();
    } catch (e) { showLock(e.message); }
  };
  $('#lock-go').onclick = go;
  $('#lock-pin').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

/* ==================== הוצאות קבועות ==================== */

async function applyFixedForMonth(month) {
  if (!S.fixed.length) return;
  const day = (n) => `${month}-${String(Math.min(n || 1, daysInMonth(month))).padStart(2, '0')}`;
  const existing = new Set(S.txs.filter(t => t.month === month && t.fixedId).map(t => t.fixedId));
  const add = [];
  for (const f of S.fixed) {
    if (!f.active || existing.has(f.id)) continue;
    if (f.startMonth && month < f.startMonth) continue;
    add.push(mkTx({
      dateBuy: day(f.day), merchant: f.merchant, amount: f.amount, ils: f.amount,
      dept: f.dept, cat: f.cat, kind: 'fixed', need: f.need || 'essential',
      account: f.account, method: f.method || 'bank',
      note: 'הוצאה קבועה', source: 'recurring', fixedId: f.id, confidence: 1,
    }));
  }
  if (add.length) { await DB.saveTxMany(add); await reload(); }
}

/* ==================== יצירת תנועה ==================== */

function mkTx(p) {
  const d = defaultsFor(p.dept || 'food', p.cat || 'general');
  const dateBuy = p.dateBuy || todayISO();
  return {
    id: p.id || DB.uid(), ts: p.ts || Date.now(),
    dateBuy, dateCharge: p.dateCharge || null,
    merchant: (p.merchant || '').trim(),
    amount: p.amount || 0, currency: p.currency || 'ILS', ils: p.ils ?? p.amount ?? 0,
    dept: p.dept || 'food', cat: p.cat || 'general',
    kind: p.kind || d.kind, need: p.need || d.need, scope: p.scope || d.scope,
    account: p.account || d.account,
    method: p.method || 'cash',
    installment: p.installment || null,
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 8) : [],
    splitOf: p.splitOf || null,
    note: p.note || '', source: p.source || 'manual',
    confidence: p.confidence ?? 1, needsReview: !!p.needsReview,
    dupOf: p.dupOf || null, raw: p.raw || '', fixedId: p.fixedId || null,
    month: dateBuy.slice(0, 7),
  };
}

const toILS = (amount, currency) =>
  (!currency || currency === 'ILS') ? amount : Math.round(amount * (S.fx[currency] || 1));

/* ==================== חישובים ==================== */

const statsFor = (month) => statsOf(S.txs, month);

function statsOf(source, month) {
  const rows = live(source.filter(t => t.month === month));
  const st = {
    out: 0, in: 0, neutral: 0, count: rows.length,
    byDept: {}, byCat: {}, byMerchant: {}, byDay: {}, byAccount: {},
    kind: { fixed: 0, variable: 0, oneoff: 0 },
    need: { essential: 0, discretionary: 0 },
  };
  for (const t of rows) {
    const f = flowOf(t.dept), v = ils(t), sid = acctOf(t);
    st.byAccount[sid] ||= { in: 0, out: 0 };
    if (f === 'in') { st.in += v; st.byAccount[sid].in += v; continue; }
    if (f === 'neutral') { st.neutral += v; continue; }
    st.out += v;
    st.byAccount[sid].out += v;
    st.byDept[t.dept] = (st.byDept[t.dept] || 0) + v;
    st.byCat[`${t.dept}/${t.cat}`] = (st.byCat[`${t.dept}/${t.cat}`] || 0) + v;
    const mk = (t.merchant || '').trim() || pathLabel(t.dept, t.cat);
    st.byMerchant[mk] = (st.byMerchant[mk] || 0) + v;
    const d = +t.dateBuy.slice(8);
    st.byDay[d] = (st.byDay[d] || 0) + v;
    st.kind[t.kind] = (st.kind[t.kind] || 0) + v;
    st.need[t.need] = (st.need[t.need] || 0) + v;
  }
  st.net = st.in - st.out;
  return st;
}

function monthsBack(n, from = curMonth()) {
  return Array.from({ length: n }, (_, i) => shiftMonth(from, -(n - 1 - i)));
}

/* ==================== רכיבים ==================== */

/** טבלה — התאום הנגיש של כל גרף */
function table(head, rows, { foot = null, cls = '' } = {}) {
  const th = head.map(h => `<th class="${h.n ? 'n' : ''}">${esc(h.label)}</th>`).join('');
  const tb = rows.map(r =>
    `<tr class="${r.click ? 'click' : ''}" ${r.data || ''}>` +
    r.cells.map((c, i) => `<td class="${head[i]?.n ? 'n' : ''} ${i === 0 ? 'name' : ''}">${c}</td>`).join('') +
    '</tr>').join('');
  const tf = foot
    ? `<tfoot><tr>${foot.map((c, i) => `<td class="${head[i]?.n ? 'n' : ''}">${c}</td>`).join('')}</tr></tfoot>`
    : '';
  return `<table class="tbl ${cls}"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody>${tf}</table>`;
}

/** רשימת עמודות אופקיות — סדרה אחת, צבע אחד, עם ערכים גלויים */
function barRows(items, total, { onClickAttr = () => '' } = {}) {
  if (!items.length) return '<div class="empty">אין נתונים</div>';
  return `<div class="rows" style="border-top:0">` + items.map(it => `
    <div class="row" style="cursor:${it.key ? 'pointer' : 'default'};align-items:flex-start" ${onClickAttr(it)}>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:9px">
          <span style="flex:1;font-size:13.5px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label)}</span>
          <span class="num" style="font-size:11.5px;color:var(--ink-3)">${pct(it.value, total)}%</span>
          <span class="num" style="font-size:13.5px;font-weight:620">${money(it.value)}</span>
        </div>
        <div class="cellbar"><i style="width:${total ? it.value / total * 100 : 0}%;background:${it.color || 'var(--s1)'}"></i></div>
      </div>
    </div>`).join('') + '</div>';
}

function txRow(t, selectable = false) {
  const D = dept(t.dept), f = flowOf(t.dept);
  const cls = f === 'in' ? 'in' : f === 'neutral' ? 'neutral' : '';
  const pills = [
    t.installment ? `<span class="pill">${t.installment.n}/${t.installment.of}</span>` : '',
    t.dupOf ? '<span class="pill dup">כפילות</span>' : '',
    t.needsReview ? '<span class="pill warn">לאישור</span>' : '',
    t.currency !== 'ILS' ? `<span class="pill">${CUR_SIGN[t.currency]}${(t.amount / 100).toLocaleString('he-IL')}</span>` : '',
    ...(t.tags || []).slice(0, 2).map(x => `<span class="pill acc">#${esc(x)}</span>`),
    t.splitOf ? '<span class="pill">מפוצל</span>' : '',
  ].join('');
  const acctTag = S.accounts.length > 1 ? ` · ${esc(acctName(acctOf(t)))}` : '';
  const box = selectable
    ? `<span class="selbox ${SEL.has(t.id) ? 'on' : ''}" data-sel="${t.id}">${SEL.has(t.id) ? icon('check', 11) : ''}</span>`
    : '';
  return `<button class="row" data-tx="${t.id}">
    ${box}
    <span class="gl">${icon(D?.icon || 'list')}</span>
    <span class="body">
      <span class="t1">${esc(t.merchant || catLabel(t.dept, t.cat))}${pills}</span>
      <span class="t2">${esc(catLabel(t.dept, t.cat))} · ${t.dateBuy.slice(8)}.${t.dateBuy.slice(5, 7)} · ${METHOD_LABEL[t.method] || ''}${acctTag}</span>
    </span>
    <span class="amt ${cls}">${f === 'in' ? '+' : ''}${money(ils(t))}</span>
  </button>`;
}

/* ==================== מסך: בית ==================== */

function render() {
  $$('.view').forEach(v => v.classList.remove('on'));
  $('#v-' + S.view).classList.add('on');
  $$('nav.tabbar button[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === S.view));
  C.hideTip();
  ({
    home: renderHome, analysis: renderAnalysis, reports: renderReports,
    insights: renderInsights, ledger: renderLedger, settings: renderSettings,
  })[S.view]();
}

/* ==================== מסך: דוחות ==================== */

function renderReports() {
  S.insights ||= IN.analyze(S.txs);
  $('#rp-meta').textContent = `${monthLabel(curMonth())} · ${live(S.txs).length} תנועות מתועדות`;
  renderMonthClose();
  renderChargeCalendar();
  renderNetWorthChart();
  renderSavingsRate();
  renderWealth();
  renderTradingPnL();
}

/** סגירת חודש — החודש הקודם שהסתיים, בקצרה של דוח */
function renderMonthClose() {
  const host = $('#rep-close');
  const m = shiftMonth(curMonth(), -1);
  const st = statsFor(m);
  $('#rep-close-aside').textContent = monthLabel(m);
  if (!st.count) { host.innerHTML = '<div class="empty">אין נתונים לחודש שעבר — הדוח יופיע כשיהיה חודש מלא מאחוריך.</div>'; return; }
  const a = ST.attribution(S.txs, shiftMonth(m, -1), m);
  const sr = ST.savingsRateSeries(S.txs, 2).find(r => r.month === m);
  const biggest = live(S.txs.filter(t => t.month === m && flowOf(t.dept) === 'out'))
    .sort((x, y) => ils(y) - ils(x))[0];
  host.innerHTML = `
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="k">יצא</div><div class="v num">${money0(st.out)}</div></div>
      <div class="tile"><div class="k">נכנס</div><div class="v num" style="color:var(--delta-up)">${money0(st.in)}</div></div>
      <div class="tile"><div class="k">נטו</div><div class="v num" style="color:${st.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${st.net < 0 ? '−' : '+'}${money0(Math.abs(st.net))}</div></div>
    </div>
    <div class="rows">
      ${a.parts.length ? `<div class="row" style="cursor:default"><span class="body">
        <span class="t1">מול החודש שקדם: ${a.delta === 0 ? 'ללא שינוי' : `${a.delta > 0 ? 'עלייה' : 'ירידה'} של ${money(Math.abs(a.delta))}`}</span>
        <span class="t2">${a.parts[0] ? `הגורם הגדול: ${esc(a.parts[0].label)} (${a.parts[0].delta > 0 ? '+' : '−'}${money0(Math.abs(a.parts[0].delta))})` : ''}</span>
      </span></div>` : ''}
      ${sr?.rate !== null && sr ? `<div class="row" style="cursor:default"><span class="body">
        <span class="t1">שיעור חיסכון: ${Math.round((sr.rate || 0) * 100)}%</span>
        <span class="t2">${money0(sr.saved)} הופנו לחיסכון מתוך ${money0(sr.income)} הכנסה</span>
      </span></div>` : ''}
      ${biggest ? `<div class="row" data-merch="${esc(biggest.merchant || '')}"><span class="body">
        <span class="t1">ההוצאה הגדולה: ${esc(biggest.merchant || catLabel(biggest.dept, biggest.cat))}</span>
        <span class="t2">${money(ils(biggest))} · ${esc(pathLabel(biggest.dept, biggest.cat))}</span>
      </span></div>` : ''}
    </div>`;
}

/** לוח חיובים — 30 הימים הקרובים על גריד החודש */
function renderChargeCalendar() {
  const host = $('#rep-cal');
  const up = ST.upcoming(S.txs, S.insights.recurring || [], S.fixed, 30);
  $('#rep-cal-aside').innerHTML = up.total ? `<b class="num">${money0(up.total)}</b>` : '';
  if (!up.items.length) { host.innerHTML = '<div class="empty">אין חיובים ידועים קדימה</div>'; return; }
  const m = curMonth();
  const byDay = new Map();
  for (const it of up.items) {
    if (!it.date.startsWith(m)) continue;      // הגריד מציג את החודש הנוכחי
    const d = +it.date.slice(8);
    if (!byDay.has(d)) byDay.set(d, { total: 0, items: [] });
    const e = byDay.get(d);
    e.total += it.amount;
    e.items.push(`${it.label} · ${money0(it.amount)}`);
  }
  host.replaceChildren(C.monthGrid(m, byDay, { fmt: moneyShort, today: new Date().getDate() }));
  const rest = up.items.filter(it => !it.date.startsWith(m));
  if (rest.length) {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = `ועוד ${rest.length} חיובים בתחילת החודש הבא · ${money0(rest.reduce((s, x) => s + x.amount, 0))}`;
    host.appendChild(note);
  }
}

function renderNetWorthChart() {
  const host = $('#rep-nw');
  const s = ST.netWorthSeries(S.txs, S.accounts, 12);
  if (s.length < 2) {
    $('#rep-nw-aside').textContent = '';
    host.innerHTML = '<div class="empty">עגן יתרות בחשבונות כדי לראות את השווי הנקי מצטבר לאורך זמן.</div>';
    return;
  }
  const first = s[0].total, last = s.at(-1).total;
  // הפרש מוחלט ולא אחוז: נקודת פתיחה קטנה מנפחת אחוזים לחסרי משמעות
  const diff = last - first;
  $('#rep-nw-aside').innerHTML = `<b class="num">${money0(last)}</b>
    <span class="num" style="color:${diff >= 0 ? 'var(--delta-up)' : 'var(--neg)'};font-size:12px;font-weight:620">
    ${diff >= 0 ? '▲' : '▼'} ${money0(Math.abs(diff))}</span>`;
  host.replaceChildren(C.line(s.map(p => ({ label: monthShort(p.month), value: p.total })), { fmt: money0 }));
  const note = document.createElement('div');
  note.className = 'hint';
  note.innerHTML = `מ-${monthLabel(s[0].month)}: ${last >= first ? 'גדילה' : 'ירידה'} של <b>${money(Math.abs(last - first))}</b>. מחושב מעוגני היתרות + כל תנועה מתועדת.`;
  host.appendChild(note);
}

function renderSavingsRate() {
  const host = $('#rep-sr');
  const rows = ST.savingsRateSeries(S.txs, 6).filter(r => r.income || r.saved);
  if (!rows.length) { $('#rep-sr-aside').textContent = ''; host.innerHTML = '<div class="empty">אין עדיין הכנסות מתועדות</div>'; return; }
  const cur = rows.at(-1);
  $('#rep-sr-aside').innerHTML = cur.rate !== null ? `<b class="num">${Math.round(cur.rate * 100)}%</b> החודש` : '';
  host.replaceChildren(C.columns(
    rows.map(r => ({
      label: monthShort(r.month),
      value: Math.round((r.rate || 0) * 100),
      sub: `${money0(r.saved)} מתוך ${money0(r.income)}`,
      current: r.month === curMonth(),
    })), { fmt: (v) => v + '%' },
  ));
}

function renderWealth() {
  const host = $('#rep-wealth');
  const dests = ST.wealthByDestination(S.txs);
  if (!dests.length) {
    $('#rep-wealth-aside').textContent = '';
    host.innerHTML = '<div class="empty">אין עדיין העברות לחיסכון והשקעה. ההוצאות הקבועות מסוג ״הפקדה להשקעות״ יופיעו כאן מעצמן.</div>';
    return;
  }
  const total = dests.reduce((s, d) => s + d.total, 0);
  $('#rep-wealth-aside').innerHTML = `<b class="num">${money0(total)}</b> נצבר`;
  const goals = Object.fromEntries(S.budgets.filter(b => b.key.startsWith('goal:')).map(b => [b.key.slice(5), b.amount]));
  host.innerHTML = dests.map(d => {
    const goal = goals[d.name] || 0;
    const p = goal ? Math.min(100, Math.round(d.total / goal * 100)) : 0;
    return `<div class="row" style="cursor:default;align-items:flex-start">
      <span style="flex:1;min-width:0">
        <span style="display:flex;align-items:baseline;gap:9px">
          <span style="flex:1;font-size:13.5px;font-weight:560">${esc(d.name)}</span>
          <span class="num" style="font-size:11.5px;color:var(--ink-3)">${d.monthly ? money0(d.monthly) + ' לחודש' : ''}</span>
          <span class="num" style="font-size:14px;font-weight:640">${money(d.total)}</span>
        </span>
        ${goal ? `<span class="cellbar" style="height:5px"><i style="width:${p}%;background:var(--good)"></i></span>
          <span style="display:block;font-size:11px;color:var(--ink-3);margin-top:3px">${p}% מהיעד ${money0(goal)}</span>`
        : `<span style="display:block;font-size:11px;color:var(--ink-3);margin-top:3px">
            ${d.monthly ? `בקצב הזה: ${money0(d.projectedYearEnd)} עד סוף השנה · ` : ''}מאז ${monthLabel(d.first)}</span>`}
      </span>
      <button class="chip" data-goal="${esc(d.name)}">${goal ? 'שנה יעד' : 'קבע יעד'}</button>
    </div>`;
  }).join('');
}

function renderTradingPnL() {
  const host = $('#rep-trading');
  const p = ST.tradingPnL(S.txs, 12);
  if (!p.rows.length) {
    $('#rep-tr-aside').textContent = '';
    host.innerHTML = '<div class="empty">אין עדיין פעילות מסחר מתועדת — עלויות במחלקת ״מסחר ועסק״ ומשיכות רווח יופיעו כאן.</div>';
    return;
  }
  $('#rep-tr-aside').innerHTML = `<b class="num" style="color:${p.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${p.net < 0 ? '−' : '+'}${money0(Math.abs(p.net))}</b> מצטבר`;
  host.innerHTML = table(
    [{ label: 'חודש' }, { label: 'משיכות', n: true }, { label: 'עלויות', n: true }, { label: 'נטו', n: true }],
    p.rows.map(r => ({
      cells: [
        monthShort(r.month),
        `<span class="num">${r.income ? money0(r.income) : '—'}</span>`,
        `<span class="num">${r.cost ? money0(r.cost) : '—'}</span>`,
        `<span class="num" style="color:${r.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${r.net < 0 ? '−' : '+'}${money0(Math.abs(r.net))}</span>`,
      ],
    })),
    { foot: ['סה״כ', `<span class="num">${money0(p.income)}</span>`, `<span class="num">${money0(p.cost)}</span>`,
      `<span class="num">${p.net < 0 ? '−' : '+'}${money0(Math.abs(p.net))}</span>`] },
  ) + '<div class="hint">משיכות רווח (payout, דיבידנד) מול כל עלויות מחלקת המסחר — פלטפורמות, דאטה, resets ועמלות.</div>';
}

/* ==================== רכיבי סטטיסטיקה ==================== */

/** צ'יפ דלתא — הכיוון והגודל במבט אחד, עם מילה ולא רק צבע */
function delta(value, { invert = true, suffix = '' } = {}) {
  if (value === null || value === undefined || !isFinite(value)) return '';
  const up = value > 0;
  const bad = invert ? up : !up;
  const color = Math.abs(value) < 0.005 ? 'var(--ink-3)' : bad ? 'var(--neg)' : 'var(--delta-up)';
  const arrow = Math.abs(value) < 0.005 ? '' : up ? '▲' : '▼';
  return `<span class="num" style="color:${color};font-size:12px;font-weight:620">${arrow} ${Math.abs(Math.round(value * 100))}%${suffix}</span>`;
}

function renderAttribution() {
  const prev = shiftMonth(S.month, -1);
  const a = ST.attribution(S.txs, prev, S.month);
  const host = $('#an-attribution');
  if (!a.totalA && !a.totalB) { host.innerHTML = '<div class="empty">אין מספיק היסטוריה להשוואה</div>'; return; }
  if (!a.parts.length) { host.innerHTML = '<div class="empty">אין שינוי בין החודשים</div>'; return; }

  $('#an-attr-aside').innerHTML =
    `${monthShort(prev)} ← ${monthShort(S.month)} · ${delta(a.pct)}`;

  const top = a.parts.slice(0, 8);
  const maxAbs = Math.max(...top.map(p => Math.abs(p.delta)), 1);
  const headline = a.delta === 0 ? 'ללא שינוי'
    : `${a.delta > 0 ? 'עלייה' : 'ירידה'} של ${money(Math.abs(a.delta))}`;
  const driver = top[0];

  // כשמחלקות מקזזות זו את זו, תרומה בודדת יכולה לעלות על השינוי הנקי.
  // "160% מהשינוי" קורא כמו באג — במקרה כזה מסבירים את הקיזוז במקום אחוז.
  const share = pct(Math.abs(driver?.delta || 0), Math.abs(a.delta) || 1);
  const offset = a.up.length && a.down.length;
  const why = !driver ? ''
    : share <= 100 && !offset
      ? `הגורם הגדול ביותר: <b>${esc(driver.label)}</b>, ${driver.delta > 0 ? 'עלה' : 'ירד'}
         ב-${money(Math.abs(driver.delta))} — ${share}% מכל השינוי.`
      : `<b>${esc(driver.label)}</b> ${driver.delta > 0 ? 'עלה' : 'ירד'} ב-${money(Math.abs(driver.delta))},
         אבל ${a.up.length && a.down.length ? 'מחלקות אחרות קיזזו חלק מהתנועה' : 'התנועה התפזרה'} —
         לכן השינוי הנקי הוא ${money(Math.abs(a.delta))} בלבד.`;

  host.innerHTML = `
    <div class="panel" style="margin-bottom:12px">
      <div style="font-size:15px;font-weight:600;margin-bottom:4px">${headline}</div>
      <div class="hint" style="margin:0">${why}</div>
      ${offset ? `<div class="hint" style="margin-top:8px">
        ${a.up.length} מחלקות גדלו בסך ${money(a.up.reduce((s, p) => s + p.delta, 0))} ·
        ${a.down.length} קטנו בסך ${money(Math.abs(a.down.reduce((s, p) => s + p.delta, 0)))}
      </div>` : ''}
    </div>
    ${top.map(p => {
      const w = Math.abs(p.delta) / maxAbs * 100;
      const isUp = p.delta > 0;
      return `<div class="row" style="cursor:pointer;align-items:flex-start" data-deptrow="${esc(p.dept)}">
        <span style="flex:1;min-width:0">
          <span style="display:flex;align-items:baseline;gap:9px">
            <span style="flex:1;font-size:13.5px;font-weight:550">${esc(p.label)}</span>
            <span class="num" style="font-size:11.5px;color:var(--ink-3)">${money0(p.from)} ← ${money0(p.to)}</span>
            <span class="num" style="font-size:13.5px;font-weight:620;color:${isUp ? 'var(--neg)' : 'var(--delta-up)'}">${isUp ? '+' : '−'}${money0(Math.abs(p.delta))}</span>
          </span>
          <span class="cellbar" style="display:flex;justify-content:${isUp ? 'flex-start' : 'flex-end'}">
            <i style="width:${w}%;background:${isUp ? 'var(--neg)' : 'var(--delta-up)'}"></i>
          </span>
        </span>
      </div>`;
    }).join('')}
    <div class="legend"><span><i class="swatch" style="background:var(--neg)"></i>גדל</span>
      <span><i class="swatch" style="background:var(--delta-up)"></i>קטן</span></div>`;
}

function renderPace() {
  const host = $('#an-pace');
  S.insights ||= IN.analyze(S.txs);
  const p = ST.projectMonth(S.txs, S.month, S.insights.recurring || []);
  if (!p.spentSoFar) { host.innerHTML = '<div class="empty">אין תנועות בחודש זה</div>'; return; }
  const isCurrent = p.daysLeft > 0 || p.day < p.dim;
  const vsBase = p.baseline ? (p.projected - p.baseline) / p.baseline : null;

  $('#an-pace-aside').innerHTML = isCurrent ? `יום ${p.day} מתוך ${p.dim}` : 'החודש הסתיים';

  const rows = [
    ['יצא עד כה', money(p.spentSoFar)],
    ...(isCurrent ? [
      ['קבועים שעוד לא נחתו', p.remainingFixed ? money(p.remainingFixed) : '—'],
      ['צפי משתנה לשארית החודש', money(p.remainingVariable)],
      ['<b>צפי לסוף החודש</b>', `<b>${money(p.projected)}</b>`],
    ] : [['סה״כ בפועל', `<b>${money(p.projected)}</b>`]]),
    ['חציון 3 חודשים קודמים', p.baseline ? money(p.baseline) : '—'],
  ];
  if (S.budget) rows.push(['תקציב', money(S.budget)]);

  const verdict = !S.budget ? null
    : p.projected > S.budget * 1.05 ? { t: 'חריגה צפויה', c: 'var(--neg)', d: `בקצב הזה תסיים ${money(p.projected - S.budget)} מעל התקציב` }
    : p.projected < S.budget * 0.9 ? { t: 'מתחת לתקציב', c: 'var(--delta-up)', d: `בקצב הזה תסיים ${money(S.budget - p.projected)} מתחת לתקציב` }
    : { t: 'בקצב', c: 'var(--ink-2)', d: 'הצפי קרוב לתקציב' };

  host.innerHTML = `
    ${verdict ? `<div class="panel" style="margin-bottom:12px">
      <div style="font-size:15px;font-weight:620;color:${verdict.c}">${verdict.t}</div>
      <div class="hint" style="margin-top:3px">${verdict.d}</div>
      <div class="meter" style="margin-top:12px">
        <i style="width:${Math.min(100, pct(p.spentSoFar, S.budget))}%"></i>
        <i style="width:${Math.max(0, Math.min(100 - pct(p.spentSoFar, S.budget), pct(p.projected - p.spentSoFar, S.budget)))}%;background:var(--rule-2)"></i>
      </div>
      <div class="hint" style="display:flex;justify-content:space-between;margin-top:6px">
        <span>בפועל ${money0(p.spentSoFar)}</span><span>צפי ${money0(p.projected)}</span></div>
    </div>` : ''}
    ${table([{ label: 'מדד' }, { label: 'ערך', n: true }],
      rows.map(([k, v]) => ({ cells: [k, `<span class="num">${v}</span>`] })))}
    ${vsBase !== null && Math.abs(vsBase) < 3 ? `<div class="hint">הצפי ${vsBase > 0 ? 'גבוה' : 'נמוך'} ב-${Math.abs(Math.round(vsBase * 100))}% מחציון שלושת החודשים הקודמים.</div>` : ''}
    ${p.confident === false ? '<div class="hint">אין עדיין מספיק היסטוריה — הצפי יתחדד אחרי חודשיים.</div>' : ''}`;
}

function renderVolatility() {
  const v = ST.volatility(S.txs).slice(0, 12);
  const host = $('#an-volatility');
  if (!v.length) { host.innerHTML = '<div class="empty">צריך שלושה חודשי היסטוריה לפחות</div>'; return; }
  const band = (cv) => cv < 0.25 ? { t: 'יציב', c: 'var(--good)' }
    : cv < 0.6 ? { t: 'בינוני', c: 'var(--warn)' }
    : { t: 'תנודתי', c: 'var(--serious)' };
  host.innerHTML = table(
    [{ label: 'קטגוריה' }, { label: 'ממוצע חודשי', n: true }, { label: 'סטייה', n: true }, { label: 'יציבות' }, { label: 'מגמה' }],
    v.map(r => {
      const b = band(r.cv);
      return {
        cells: [
          esc(r.label),
          `<span class="num">${money(r.mean)}</span>`,
          `<span class="num">${money(r.sd)}</span>`,
          `<span style="color:${b.c};font-weight:600;font-size:12px">${b.t}</span>
           <span class="num" style="color:var(--ink-3);font-size:11px"> ${r.cv.toFixed(2)}</span>`,
          sparkCell(r.series),
        ],
      };
    }),
  );
}

function renderConcentration() {
  const c = ST.concentration(S.txs, S.month);
  const host = $('#an-concentration');
  if (!c) { host.innerHTML = '<div class="empty">אין נתונים</div>'; return; }
  const level = c.top5Share > 0.7 ? 'מרוכזת מאוד' : c.top5Share > 0.45 ? 'מרוכזת' : 'מפוזרת';
  host.innerHTML = `
    <div class="hero" style="padding:0 0 14px">
      <div class="eyebrow">חמשת הגדולים</div>
      <div class="fig" style="font-size:38px">${Math.round(c.top5Share * 100)}<span class="cur">%</span></div>
      <div class="note">מההוצאה החודשית מרוכזת ב-5 בתי עסק מתוך ${c.merchants}. התמונה ${level}.</div>
    </div>
    ${table([{ label: 'בית עסק' }, { label: 'חלק', n: true }],
      c.top5.map(([n, v]) => ({ cells: [esc(n), `<span class="num">${pct(v, c.total)}%</span>`] })))}`;
}

function renderWeekday() {
  const w = ST.weekdayPattern(S.txs.filter(t => t.month === S.month));
  const host = $('#an-weekday');
  const max = Math.max(...w.map(d => d.perActiveDay), 1);
  if (!w.some(d => d.total)) { host.innerHTML = '<div class="empty">אין נתונים</div>'; return; }
  const peak = [...w].sort((a, b) => b.perActiveDay - a.perActiveDay)[0];
  host.innerHTML =
    w.map(d => `<div class="row" style="cursor:default;align-items:flex-start">
      <span style="flex:1">
        <span style="display:flex;align-items:baseline;gap:9px">
          <span style="flex:1;font-size:13px">${d.label}</span>
          <span class="num" style="font-size:11.5px;color:var(--ink-3)">${d.count} תנועות</span>
          <span class="num" style="font-size:13px;font-weight:600">${money0(d.perActiveDay)}</span>
        </span>
        <span class="cellbar"><i style="width:${d.perActiveDay / max * 100}%;background:${d === peak ? 'var(--s1)' : 'var(--rule-2)'}"></i></span>
      </span>
    </div>`).join('') +
    `<div class="hint">ממוצע ליום פעיל, לא סכום — כך חודש עם חמש שבתות לא נראה כמו הרגל.
      היום הכבד ביותר: <b>${peak.label}</b>.</div>`;
}

function renderCumulative() {
  const c = ST.cumulativeNet(S.txs);
  const host = $('#an-cumulative');
  if (c.length < 2) { host.replaceChildren(emptyEl()); return; }
  const box = document.createElement('div');
  box.appendChild(C.columns(
    c.slice(-12).map(r => ({
      label: monthShort(r.month), value: Math.max(0, r.cumulative),
      sub: `נטו החודש ${money0(r.net)}`, current: r.month === S.month,
    })),
    { fmt: money0 },
  ));
  const last = c.at(-1);
  const note = document.createElement('div');
  note.className = 'hint';
  note.innerHTML = `מאז ${monthLabel(c[0].month)} נשמרו <b>${money(last.cumulative)}</b> נטו.
    ${last.cumulative < 0 ? 'המספר שלילי — יצא יותר ממה שנכנס בסך התקופה.' : ''}`;
  box.appendChild(note);
  host.replaceChildren(box);
}

/* ==================== מסך: תחזית ==================== */

function renderForecast() {
  S.insights ||= IN.analyze(S.txs);
  const fc = ST.forecast(S.txs, S.insights.recurring || [], 3);
  const host = $('#fc-body');
  if (!fc) {
    $('#fc-meta').textContent = '';
    host.innerHTML = '<div class="empty">צריך לפחות שני חודשי היסטוריה כדי לבנות תחזית.</div>';
    return;
  }
  const first = fc.rows[0];
  $('#fc-meta').innerHTML =
    `צפי נטו ל${monthShort(first.month)}: <b style="color:${first.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${first.net < 0 ? '−' : '+'}${money0(Math.abs(first.net))}</b> · ודאות ${Math.round(fc.confidence * 100)}%`;

  const cum = fc.rows.at(-1).cumulative;
  host.innerHTML = table(
    [{ label: 'חודש' }, { label: 'קבוע', n: true }, { label: 'משתנה', n: true },
     { label: 'תשלומים', n: true }, { label: 'צפי יציאה', n: true }, { label: 'נטו', n: true }],
    fc.rows.map(r => ({
      cells: [
        monthLabel(r.month),
        `<span class="num">${money0(r.fixed)}</span>`,
        `<span class="num">${money0(r.variable)}</span>`,
        `<span class="num">${r.installments ? money0(r.installments) : '—'}</span>`,
        `<span class="num">${money0(r.out)}</span>`,
        `<span class="num" style="color:${r.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${r.net < 0 ? '−' : '+'}${money0(Math.abs(r.net))}</span>`,
      ],
    })),
    { foot: ['מצטבר', '', '', '', '', `<span class="num" style="color:${cum >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${cum < 0 ? '−' : '+'}${money0(Math.abs(cum))}</span>`] },
  ) + (fc.rows.some(r => r.installments) ? `<div class="hint">
      התשלומים יורדים לאורך התקופה ככל שסדרות מסתיימות — ${fc.rows.map(r => `${monthShort(r.month)}: ${r.openInstallments}`).join(' · ')} סדרות פתוחות.
    </div>` : '');
}

/**
 * ספירה כלפי מעלה — נותנת למספר משקל בלי להאט את המשתמש.
 *
 * הכלל: הערך הסופי נכתב תמיד, גם אם האנימציה לא תרוץ לעולם.
 * requestAnimationFrame קפוא בלשונית שאינה מצוירת, ובלי הכתיבה הזו
 * המספר החשוב במסך היה נשאר ריק — כישלון שקט של הדבר היחיד שחייב להופיע.
 */
function countUp(el, to, render) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  el.innerHTML = render(to);

  const still = from === to
    || matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.visibilityState !== 'visible';
  if (still) return;

  const t0 = performance.now(), dur = 520;
  let done = false;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.innerHTML = render(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step); else done = true;
  };
  requestAnimationFrame(step);
  // רשת ביטחון: אם המסגרות נעצרו באמצע, הערך הסופי עדיין ננעל
  setTimeout(() => { if (!done) el.innerHTML = render(to); }, dur + 120);
}

function renderHome() {
  const m = curMonth(), now = new Date();
  $('#home-date').textContent = now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  // ---- בורר חשבון ----
  const acts = S.accounts.filter(a => a.active !== false);
  $('#acct-switch').innerHTML =
    `<button class="${!S.acctFilter ? 'on' : ''}" data-acctsel="">הכל</button>` +
    acts.map(a => `<button class="${S.acctFilter === a.id ? 'on' : ''}" data-acctsel="${esc(a.id)}">
      <i style="background:${C.seriesVar(a.slot ?? 0)}"></i>${esc(a.name)}</button>`).join('');

  const scoped = S.acctFilter ? S.txs.filter(t => acctOf(t) === S.acctFilter) : S.txs;
  const st = statsOf(scoped, m);

  // ---- הלוח ----
  const board = $('#board');
  const budget = S.acctFilter ? 0 : S.budget;   // התקציב הוא של משק הבית, לא של חשבון בודד
  const months = monthsBack(12);
  const series = months.map(mm => ({ month: mm, value: statsOf(scoped, mm).out }));
  const peak = Math.max(...series.map(s => s.value), 1);

  let eyebrow, figVal, sub, meter = '';
  if (budget > 0) {
    S.insights ||= IN.analyze(S.txs);
    const up = ST.upcoming(S.txs, S.insights.recurring || [], S.fixed, 30);
    const safe = ST.safeToSpend(S.txs, budget, m, up.total);
    figVal = safe.perDay;
    eyebrow = 'פנוי להוציא היום';
    sub = `<b>${money(st.out)}</b> מתוך ${money(budget)} · נותרו ${safe.daysLeft} ימים` +
      (safe.committed
        ? `<br><span style="color:rgba(255,255,255,.42)">${money(safe.committed)} כבר מחויבים לחיובים ידועים${safe.inflated ? ` · בלעדיהם המספר היה גבוה ב-${money(safe.inflated)}` : ''}</span>`
        : '');
    // הפס מציג שלוש שכבות: מה שיצא, מה שמחויב, ומה שבאמת פנוי
    meter = `<div class="meter">
      <i class="${st.out > budget ? 'over' : ''}" style="width:${Math.min(100, pct(st.out, budget))}%"></i>
      ${safe.committed ? `<i style="width:${Math.min(100 - pct(st.out, budget), pct(safe.committed, budget))}%;background:rgba(255,255,255,.30)"></i>` : ''}
    </div>`;
  } else {
    figVal = st.out;
    eyebrow = S.acctFilter ? `יצא ב${acctName(S.acctFilter)} החודש` : 'הוצאת החודש';
    sub = st.in
      ? `נכנס <b>${money(st.in)}</b> · נטו <b>${money(st.net)}</b>`
      : `<button id="go-budget" style="text-decoration:underline;color:inherit">הגדר תקציב</button> כדי לראות כמה נשאר להיום`;
  }

  board.innerHTML = `
    <div class="eyebrow">${eyebrow}</div>
    <div class="fig ${figVal < 0 ? 'neg' : ''}" id="board-fig"></div>
    ${meter}
    <div class="sub">${sub}</div>
    <div class="spark">${series.map(s =>
      `<i class="${s.month === m ? 'now' : ''}" style="height:${Math.max(2, s.value / peak * 100)}%"
          title="${monthLabel(s.month)} · ${money0(s.value)}"></i>`).join('')}</div>
    <div class="sparkx">${series.map((s, i) =>
      `<span>${(i === 0 || i === series.length - 1 || i === 6) ? monthShort(s.month) : ''}</span>`).join('')}</div>
    ${!S.acctFilter && acts.length > 1 ? `<div class="accts">${acts.map(a => {
      const e = st.byAccount[a.id] || { in: 0, out: 0 };
      return `<div class="acct">
        <div class="n"><i style="background:${C.seriesVar(a.slot ?? 0)}"></i>${esc(a.name)}</div>
        <div class="v">${money0(e.out)}</div>
        <div class="d">${e.in ? `נכנס ${money0(e.in)}` : 'ללא הכנסה'}</div>
      </div>`;
    }).join('')}</div>` : ''}`;
  countUp($('#board-fig'), figVal, heroFig);

  // ---- התראות ----
  const alerts = [];
  const review = S.txs.filter(t => t.needsReview).length;
  if (review) alerts.push(`<div class="note info">${icon('info')}<span class="grow">${review} שורות מפוענחות ממתינות לאישור</span><button data-act="review">פתח</button></div>`);
  if (S.txs.length > 5) {
    const days = S.lastExport ? Math.floor((Date.now() - S.lastExport) / 864e5) : 999;
    if (days > 7) alerts.push(`<div class="note warn">${icon('save')}<span class="grow">${S.lastExport ? `גיבוי אחרון לפני ${days} ימים` : 'עוד לא גיבית את הנתונים'}</span><button data-act="export">גבה</button></div>`);
  }
  $('#home-alerts').innerHTML = alerts.join('');

  renderSetup();
  renderRecap();
  renderBalances();
  renderBudgets();

  // ---- קו מצטבר מול החודש הקודם ----
  const cur = ST.cumulativeDaily(scoped, m, true);
  const prevM = shiftMonth(m, -1);
  const prv = ST.cumulativeDaily(scoped, prevM);
  const lineHost = $('#home-line');
  if (cur.length && prv.length) {
    lineHost.replaceChildren(C.cumulativeLine(cur, prv, { fmt: money0, budget }));
    const sameDay = prv[Math.min(cur.length, prv.length) - 1] || 0;
    const diff = cur.at(-1) - sameDay;
    $('#pace-aside').innerHTML = sameDay
      ? `${diff > 0 ? 'מעל' : 'מתחת'} ב-<b>${money0(Math.abs(diff))}</b> ${delta(diff / sameDay)}`
      : '';
  } else {
    lineHost.innerHTML = '<div class="empty">צריך חודש היסטוריה כדי להשוות קצב</div>';
    $('#pace-aside').textContent = '';
  }

  // ---- מה עומד לרדת ----
  S.insights ||= IN.analyze(S.txs);
  const up = ST.upcoming(S.txs, S.insights.recurring || [], S.fixed, 30);
  $('#upcoming-aside').innerHTML = up.total ? `<b>${money0(up.total)}</b>` : '';
  $('#upcoming').innerHTML = up.items.length
    ? `<div class="rows">${up.items.slice(0, 8).map(u => {
        const d = dept(u.dept);
        const when = new Date(u.date + 'T00:00:00');
        const inDays = Math.max(0, Math.round((when - new Date().setHours(0, 0, 0, 0)) / 864e5));
        return `<div class="row" style="cursor:default">
          <span class="gl">${icon(d?.icon || 'repeat')}</span>
          <span class="body"><span class="t1">${esc(u.label)}${u.note ? `<span class="pill">${esc(u.note)}</span>` : ''}</span>
          <span class="t2">${inDays === 0 ? 'היום' : inDays === 1 ? 'מחר' : `בעוד ${inDays} ימים`} · ${u.date.slice(8)}.${u.date.slice(5, 7)}</span></span>
          <span class="amt">${money(u.amount)}</span></div>`;
      }).join('')}</div>` +
      (up.items.length > 8 ? `<div class="hint">ועוד ${up.items.length - 8} חיובים</div>` : '')
    : '<div class="empty">אין חיובים ידועים ב-30 הימים הקרובים</div>';

  const recent = scoped.slice(0, 8);
  $('#recent').innerHTML = recent.length
    ? `<div class="rows">${recent.map(txRow).join('')}</div>`
    : '<div class="empty">אין עדיין תנועות.<br>צלם דף אשראי או הוסף מזומן.</div>';
}

/* ==================== התחלה ==================== */
// אפליקציה ריקה היא מבוי סתום: הכל עובד ושום דבר לא מראה כלום.
// הרשימה הזו נותנת סדר פעולות, מסמנת מה כבר נעשה, ונעלמת מעצמה
// כשסיימת. היא לא אשף חוסם — אפשר להתעלם ממנה ולעבוד רגיל.

function setupSteps() {
  const named = S.accounts.some(a => a.builtin && a.name !== DEFAULT_ACCOUNT_NAMES[a.id]);
  const anchored = S.accounts.some(a => a.balanceDate);
  return [
    { id: 'accounts', done: named, label: 'תן שם לחשבונות שלך',
      hint: 'שני הבנקים והמזומן — כדי שתדע מה שייך לאיפה', act: 'go-accounts', cta: 'לחשבונות' },
    { id: 'balances', done: anchored, label: 'הזן יתרה נוכחית',
      hint: 'עוגן אחד לכל חשבון. משם הכל מתעדכן לבד', act: 'set-balances', cta: 'הזן' },
    { id: 'budget', done: S.budget > 0, label: 'קבע תקציב חודשי',
      hint: 'המספר הראשי במסך הזה נגזר ממנו', act: 'go-budget', cta: 'קבע' },
    { id: 'key', done: S.hasKey, label: 'חבר מפתח Gemini',
      hint: 'זה מה שהופך צילום מסך ל-30 שורות מסווגות', act: 'go-key', cta: 'חבר' },
    { id: 'first', done: S.txs.length > 0, label: 'הכנס תנועה ראשונה',
      hint: 'צילום של דף אשראי, או הוצאת מזומן', act: 'act-shot', cta: 'התחל' },
  ];
}

function renderSetup() {
  const host = $('#setup');
  const steps = setupSteps();
  const done = steps.filter(s => s.done).length;
  if (done === steps.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `
    <div class="sec">
      <header>
        <h2>נשאר להגדיר</h2>
        <div class="aside num">${done} מתוך ${steps.length}</div>
      </header>
      <div class="meter" style="margin-bottom:14px"><i style="width:${done / steps.length * 100}%"></i></div>
      ${steps.map(s => `
        <div class="row" style="cursor:${s.done ? 'default' : 'pointer'};opacity:${s.done ? '.5' : '1'}"
             ${s.done ? '' : `data-setup="${s.act}"`}>
          <span class="selbox ${s.done ? 'on' : ''}" style="pointer-events:none">${s.done ? icon('check', 11) : ''}</span>
          <span class="body">
            <span class="t1" style="${s.done ? 'text-decoration:line-through' : ''}">${esc(s.label)}</span>
            <span class="t2">${esc(s.hint)}</span>
          </span>
          ${s.done ? '' : `<span class="chip">${s.cta}</span>`}
        </div>`).join('')}
    </div>`;
}

/* ==================== סיכום שבועי ==================== */
// Monarch, Snoop ו-Emma כולם מציעים את זה, ומאותה סיבה: תמונת החודש
// גדולה מדי כדי להרגיש, ותנועה בודדת קטנה מדי. השבוע הוא הרזולוציה
// שבה אפשר עוד לשנות משהו.

function renderRecap() {
  const host = $('#recap');
  const rows = live(S.txs).filter(t => flowOf(t.dept) === 'out');
  if (rows.length < 5) { host.hidden = true; return; }

  const day = 864e5;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const startThis = new Date(now - 6 * day);
  const startPrev = new Date(now - 13 * day);
  const iso = (d) => d.toISOString().slice(0, 10);

  const inRange = (from, to) => rows.filter(t => t.dateBuy >= iso(from) && t.dateBuy <= iso(to));
  const thisWeek = inRange(startThis, now);
  const prevWeek = inRange(startPrev, new Date(now - 7 * day));
  if (!thisWeek.length) { host.hidden = true; return; }

  const sum = (a) => a.reduce((s, t) => s + ils(t), 0);
  const tw = sum(thisWeek), pw = sum(prevWeek);
  const diff = pw ? (tw - pw) / pw : null;

  // המחלקה שהזיזה הכי הרבה בין השבועות
  const byDept = (a) => a.reduce((m, t) => (m[t.dept] = (m[t.dept] || 0) + ils(t), m), {});
  const A = byDept(prevWeek), B = byDept(thisWeek);
  const movers = [...new Set([...Object.keys(A), ...Object.keys(B)])]
    .map(k => ({ k, d: (B[k] || 0) - (A[k] || 0) }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const top = movers[0];

  const biggest = [...thisWeek].sort((a, b) => ils(b) - ils(a))[0];

  host.hidden = false;
  host.innerHTML = `
    <div class="sec">
      <header><h2>שבעת הימים האחרונים</h2>
        ${diff !== null ? `<div class="aside">${delta(diff)}</div>` : ''}</header>
      <div class="panel">
        <div style="font-size:26px;font-weight:660;letter-spacing:-.02em" class="num">${money(tw)}</div>
        <div class="hint" style="margin-top:4px">
          ${pw ? `שבוע קודם ${money(pw)}. ` : ''}
          ${top && top.d ? `<b>${esc(dept(top.k)?.label || top.k)}</b> ${top.d > 0 ? 'עלה' : 'ירד'} ב-${money(Math.abs(top.d))}.` : ''}
        </div>
        ${biggest ? `<div class="hint">ההוצאה הגדולה: ${esc(biggest.merchant || catLabel(biggest.dept, biggest.cat))} · ${money(ils(biggest))}</div>` : ''}
        <div class="hint">${thisWeek.length} תנועות · ממוצע ${money(Math.round(tw / 7))} ליום</div>
      </div>
    </div>`;
}

/* ==================== יתרות ==================== */

function renderBalances() {
  const host = $('#balances');
  const b = ST.balances(S.txs, S.accounts.filter(a => a.active !== false));
  if (!b.covered) {
    host.innerHTML = `<div class="empty">האפליקציה יודעת כמה נכנס ויצא, אבל לא כמה יש לך.<br>
      הזן יתרה אחת לכל חשבון — משם היא מתעדכנת לבד מכל תנועה.
      <div style="margin-top:14px"><button class="btn accent sm" id="set-balances">הזנת יתרות</button></div></div>`;
    return;
  }
  const stale = b.oldestAnchor
    ? Math.floor((Date.now() - new Date(b.oldestAnchor + 'T00:00:00')) / 864e5) : 0;

  host.innerHTML = `
    <div class="panel" style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:660;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)">
        ${b.complete ? 'סך הכל בחשבונות' : `סך ${b.covered} מתוך ${b.total} חשבונות`}</div>
      <div style="font-size:32px;font-weight:660;letter-spacing:-.03em;margin-top:4px" class="prop">${money(b.netWorth)}</div>
      ${stale > 45 ? `<div class="hint" style="color:var(--warn)">היתרה מעוגנת לפני ${stale} ימים — שווה לרענן מול הבנק.</div>` : ''}
    </div>
    ${table(
      [{ label: 'חשבון' }, { label: 'עוגן', n: true }, { label: 'תנועה מאז', n: true }, { label: 'יתרה', n: true }],
      b.accounts.map(a => ({
        cells: [
          `<i class="swatch" style="background:${C.seriesVar(a.slot ?? 0)}"></i>${esc(a.name)}` +
          (a.anchored ? `<div style="font-size:11px;color:var(--ink-3)">מ-${a.anchorDate} · ${a.moves} תנועות</div>` : ''),
          a.anchored ? `<span class="num">${money(a.anchor)}</span>` : '<span style="color:var(--ink-3)">—</span>',
          a.anchored
            ? `<span class="num" style="color:${a.movement >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${a.movement >= 0 ? '+' : '−'}${money0(Math.abs(a.movement))}</span>`
            : '—',
          a.anchored ? `<b class="num">${money(a.current)}</b>` : '<span style="color:var(--ink-3)">לא הוגדר</span>',
        ],
      })),
    )}`;
}

function openBalances() {
  const b = ST.balances(S.txs, S.accounts.filter(a => a.active !== false));
  $('#balances-body').innerHTML = `
    <div class="hint" style="margin:0 0 14px">הזן את היתרה כפי שהיא הייתה <b>בתחילת</b> התאריך שתבחר.
      מאותו יום ואילך כל תנועה שתרשום מזיזה אותה לבד — הכנסה מוסיפה, הוצאה מחסירה.</div>
    ${b.accounts.map(a => `
      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <i class="swatch" style="background:${C.seriesVar(a.slot ?? 0)};margin:0"></i>
          <b style="font-size:14px">${esc(a.name)}</b>
        </div>
        <div class="pair">
          <div class="field" style="margin:0"><label>יתרה ₪</label>
            <input class="inp" type="number" step="0.01" inputmode="decimal"
              data-bal="${esc(a.id)}" value="${a.anchored ? a.anchor / 100 : ''}"></div>
          <div class="field" style="margin:0"><label>בתחילת תאריך</label>
            <input class="inp" type="date" data-baldate="${esc(a.id)}"
              value="${a.anchorDate || todayISO()}"></div>
        </div>
        ${a.anchored ? `<div class="hint">כרגע מחושב: <b>${money(a.current)}</b></div>` : ''}
      </div>`).join('')}
    <button class="btn accent" id="save-balances">שמירה</button>`;
  openSheet('sh-balances');
}

async function saveBalances() {
  for (const a of S.accounts) {
    const v = $(`[data-bal="${a.id}"]`);
    const d = $(`[data-baldate="${a.id}"]`);
    if (!v) continue;
    const raw = v.value.trim();
    await DB.put('accounts', {
      ...a,
      balance: raw === '' ? 0 : toAgorot(raw),
      balanceDate: raw === '' ? null : (d?.value || todayISO()),
    });
  }
  await reload();
  closeSheet('sh-balances');
  toast('היתרות עודכנו');
  render();
}

/* ==================== תקציבי קטגוריה ==================== */

function renderBudgets() {
  const host = $('#budgets');
  const st = ST.budgetStatus(S.txs, S.budgets, curMonth());
  if (!st.items.length) {
    host.innerHTML = `<div class="empty">תקציב אחד גלובלי לא אומר לך איפה חרגת.<br>
      הגדר תקציב לקטגוריות שחשובות לך — מזון, יציאות, קניות.
      <div style="margin-top:14px"><button class="btn accent sm" id="set-budgets">הגדרת תקציבים</button></div></div>`;
    return;
  }
  const COLOR = { over: 'var(--neg)', ahead: 'var(--warn)', ok: 'var(--s1)', unused: 'var(--rule-2)' };
  const WORD = { over: 'חריגה', ahead: 'מקדים', ok: 'בקצב', unused: 'לא נוגע' };
  const carried = ST.rollover(S.txs, S.budgets, curMonth());
  host.innerHTML =
    (st.over || st.ahead
      ? `<div class="note ${st.over ? 'bad' : 'warn'}">${icon('alert')}<span class="grow">
         ${st.over ? `${st.over} קטגוריות בחריגה` : `${st.ahead} קטגוריות מקדימות את הקצב`}</span></div>`
      : '') +
    st.items.map(i => `
      <div class="row" style="cursor:pointer;align-items:flex-start" data-deptrow="${esc(i.dept)}">
        <span style="flex:1;min-width:0">
          <span style="display:flex;align-items:baseline;gap:9px">
            <span style="flex:1;font-size:13.5px;font-weight:550">${esc(i.label)}</span>
            <span style="font-size:11px;font-weight:620;color:${COLOR[i.state]}">${WORD[i.state]}</span>
            <span class="num" style="font-size:13px">${money0(i.spent)} <span style="color:var(--ink-3)">/ ${money0(i.amount)}</span></span>
          </span>
          <span class="cellbar" style="height:5px">
            <i style="width:${Math.min(100, i.ratio * 100)}%;background:${COLOR[i.state]}"></i>
          </span>
          <span style="display:block;font-size:11px;color:var(--ink-3);margin-top:4px">
            ${i.left >= 0 ? `נשאר ${money(i.left)}` : `חרגת ב-${money(-i.left)}`}
            ${carried.get(i.key) ? ` · <b style="color:var(--delta-up)">+${money(carried.get(i.key))} גלגול</b>` : ''}
          </span>
        </span>
      </div>`).join('');
}

const ROLL = new Set();

function openBudgets() {
  const byKey = Object.fromEntries(S.budgets.map(b => [b.key, b.amount]));
  ROLL.clear();
  S.budgets.filter(b => b.rollover).forEach(b => ROLL.add(b.key));
  const rollKeys = ROLL;
  const st = ST.budgetStatus(S.txs, S.budgets, curMonth());
  const spent3 = (deptKey) => {
    const ms = ST.monthsRange(shiftMonth(curMonth(), -1), 3);
    const vals = ms.map(m => live(S.txs).filter(t => t.month === m && t.dept === deptKey && flowOf(t.dept) === 'out')
      .reduce((s, t) => s + ils(t), 0));
    return ST.median(vals.filter(v => v > 0));
  };
  $('#budgets-body').innerHTML = `
    <div class="hint" style="margin:0 0 14px">השאר ריק כדי לא לתקצב. ההצעה שלצד כל שדה היא
      חציון שלושת החודשים הקודמים — נקודת פתיחה מציאותית ולא משאלה.</div>
    ${EXPENSE_DEPTS.map(d => {
      const sug = spent3(d.key);
      return `<div class="field">
        <label style="display:flex;justify-content:space-between;text-transform:none;letter-spacing:0;font-size:12px">
          <span>${icon(d.icon, 13)} ${esc(d.label)}</span>
          ${sug ? `<button data-sug="${d.key}:${sug}" style="color:var(--accent);font-size:11px;text-decoration:underline">הצע ${money0(sug)}</button>` : ''}
        </label>
        <div class="pair">
          <input class="inp" type="number" inputmode="decimal" placeholder="ללא תקציב"
            data-budget="${d.key}" value="${byKey[d.key] ? byKey[d.key] / 100 : ''}">
          <button class="chip ${rollKeys.has(d.key) ? 'on' : ''}" data-roll="${d.key}"
            style="flex:0 0 auto;white-space:nowrap">גלגול</button>
        </div>
      </div>`;
    }).join('')}
    <button class="btn accent" id="save-budgets">שמירה</button>
    <div class="hint">סה״כ מתוקצב כרגע: <b>${money(st.totalBudget)}</b>.
      <b>גלגול</b> מעביר יתרה שלא נוצלה לחודש הבא — כך חודש חריג אחד לא הורס
      את התקציב, ואפשר לצבור לקנייה גדולה.</div>`;
  openSheet('sh-budgets');
}

async function saveBudgets() {
  // עוגן הגלגול נשמר מהקיים כדי שעריכת סכום לא תאפס את הצבירה,
  // ויעדי goal: חיים באותו מחסן — מחיקה גורפת הייתה מוחקת אותם בשקט
  const prev = Object.fromEntries(S.budgets.map(b => [b.key, b.since]));
  const goals = S.budgets.filter(b => b.key.startsWith('goal:'));
  await DB.clear('budgets');
  if (goals.length) await DB.putMany('budgets', goals);
  const rows = [];
  for (const el of $$('[data-budget]')) {
    const amount = toAgorot(el.value);
    const key = el.dataset.budget;
    if (amount > 0) rows.push({ key, amount, rollover: ROLL.has(key), since: prev[key] || curMonth() });
  }
  if (rows.length) await DB.putMany('budgets', rows);
  await reload();
  closeSheet('sh-budgets');
  toast(rows.length ? `${rows.length} תקציבים נשמרו` : 'התקציבים נוקו');
  render();
}

/* ==================== פיצול תנועה ==================== */

function openSplit(id) {
  const t = S.txs.find(x => x.id === id);
  if (!t) return;
  SPLIT.parent = t;
  SPLIT.parts = [
    { amount: Math.round(ils(t) / 2), dept: t.dept, cat: t.cat },
    { amount: ils(t) - Math.round(ils(t) / 2), dept: 'food', cat: 'general' },
  ];
  drawSplit();
  openSheet('sh-split');
}

const SPLIT = { parent: null, parts: [] };

function drawSplit() {
  const t = SPLIT.parent;
  const sum = SPLIT.parts.reduce((s, p) => s + p.amount, 0);
  const diff = ils(t) - sum;
  $('#split-body').innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div style="font-weight:620">${esc(t.merchant || catLabel(t.dept, t.cat))}</div>
      <div style="font-size:22px;font-weight:660;margin-top:3px" class="num">${money(ils(t))}</div>
    </div>
    ${SPLIT.parts.map((p, i) => `
      <div class="panel" style="margin-bottom:9px">
        <div class="pair">
          <div class="field" style="margin:0"><label>סכום ₪</label>
            <input class="inp" type="number" step="0.01" inputmode="decimal"
              data-splitamt="${i}" value="${p.amount / 100}"></div>
          <div class="field" style="margin:0"><label>קטגוריה</label>
            <button class="inp" data-splitcat="${i}" style="text-align:right;font-size:13px">${esc(catLabel(p.dept, p.cat))}</button></div>
        </div>
        ${SPLIT.parts.length > 2 ? `<button data-splitdel="${i}" style="font-size:12px;color:var(--critical);text-decoration:underline;margin-top:6px">הסר חלק</button>` : ''}
      </div>`).join('')}
    <button class="btn ghost sm" id="split-add" style="margin-bottom:12px">+ חלק נוסף</button>
    <div id="split-status"></div>
    <button class="btn accent" id="split-save">פצל</button>`;
  updateSplitBalance();
}

/** מאזן הפיצול נבדק בכל הקלדה — חלק אפס או הפרש חוסמים שמירה */
function updateSplitBalance() {
  const t = SPLIT.parent;
  if (!t) return;
  const sum = SPLIT.parts.reduce((s, p) => s + p.amount, 0);
  const diff = ils(t) - sum;
  const empty = SPLIT.parts.filter(p => p.amount <= 0).length;
  const ok = diff === 0 && !empty;

  const msg = empty
    ? `${empty === 1 ? 'חלק אחד' : `${empty} חלקים`} ללא סכום`
    : diff === 0 ? 'הסכומים מתאזנים'
    : `הפרש של ${money(Math.abs(diff))} ${diff > 0 ? 'חסר' : 'עודף'}`;

  const box = $('#split-status');
  if (box) {
    box.innerHTML = `<div class="note ${ok ? 'ok' : 'warn'}" style="margin-bottom:12px">
      ${icon(ok ? 'check' : 'alert')}<span class="grow">${msg}</span>
      ${!ok && !empty ? `<button id="split-fix">אזן אוטומטית</button>` : ''}</div>`;
  }
  const btn = $('#split-save');
  if (btn) {
    btn.disabled = !ok;
    btn.textContent = ok ? `פצל ל-${SPLIT.parts.length} תנועות` : 'הסכומים לא מאוזנים';
  }
}

async function saveSplit() {
  const t = SPLIT.parent;
  const recs = SPLIT.parts.map(p => mkTx({
    dateBuy: t.dateBuy, dateCharge: t.dateCharge, merchant: t.merchant,
    amount: p.amount, ils: p.amount, currency: 'ILS',
    dept: p.dept, cat: p.cat, account: t.account, method: t.method,
    tags: t.tags, note: t.note, source: 'split', splitOf: t.id,
  }));
  await DB.saveTxMany(recs);
  await DB.del('tx', t.id);
  await reload();
  closeSheet('sh-split');
  toast(`פוצל ל-${recs.length} תנועות`);
  render();
}

/* ==================== ניהול חוקים ==================== */

function openRules() {
  const rules = [...S.rules].sort((a, b) => (b.hits || 0) - (a.hits || 0));
  $('#rules-body').innerHTML = `
    <div class="hint" style="margin:0 0 14px">כל תיוג שאתה עושה נשמר כאן ומוחל אוטומטית בפעם הבאה.
      אפשר לתקן או למחוק — תיקון כאן משנה את הסיווג של כל מה שיגיע בעתיד.</div>
    ${rules.length ? `<div class="rows">${rules.map(r => `
      <div class="row" style="cursor:default">
        <span class="body">
          <span class="t1">${esc(r.merchant || r.key)}</span>
          <span class="t2">${esc(pathLabel(r.dept, r.cat))} · הוחל ${r.hits || 0} פעמים</span>
        </span>
        <button class="chip" data-ruleedit="${esc(r.key)}">שנה</button>
        <button class="chip" data-ruledel="${esc(r.key)}" style="color:var(--critical)">✕</button>
      </div>`).join('')}</div>`
      : '<div class="empty">אין עדיין חוקים. הם נוצרים לבד מכל תנועה שאתה מתייג.</div>'}`;
  openSheet('sh-rules');
}

/* ==================== מגירת בית עסק ==================== */
// כל שם בית עסק ברשימות הוא דלת: היסטוריה, ממוצע, מגמה, והחוק שחל עליו.

let MERCH = null;

function openMerchant(name) {
  if (!name) return;
  MERCH = name;
  const key = DB.normMerchant(name);
  const rows = live(S.txs).filter(t => DB.normMerchant(t.merchant) === key)
    .sort((a, b) => b.dateBuy.localeCompare(a.dateBuy));
  if (!rows.length) return;

  const vals = rows.map(t => ils(t));
  const total = vals.reduce((s, v) => s + v, 0);
  const byMonth = new Map();
  for (const t of rows) byMonth.set(t.month, (byMonth.get(t.month) || 0) + ils(t));
  const series = ST.monthsRange(curMonth(), 6).map(m => byMonth.get(m) || 0);
  const rule = S.rules.find(r => r.key === key);
  const t0 = rows[0];

  $('#merch-title').textContent = name;
  $('#merch-body').innerHTML = `
    <div class="tiles" style="margin-bottom:12px">
      <div class="tile"><div class="k">סה״כ</div><div class="v num">${money0(total)}</div></div>
      <div class="tile"><div class="k">תנועות</div><div class="v num">${rows.length}</div></div>
      <div class="tile"><div class="k">חציון</div><div class="v num">${money0(ST.median(vals))}</div></div>
    </div>
    <div class="panel" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="flex:1;font-size:12.5px;color:var(--ink-2)">6 חודשים אחרונים</span>
        ${C.sparkline(series, { width: 120, height: 26 }).outerHTML}
      </div>
      <div class="hint" style="margin-top:8px">
        מסווג: <b>${esc(pathLabel(t0.dept, t0.cat))}</b>
        ${rule ? ` · חוק פעיל (הוחל ${rule.hits || 0} פעמים)` : ' · אין חוק — כל תנועה מסווגת לבד'}
      </div>
    </div>
    <div class="rows" style="margin-bottom:12px">${rows.slice(0, 8).map(t => txRow(t)).join('')}</div>
    ${rows.length > 8 ? `<div class="hint">ועוד ${rows.length - 8} — הכפתור למטה מסנן את כולן</div>` : ''}
    <div class="btnrow">
      <button class="btn ghost sm" data-merch-act="recat">${icon('gear')}סווג מחדש הכל</button>
      <button class="btn ghost sm" data-merch-act="rename">${icon('list')}שנה שם</button>
      <button class="btn ghost sm" data-merch-act="filter">${icon('search')}סנן בתנועות</button>
    </div>`;
  openSheet('sh-merch');
}

async function merchantAction(act) {
  const key = DB.normMerchant(MERCH);
  const rows = S.txs.filter(t => DB.normMerchant(t.merchant) === key);
  if (act === 'recat') { openCatPicker({ merch: MERCH }, `${rows[0].dept}/${rows[0].cat}`); return; }
  if (act === 'filter') {
    closeSheet('sh-merch');
    S.q = MERCH; S.view = 'ledger'; render();
    setTimeout(() => { const q = $('#q'); if (q) q.value = MERCH; }, 120);
    return;
  }
  if (act === 'rename') {
    const name = (prompt('שם חדש לבית העסק:', MERCH) || '').trim().slice(0, 80);
    if (!name || name === MERCH) return;
    await DB.snapshot('לפני שינוי שם');
    for (const t of rows) t.merchant = name;
    await DB.saveTxMany(rows);
    const rule = S.rules.find(r => r.key === key);
    if (rule) { await DB.del('rules', key); await DB.learn(name, rule); }
    await reload();
    toast(`שונה שם ל-${rows.length} תנועות`);
    openMerchant(name);
    render();
  }
}

/* ==================== שאל את הכסף ==================== */

function askContext() {
  const months = ST.monthsRange(curMonth(), 3);
  const perMonth = months.map(m => {
    const st = statsFor(m);
    return {
      חודש: m, יצא: Math.round(st.out / 100), נכנס: Math.round(st.in / 100),
      לפי_מחלקה: Object.fromEntries(Object.entries(st.byDept)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [dept(k)?.label || k, Math.round(v / 100)])),
    };
  });
  const st = statsFor(curMonth());
  const up = ST.upcoming(S.txs, S.insights?.recurring || [], S.fixed, 30);
  const bal = ST.balances(S.txs, S.accounts.filter(a => a.active !== false));
  const bud = ST.budgetStatus(S.txs, S.budgets, curMonth());
  return JSON.stringify({
    היום: todayISO(),
    חודשים: perMonth,
    בתי_עסק_מובילים_החודש: Object.fromEntries(Object.entries(st.byMerchant)
      .sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => [k, Math.round(v / 100)])),
    תקציבים: bud.items.map(i => ({ קטגוריה: i.label, תקציב: Math.round(i.amount / 100), נוצל: Math.round(i.spent / 100) })),
    עומד_לרדת_30_יום: Math.round(up.total / 100),
    שווי_נקי: bal.covered ? Math.round(bal.netWorth / 100) : null,
    הכל_בשקלים: true,
  });
}

async function runAsk() {
  const q = $('#ask-q').value.trim();
  const out = $('#ask-a');
  if (!q) return;
  if (!S.hasKey) {
    out.innerHTML = `<div class="note warn">${icon('key')}<span class="grow">צריך מפתח Gemini — הגדרות ← מפתח</span></div>`;
    return;
  }
  out.innerHTML = `<div class="note info"><div class="spinner"></div><span>חושב…</span></div>`;
  try {
    const a = await AI.ask(q, askContext());
    out.innerHTML = `<div class="panel" style="margin-top:10px;white-space:pre-wrap;font-size:14px;line-height:1.55">${esc(a)}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="note bad">${icon('alert')}<span class="grow">${esc(e.message)}</span></div>`;
  }
}

/* ==================== דוח חודשי להורדה ==================== */

function buildMonthReport(m) {
  const st = statsFor(m);
  const sr = ST.savingsRateSeries(S.txs, 13).find(r => r.month === m);
  const rows = live(S.txs.filter(t => t.month === m));
  const out = rows.filter(t => flowOf(t.dept) === 'out').sort((a, b) => ils(b) - ils(a));
  const fmtN = (ag) => (ag / 100).toLocaleString('he-IL', { maximumFractionDigits: 0 });
  const deptRows = Object.entries(st.byDept).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${esc(dept(k)?.label || k)}</td><td class="n">₪${fmtN(v)}</td><td class="n">${pct(v, st.out)}%</td></tr>`).join('');
  const merchRows = Object.entries(st.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">₪${fmtN(v)}</td></tr>`).join('');
  const bigRows = out.slice(0, 10)
    .map(t => `<tr><td>${t.dateBuy.slice(8)}.${t.dateBuy.slice(5, 7)}</td><td>${esc(t.merchant || pathLabel(t.dept, t.cat))}</td><td class="n">₪${fmtN(ils(t))}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>דוח כסף · ${monthLabel(m)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:32px 20px;color:#111;background:#fff;line-height:1.5}
h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:26px 0 8px;color:#666;text-transform:uppercase;letter-spacing:.06em}
.k{display:flex;gap:14px;margin:18px 0}.k div{flex:1;border:1px solid #e3e3e3;border-radius:10px;padding:12px}
.k b{display:block;font-size:20px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13.5px}td{padding:6px 4px;border-bottom:1px solid #eee}
td.n{text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:#888;font-size:12px}
</style></head><body>
<h1>דוח חודשי · ${monthLabel(m)}</h1>
<div class="muted">הופק ${todayISO()} · כסף — מעקב הוצאות</div>
<div class="k">
  <div>יצא<b>₪${fmtN(st.out)}</b></div>
  <div>נכנס<b>₪${fmtN(st.in)}</b></div>
  <div>נטו<b>${st.net < 0 ? '−' : ''}₪${fmtN(Math.abs(st.net))}</b></div>
  ${sr && sr.rate !== null ? `<div>שיעור חיסכון<b>${Math.round(sr.rate * 100)}%</b></div>` : ''}
</div>
<h2>לפי מחלקה</h2><table>${deptRows}</table>
<h2>בתי העסק הגדולים</h2><table>${merchRows}</table>
<h2>עשר ההוצאות הגדולות</h2><table>${bigRows}</table>
<div class="muted" style="margin-top:26px">${st.count} תנועות בחודש זה. הדוח כולל סיכומים בלבד.</div>
</body></html>`;
}

/* ==================== מסך: ניתוח ==================== */

function renderAnalysis() {
  const m = S.month, st = statsFor(m), prev = statsFor(shiftMonth(m, -1));
  $('#an-title').textContent = monthLabel(m);
  $('#an-next').style.visibility = m >= curMonth() ? 'hidden' : 'visible';
  const diff = prev.out ? Math.round((st.out - prev.out) / prev.out * 100) : null;
  $('#an-meta').innerHTML = st.count
    ? `${st.count} תנועות${diff !== null ? ` · ${diff >= 0 ? '+' : ''}${diff}% מהחודש הקודם` : ''}`
    : 'אין תנועות בחודש זה';

  $('#an-tiles').innerHTML = `
    <div class="tile"><div class="k">יצא</div><div class="v">${money0(st.out)}</div><div class="d">${st.count} תנועות</div></div>
    <div class="tile"><div class="k">נכנס</div><div class="v pos">${money0(st.in)}</div><div class="d">${Object.values(st.byAccount).filter(s => s.in).length} מקורות</div></div>
    <div class="tile"><div class="k">נטו</div><div class="v ${st.net >= 0 ? 'pos' : 'neg'}">${st.net < 0 ? '−' : ''}${money0(st.net)}</div><div class="d">${st.in ? pct(st.net, st.in) + '% מההכנסה' : '—'}</div></div>`;

  renderSankey(st);

  // מפל
  $('#an-waterfall').replaceChildren(st.in || st.out
    ? C.waterfall([
        { label: 'נכנס', value: st.in, type: 'add' },
        { label: 'קבוע', value: st.kind.fixed, type: 'sub' },
        { label: 'משתנה', value: st.kind.variable, type: 'sub' },
        { label: 'חד-פעמי', value: st.kind.oneoff, type: 'sub' },
        { label: 'נטו', value: st.net, type: 'total' },
      ], { fmt: money0 })
    : emptyEl());

  renderAttribution();
  renderPace();
  renderAccounts(st);
  renderDepts(st);
  renderStack();
  renderVolatility();
  renderConcentration();
  renderWeekday();
  renderCumulative();
  renderSplit('#an-kind', [
    { label: KIND_LABEL.fixed, value: st.kind.fixed, color: 'var(--s1)' },
    { label: KIND_LABEL.variable, value: st.kind.variable, color: 'var(--s2)' },
    { label: KIND_LABEL.oneoff, value: st.kind.oneoff, color: 'var(--s7)' },
  ], st.out);
  renderSplit('#an-need', [
    { label: NEED_LABEL.essential, value: st.need.essential, color: 'var(--s1)' },
    { label: NEED_LABEL.discretionary, value: st.need.discretionary, color: 'var(--s2)' },
  ], st.out);
  renderHeat(st, m);
  renderForecast();

  // בתי עסק
  const merch = Object.entries(st.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $('#an-merchants').innerHTML = merch.length ? table(
    [{ label: 'בית עסק' }, { label: 'סכום', n: true }, { label: 'חלק', n: true }],
    merch.map(([name, v]) => ({
      click: true, data: `data-merch="${esc(name)}"`,
      cells: [esc(name), `<span class="num">${money(v)}</span>`, `<span class="num">${pct(v, st.out)}%</span>`],
    })),
    { foot: ['סה״כ', `<span class="num">${money(st.out)}</span>`, '100%'] },
  ) + '<div class="hint">געו בבית עסק להיסטוריה, מגמה ופעולות עליו.</div>' : '<div class="empty">אין נתונים</div>';

  // תשלומים
  const open = live(S.txs).filter(t => t.installment && t.installment.of > t.installment.n && flowOf(t.dept) === 'out');
  $('#an-inst').innerHTML = open.length ? table(
    [{ label: 'בית עסק' }, { label: 'מצב' }, { label: 'לחודש', n: true }, { label: 'נותר', n: true }],
    open.sort((a, b) => ils(b) * (b.installment.of - b.installment.n) - ils(a) * (a.installment.of - a.installment.n))
      .map(t => ({
        cells: [
          esc(t.merchant || catLabel(t.dept, t.cat)),
          `${t.installment.n}/${t.installment.of}`,
          `<span class="num">${money(ils(t))}</span>`,
          `<span class="num">${money(ils(t) * (t.installment.of - t.installment.n))}</span>`,
        ],
      })),
    { foot: ['סה״כ מחויב קדימה', '', '', `<span class="num">${money(open.reduce((s, t) => s + ils(t) * (t.installment.of - t.installment.n), 0))}</span>`] },
  ) : '<div class="empty">אין תשלומים פתוחים</div>';
}

function renderSankey(st) {
  const host = $('#an-sankey');
  const rows = live(S.txs.filter(t => t.month === S.month));

  // מקורות הכנסה — גוון אחד מדורג, לא הפלטה הקטגורית.
  // אחרת אותו כחול מסמן "משכורת" בצד אחד ו"דיור" בצד השני, ואותו צבע
  // שמייצג שני דברים שונים באותו גרף הוא בדיוק מה שהופך אותו ללא-קריא.
  const INCOME_RAMP = ['var(--q9)', 'var(--q7)', 'var(--q5)', 'var(--q4)', 'var(--q3)', 'var(--q2)'];
  const inBy = {};
  for (const t of rows) {
    if (flowOf(t.dept) !== 'in') continue;
    const k = catLabel(t.dept, t.cat);
    inBy[k] = (inBy[k] || 0) + ils(t);
  }
  const sources = Object.entries(inBy).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, value], i) => ({ label, value, color: INCOME_RAMP[i] || INCOME_RAMP.at(-1) }));

  // יעדי הוצאה לפי מחלקה — עד 7 ואז "אחר", לעולם לא מחזור צבעים
  const outBy = Object.entries(st.byDept).sort((a, b) => b[1] - a[1]);
  const top = outBy.slice(0, 7);
  const rest = outBy.slice(7).reduce((s, e) => s + e[1], 0);
  const targets = top.map(([k, v], i) => ({ label: dept(k)?.label || k, value: v, color: C.seriesVar(i) }));
  if (rest > 0) targets.push({ label: 'אחר', value: rest, color: C.OTHER_COLOR });

  // מה שנשאר הוא יעד לכל דבר. בלעדיו הזרימה לא נסגרת, והצומת נשאר
  // עם שטח ריק שנראה כמו באג במקום כמו חיסכון.
  if (st.net > 0) targets.push({ label: 'נשאר', value: st.net, color: 'var(--good)' });

  if (!sources.length && !targets.length) { host.replaceChildren(emptyEl()); return; }
  $('#an-flow-aside').innerHTML = st.in
    ? `נשמרו <b>${pct(Math.max(0, st.net), st.in)}%</b> מההכנסה`
    : '';
  host.replaceChildren(C.sankey(sources, targets, { fmt: money0, hubLabel: 'נכנס' }));
}

const emptyEl = () => {
  const d = document.createElement('div');
  d.className = 'empty';
  d.textContent = 'אין נתונים';
  return d;
};

function renderAccounts(st) {
  const host = $('#an-accounts');
  const rows = S.accounts.map(s => {
    const e = st.byAccount[s.id] || { in: 0, out: 0 };
    return { id: s.id, label: s.name, inV: e.in, outV: e.out, net: e.in - e.out };
  }).filter(r => r.inV || r.outV);

  if (!rows.length) { host.replaceChildren(emptyEl()); return; }

  if (S.modes.accounts === 'table') {
    host.innerHTML = table(
      [{ label: 'מקור' }, { label: 'נכנס', n: true }, { label: 'יצא', n: true }, { label: 'נטו', n: true }, { label: 'יחס', n: true }],
      rows.map(r => ({
        click: true, data: `data-acctrow="${r.id}"`,
        cells: [
          `<i class="swatch" style="background:${acctColor(r.id)}"></i>${esc(r.label)}`,
          `<span class="num">${money(r.inV)}</span>`,
          `<span class="num">${money(r.outV)}</span>`,
          `<span class="num" style="color:${r.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${r.net < 0 ? '−' : '+'}${money(Math.abs(r.net))}</span>`,
          `<span class="num">${r.inV ? pct(r.outV, r.inV) + '%' : '—'}</span>`,
        ],
      })),
      {
        foot: ['סה״כ',
          `<span class="num">${money(rows.reduce((s, r) => s + r.inV, 0))}</span>`,
          `<span class="num">${money(rows.reduce((s, r) => s + r.outV, 0))}</span>`,
          `<span class="num">${money(rows.reduce((s, r) => s + r.net, 0))}</span>`, ''],
      },
    );
  } else {
    host.replaceChildren(C.butterfly(rows, {
      fmt: money0,
      onPick: (r) => { S.acctFilter = r.id; S.view = 'ledger'; render(); },
    }));
  }
}

function renderDepts(st) {
  const host = $('#an-depts');
  const entries = Object.entries(st.byDept).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { host.innerHTML = '<div class="empty">אין נתונים</div>'; return; }

  if (S.modes.depts === 'table') {
    host.innerHTML = table(
      [{ label: 'מחלקה' }, { label: 'סכום', n: true }, { label: 'חלק', n: true }, { label: 'תנועות', n: true }],
      entries.map(([k, v]) => ({
        click: true, data: `data-deptrow="${k}"`,
        cells: [
          esc(dept(k).label),
          `<span class="num">${money(v)}</span>`,
          `<span class="num">${pct(v, st.out)}%</span>`,
          `<span class="num">${live(S.txs).filter(t => t.month === S.month && t.dept === k).length}</span>`,
        ],
      })),
      { foot: ['סה״כ', `<span class="num">${money(st.out)}</span>`, '100%', ''] },
    );
  } else {
    host.innerHTML = barRows(
      entries.map(([k, v]) => ({ label: dept(k).label, value: v, key: k })),
      st.out,
      { onClickAttr: (it) => `data-deptrow="${it.key}"` },
    );
  }
}

function renderStack() {
  const host = $('#an-stack');
  const months = monthsBack(6, S.month);
  const totals = {};
  for (const mm of months) {
    const s = statsFor(mm);
    for (const [k, v] of Object.entries(s.byDept)) totals[k] = (totals[k] || 0) + v;
  }
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 7).map(e => e[0]);
  const keys = top.map((k, i) => ({ key: k, label: dept(k).label, color: C.seriesVar(i) }));
  const hasOther = Object.keys(totals).length > top.length;
  if (hasOther) keys.push({ key: '__other', label: 'אחר', color: C.OTHER_COLOR });

  const cols = months.map(mm => {
    const s = statsFor(mm);
    const parts = {};
    let other = 0;
    for (const [k, v] of Object.entries(s.byDept)) {
      if (top.includes(k)) parts[k] = v; else other += v;
    }
    if (hasOther) parts.__other = other;
    return { label: monthShort(mm), parts, total: s.out, month: mm };
  });

  if (!cols.some(c => c.total)) { host.replaceChildren(emptyEl()); return; }

  if (S.modes.stack === 'table') {
    host.innerHTML = table(
      [{ label: 'מחלקה' }, ...months.map(mm => ({ label: monthShort(mm), n: true }))],
      keys.map(k => ({
        cells: [
          `<i class="swatch" style="background:${k.color}"></i>${esc(k.label)}`,
          ...cols.map(c => `<span class="num">${c.parts[k.key] ? money0(c.parts[k.key]) : '—'}</span>`),
        ],
      })),
      { foot: ['סה״כ', ...cols.map(c => `<span class="num">${money0(c.total)}</span>`)] },
    );
  } else {
    const box = document.createElement('div');
    box.appendChild(C.stacked(cols, keys, { fmt: money0 }));
    box.appendChild(C.legend(keys));
    host.replaceChildren(box);
  }
}

function renderSplit(sel, items, total) {
  const shown = items.filter(i => i.value > 0);
  $(sel).innerHTML = shown.length
    ? `<div style="display:flex;height:9px;gap:2px;margin-bottom:12px">` +
      shown.map(i => `<i style="flex:${i.value};background:${i.color};border-radius:3px"></i>`).join('') +
      `</div>` + table(
        [{ label: 'סוג' }, { label: 'סכום', n: true }, { label: 'חלק', n: true }],
        shown.map(i => ({ cells: [`<i class="swatch" style="background:${i.color}"></i>${i.label}`, `<span class="num">${money(i.value)}</span>`, `<span class="num">${pct(i.value, total)}%</span>`] })),
      )
    : '<div class="empty">אין נתונים</div>';
}

function renderHeat(st, m) {
  const host = $('#an-heat');
  const days = daysInMonth(m);
  const active = Object.keys(st.byDay).length;
  $('#an-heat-aside').innerHTML = active
    ? `<b>${active}</b> מתוך ${days} ימים עם הוצאה`
    : '';
  if (!active) { host.replaceChildren(emptyEl()); return; }

  if (S.modes.heat === 'table') {
    const rows = Object.entries(st.byDay).sort((a, b) => b[1] - a[1]);
    host.innerHTML = table(
      [{ label: 'יום' }, { label: 'סכום', n: true }],
      rows.map(([d, v]) => ({ cells: [`${d} ב${MONTHS_HE[+m.split('-')[1] - 1]}`, `<span class="num">${money(v)}</span>`] })),
    );
  } else {
    host.replaceChildren(C.heatmap(st.byDay, days, { fmt: money0, monthLabel: MONTHS_HE[+m.split('-')[1] - 1] }));
  }
}

/* ==================== מסך: התייעלות ==================== */

function renderInsights() {
  S.insights ||= IN.analyze(S.txs);
  const R = S.insights;

  if (!R.ready) {
    $('#in-meta').textContent = '';
    $('#in-hero').innerHTML = '';
    $('#in-findings').innerHTML =
      `<div class="empty">המנוע צריך עוד ${R.need} תנועות כדי להתחיל לזהות דפוסים.<br>
       הוא מחפש חיובים חוזרים, התייקרויות שקטות, דליפות קטנות ועמלות מיותרות.</div>`;
    $('#in-recurring').innerHTML = '';
    $('#in-rec-aside').innerHTML = '';
    return;
  }

  const counted = R.findings.filter(f => f.countInTotal !== false && f.annual > 0);
  $('#in-meta').textContent = `${R.findings.length} ממצאים · נבדקו ${live(S.txs).length} תנועות`;
  $('#in-hero').innerHTML = R.totalAnnual > 0
    ? `<div class="eyebrow">פוטנציאל חיסכון שנתי</div>
       <div class="fig">${heroFig(R.totalAnnual)}</div>
       <div class="note">מ-${counted.length} ממצאים שאינם חופפים זה לזה: ${counted.map(f => esc(f.title)).join(' · ')}.
       ממצאים נוספים למטה מפרטים חלקים מאותו כסף ולכן לא נספרו שוב.</div>`
    : `<div class="eyebrow">מצב</div><div class="fig" style="font-size:34px">אין דליפות בולטות</div>
       <div class="note">המנוע לא מצא הוצאה שאפשר לחתוך בלי לוותר על משהו. הממצאים למטה עדיין שווים קריאה.</div>`;

  $('#in-findings').innerHTML = R.findings.map(f => `
    <div class="insight">
      <div class="top">
        <span class="sev ${f.severity}"></span>
        <h3>${esc(f.title)}</h3>
        ${f.annual > 0 ? `<span class="save num" style="color:${f.countInTotal === false ? 'var(--ink-2)' : 'var(--delta-up)'}">${money0(f.annual)}<span style="font-size:10px;color:var(--ink-3)"> לשנה${f.countInTotal === false ? ' · כלול למעלה' : ''}</span></span>` : ''}
      </div>
      <div class="why">${esc(f.why)}</div>
      <div class="act"><b>מה לעשות:</b> ${esc(f.action)}</div>
      ${f.evidence.length ? `<div class="ev">${table(
        [{ label: 'פירוט' }, { label: 'סכום', n: true }],
        f.evidence.map(e => ({
          cells: [
            `${esc(e.label)}${e.sub ? `<div style="font-size:11px;color:var(--ink-3)">${esc(e.sub)}</div>` : ''}`,
            `<span class="num">${money(e.value)}</span>${e.note ? `<div style="font-size:11px;color:var(--ink-3)">${esc(e.note)}</div>` : ''}`,
          ],
        })),
      )}</div>` : ''}
    </div>`).join('');

  const rec = R.recurring;
  $('#in-rec-aside').innerHTML = rec.length
    ? `<b>${money0(rec.reduce((s, r) => s + r.annual, 0))}</b> לשנה`
    : '';
  $('#in-recurring').innerHTML = rec.length ? table(
    [{ label: 'בית עסק' }, { label: 'קטגוריה' }, { label: 'לחודש', n: true }, { label: 'לשנה', n: true }, { label: 'מגמה' }],
    rec.map(r => ({
      cells: [
        esc(r.merchant),
        `<span style="font-size:12px;color:var(--ink-3)">${esc(catLabel(r.dept, r.cat))}</span>`,
        `<span class="num">${money(r.monthly)}</span>`,
        `<span class="num">${money(r.annual)}</span>`,
        sparkCell(r.rows.map(ils)),
      ],
    })),
    { foot: ['סה״כ', '', `<span class="num">${money(rec.reduce((s, r) => s + r.monthly, 0))}</span>`, `<span class="num">${money(rec.reduce((s, r) => s + r.annual, 0))}</span>`, ''] },
  ) : '<div class="empty">עוד לא זוהו חיובים חוזרים.<br>המנוע צריך שלושה חודשים של אותו חיוב כדי לקבוע שהוא קבוע.</div>';
}

function sparkCell(values) {
  const svg = C.sparkline(values, { width: 54, height: 16 });
  const box = document.createElement('div');
  box.appendChild(svg);
  return box.innerHTML;
}

/* ==================== מסך: תנועות ==================== */

const FILTERS = [
  ['all', 'הכל'], ['review', 'לאישור'], ['cash', 'מזומן'], ['credit', 'אשראי'],
  ['fixed', 'קבוע'], ['discretionary', 'רשות'], ['income', 'הכנסות'],
  ['transfer', 'העברות'], ['dup', 'כפילויות'],
];

/* ==================== בחירה מרובה ==================== */
// צילום אחד מייצר 30 שורות. תיקון סיווג אחת-אחת הוא החיכוך הגדול ביותר
// בזרימה, ולכן הבחירה המרובה היא הפיצ׳ר עם ההחזר הגבוה ביותר כאן.

const SEL = new Set();

/**
 * ביטול פעולה. גיבוי מקומי מגן מפני אסון, אבל הוא לא מחליף "אופס".
 * כאן נשמר המצב המדויק של השורות שהשתנו, כדי שאפשר יהיה להחזיר אותן
 * בלחיצה אחת בלי לגעת בשאר הנתונים.
 */
const UNDO = [];

async function undoLast() {
  const step = UNDO.pop();
  if (!step) { toast('אין מה לבטל'); return; }
  if (step.deleted) await DB.saveTxMany(step.before);
  else await DB.saveTxMany(step.before);
  await reload();
  toast(`בוטל: ${step.label}`);
  render();
}

function selBar() {
  if (!SEL.size) return '';
  const rows = S.txs.filter(t => SEL.has(t.id));
  const sum = rows.filter(t => flowOf(t.dept) === 'out').reduce((s, t) => s + ils(t), 0);
  return `<div class="note info" style="position:sticky;top:0;z-index:5">
    ${icon('check')}<span class="grow"><b>${SEL.size}</b> נבחרו · ${money(sum)}</span>
    <button data-bulk="cat">סיווג</button>
    <button data-bulk="acct">חשבון</button>
    <button data-bulk="tag">תגית</button>
    <button data-bulk="del" style="color:var(--critical)">מחק</button>
    <button data-bulk="none">בטל</button>
  </div>`;
}

async function bulkApply(fn, label) {
  const rows = S.txs.filter(t => SEL.has(t.id));
  if (!rows.length) return;
  await DB.snapshot('לפני ' + label);
  UNDO.push({ label, ids: rows.map(r => r.id), before: rows.map(r => ({ ...r })) });
  for (const t of rows) fn(t);
  await DB.saveTxMany(rows);
  await reload();
  toast(`${rows.length} תנועות · ${label}`);
  render();
}

function renderLedger() {
  const D = S.deptFilter ? dept(S.deptFilter) : null;
  $('#lg-filters').innerHTML =
    (D ? `<button class="chip on" data-f="cleardept">${esc(D.label)} ✕</button>` : '') +
    (S.acctFilter ? `<button class="chip on" data-f="clearacct"><i class="swatch" style="background:${acctColor(S.acctFilter)}"></i>${esc(acctName(S.acctFilter))} ✕</button>` : '') +
    FILTERS.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');

  let rows = S.txs;
  if (S.deptFilter) rows = rows.filter(t => t.dept === S.deptFilter);
  if (S.acctFilter) rows = rows.filter(t => acctOf(t) === S.acctFilter);
  const q = S.q.trim().toLowerCase();
  if (q) rows = rows.filter(t =>
    (t.merchant || '').toLowerCase().includes(q) ||
    (t.note || '').toLowerCase().includes(q) ||
    pathLabel(t.dept, t.cat).toLowerCase().includes(q));

  const F = S.filter;
  const by = {
    review: t => t.needsReview, cash: t => t.method === 'cash', credit: t => t.method === 'credit',
    fixed: t => t.kind === 'fixed',
    discretionary: t => t.need === 'discretionary' && flowOf(t.dept) === 'out',
    income: t => flowOf(t.dept) === 'in', transfer: t => flowOf(t.dept) === 'neutral',
    dup: t => t.dupOf,
  };
  if (by[F]) rows = rows.filter(by[F]);

  // סינון מתקדם — טווח תאריכים, טווח סכומים, ותגית
  const A = S.adv;
  if (A.from) rows = rows.filter(t => t.dateBuy >= A.from);
  if (A.to) rows = rows.filter(t => t.dateBuy <= A.to);
  if (A.min !== null) rows = rows.filter(t => ils(t) >= A.min);
  if (A.max !== null) rows = rows.filter(t => ils(t) <= A.max);
  if (A.tag) rows = rows.filter(t => (t.tags || []).includes(A.tag));

  const tags = ST.allTags(S.txs);
  $('#lg-tags').innerHTML = tags.length
    ? tags.slice(0, 12).map(t => `<button class="chip ${A.tag === t ? 'on' : ''}" data-advtag="${esc(t)}">#${esc(t)}</button>`).join('')
    : '<span class="hint" style="margin:0">אין עדיין תגיות</span>';

  const active = !!(A.from || A.to || A.min !== null || A.max !== null || A.tag);
  $('#lg-adv').open = $('#lg-adv').open || active;
  $('#lg-adv').querySelector('summary').textContent = active ? 'סינון מתקדם · פעיל' : 'סינון מתקדם';

  const spend = live(rows).filter(t => flowOf(t.dept) === 'out').reduce((s, t) => s + ils(t), 0);
  const income = live(rows).filter(t => flowOf(t.dept) === 'in').reduce((s, t) => s + ils(t), 0);
  $('#lg-meta').innerHTML = `${rows.length} תנועות · יצא ${money(spend)}${income ? ` · נכנס ${money(income)}` : ''}` +
    (UNDO.length ? ` · <button id="undo-last" style="text-decoration:underline;color:var(--accent)">בטל: ${esc(UNDO.at(-1).label)}</button>` : '');

  const shown = rows.slice(0, 400);
  const allSelected = shown.length && shown.every(t => SEL.has(t.id));
  $('#lg-list').innerHTML = rows.length
    ? selBar() +
      `<div style="display:flex;justify-content:flex-end;padding:4px 2px 8px">
         <button class="chip" data-bulk="all">${allSelected ? 'בטל בחירת הכל' : `בחר ${shown.length}`}</button>
       </div>` +
      `<div class="rows">${shown.map(t => txRow(t, true)).join('')}</div>` +
      (rows.length > 400 ? '<div class="empty">מוצגות 400 הראשונות. צמצם עם חיפוש או מסנן.</div>' : '')
    : '<div class="empty">לא נמצאו תנועות</div>';
}

/* ==================== מסך: הגדרות ==================== */

async function renderSettings() {
  $('#st-meta').textContent = `${S.txs.length} תנועות · ${S.rules.length} כללים · ${S.accounts.length} מקורות`;
  $('#st-budget').value = S.budget ? S.budget / 100 : '';
  $('#st-key').value = S.hasKey ? '••••••••••••••••' : '';
  $('#st-key').placeholder = S.hasKey ? 'מפתח שמור ומוצפן' : 'AIza…';
  // גרסה = מתי הקובץ שנטען נבנה בשרת. document.lastModified משקף את
  // זמן הפריסה בלי שום תשתית — ועונה על "איזו גרסה באמת רצה אצלי".
  const lm = new Date(document.lastModified);
  const stamp = isNaN(lm) ? '' :
    ` · עודכן ${String(lm.getDate()).padStart(2, '0')}.${String(lm.getMonth() + 1).padStart(2, '0')} ${String(lm.getHours()).padStart(2, '0')}:${String(lm.getMinutes()).padStart(2, '0')}`;
  $('#st-version').textContent = 'כסף' + stamp;

  const pinOn = !!(await DB.setting('dekWrapped'));
  $('#st-security').innerHTML = `
    <div class="panel" style="margin-bottom:12px">
      ${table([{ label: 'שכבה' }, { label: 'מצב', n: true }], [
        { cells: [`${icon('shield', 14)} מדיניות תוכן (CSP)`, '<span style="color:var(--good)">פעילה</span>'] },
        { cells: ['יעדי רשת מותרים', '<span class="num">1</span>'] },
        { cells: ['תלויות צד שלישי', '<span class="num">0</span>'] },
        { cells: ['מפתח API באחסון', S.hasKey ? '<span style="color:var(--good)">מוצפן</span>' : '<span style="color:var(--ink-3)">לא הוגדר</span>'] },
        { cells: ['מפתח בגיבוי', '<span style="color:var(--good)">אף פעם</span>'] },
        { cells: ['נעילה בקוד', pinOn ? '<span style="color:var(--good)">פעילה</span>' : '<span style="color:var(--ink-3)">כבויה</span>'] },
      ])}
    </div>
    <button class="btn ghost sm" data-pin="${pinOn ? 'off' : 'on'}">${icon('lock')}${pinOn ? 'ביטול קוד נעילה' : 'הגדרת קוד נעילה'}</button>
    ${pinOn ? `<div class="field" style="margin-top:12px"><label>נעילה אוטומטית</label>
      <select class="inp" id="st-autolock">
        ${[[0, 'כבוי'], [1, 'דקה'], [5, '5 דקות'], [15, '15 דקות'], [60, 'שעה']]
          .map(([v, l]) => `<option value="${v}" ${S.autoLock === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>` : ''}
    <div class="hint">הקוד גוזר את מפתח ההצפנה ב-PBKDF2 עם 310,000 סיבובים.
      הוא לא נשמר בשום מקום — בלעדיו הנתונים לא ניתנים לפתיחה, גם לא על ידי.</div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn ghost sm" id="st-export-enc">${icon('lock')}גיבוי מוצפן</button>
    </div>`;

  const opts = await DB.setting('geminiModelOptions', []);
  const chosen = await DB.setting('geminiModel');
  if (opts.length) {
    $('#st-modelwrap').style.display = 'block';
    $('#st-model').innerHTML = opts.map(o => `<option value="${esc(o)}" ${o === chosen ? 'selected' : ''}>${esc(o.replace('models/', ''))}</option>`).join('');
  }

  $('#st-accounts').innerHTML = `<div class="rows">` + S.accounts.map(s => {
    const rows = live(S.txs).filter(t => acctOf(t) === s.id);
    const i = rows.filter(t => flowOf(t.dept) === 'in').reduce((a, t) => a + ils(t), 0);
    const o = rows.filter(t => flowOf(t.dept) === 'out').reduce((a, t) => a + ils(t), 0);
    return `<button class="row" data-acct="${s.id}">
      <span class="gl" style="background:transparent"><i class="swatch" style="background:${C.seriesVar(s.slot ?? 0)};width:11px;height:11px;margin:0"></i></span>
      <span class="body"><span class="t1">${esc(s.name)}</span>
      <span class="t2">${ACCOUNT_TYPE_LABEL[s.type] || ''} · ${rows.length} תנועות · נטו ${money(i - o)}</span></span>
      <span class="amt" style="color:var(--ink-3)">${icon('chev', 14)}</span></button>`;
  }).join('') + '</div>';

  $('#st-fixed').innerHTML = S.fixed.length
    ? `<div class="rows">` + S.fixed.map(f => `<button class="row" data-fixed="${f.id}">
        <span class="gl">${icon(dept(f.dept)?.icon || 'list')}</span>
        <span class="body"><span class="t1">${esc(f.merchant)}${f.active ? '' : '<span class="pill">כבוי</span>'}</span>
        <span class="t2">${esc(pathLabel(f.dept, f.cat))} · ב-${f.day} לחודש</span></span>
        <span class="amt">${money(f.amount)}</span></button>`).join('') + '</div>'
    : '<div class="hint" style="margin:0">לא הוגדרו הוצאות קבועות.</div>';

  $('#st-backupinfo').textContent = S.lastExport
    ? `גיבוי אחרון החוצה: ${new Date(S.lastExport).toLocaleString('he-IL')}`
    : 'עוד לא בוצע גיבוי החוצה. הנתונים קיימים רק על המכשיר הזה.';

  const snaps = await DB.snapshots();
  $('#st-snaps').innerHTML = snaps.length
    ? `<div class="rows">` + snaps.map(s => `<div class="row" style="cursor:default">
        <span class="body"><span class="t1" style="font-size:13px">${new Date(s.at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        <span class="t2">${esc(s.reason)} · ${s.counts.tx} תנועות</span></span>
        <button class="chip" data-restore="${s.id}">שחזור</button></div>`).join('') + '</div>'
    : '<div class="hint" style="margin:0">אין עדיין גיבויים מקומיים.</div>';

  const top = [...S.rules].sort((a, b) => (b.hits || 0) - (a.hits || 0)).slice(0, 6);
  $('#st-rules').innerHTML = S.rules.length
    ? `${S.rules.length} בתי עסק נלמדו. הנפוצים: ` + top.map(r => `${esc(r.merchant || r.key)} → ${esc(catLabel(r.dept, r.cat))}`).join(' · ')
    : 'המילון ריק. כל תיוג שתעשה נשמר כאן ולא יישאל שוב.';

  $('#st-theme').innerHTML = [['auto', 'לפי המערכת'], ['light', 'בהיר'], ['dark', 'כהה']]
    .map(([k, l]) => `<button class="chip ${S.theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('');
}

/* ==================== הוספה מהירה ==================== */

const ADD = {
  amount: '', dept: 'food', cat: 'general', method: 'cash', account: 'bank1',
  date: todayISO(), merchant: '', income: false, business: false, currency: 'ILS',
  editId: null, touched: false, tags: [],
};

function openAdd(preset = {}) {
  Object.assign(ADD, {
    amount: '', dept: 'food', cat: 'general', method: 'cash', account: 'bank1',
    date: todayISO(), merchant: '', income: false, business: false, currency: 'ILS',
    editId: null, touched: false, tags: [],
  }, preset);
  
  $('#add-merch').value = ADD.merchant;
  $('#add-merch').placeholder = ADD.income ? 'ממי? (שם המשלם)' : 'על מה? (רשות)';
  $('#add-date').value = ADD.date;
  drawAdd();
  openSheet('sh-add');
}

function drawAdd() {
  const [whole, frac] = (ADD.amount || '').split('.');
  const v = $('#add-amt');
  v.textContent = ADD.amount ? Number(whole || 0).toLocaleString('he-IL') + (frac !== undefined ? '.' + frac : '') : '0';
  v.classList.toggle('zero', !ADD.amount);
  $('#add-cur').textContent = ' ' + (CUR_SIGN[ADD.currency] || '₪');

  $('#add-dir').innerHTML =
    `<button class="${!ADD.income ? 'on' : ''}" data-dir="out">הוצאה</button>
     <button class="${ADD.income ? 'on' : ''}" data-dir="in">הכנסה</button>`;

  // הקטגוריות שאתה באמת משתמש בהן, לפי התדירות בפועל
  let quick;
  if (ADD.income) {
    quick = dept('income').cats.slice(0, 6).map(c => ['income', c.key]);
  } else {
    const freq = {};
    for (const t of live(S.txs)) {
      if (flowOf(t.dept) !== 'out') continue;
      freq[`${t.dept}/${t.cat}`] = (freq[`${t.dept}/${t.cat}`] || 0) + 1;
    }
    quick = [...new Set([
      ...Object.entries(freq).sort((a, b) => b[1] - a[1]).map(e => e[0]),
      ...QUICK_SEED.map(([d, c]) => `${d}/${c}`),
    ])].filter(k => cat(...k.split('/'))).slice(0, 8).map(k => k.split('/'));
  }
  $('#add-quick').innerHTML = quick.map(([d, c]) =>
    `<button class="chip ${ADD.dept === d && ADD.cat === c ? 'on' : ''}" data-setcat="${d}/${c}">${esc(catLabel(d, c))}</button>`).join('');

  $('#add-cat').textContent = pathLabel(ADD.dept, ADD.cat);
  $('#add-merch').placeholder = ADD.income ? 'ממי? (רשות)' : 'על מה? (רשות)';
  $('#add-account').innerHTML = S.accounts.filter(a => a.active !== false).map(s =>
    `<option value="${esc(s.id)}" ${ADD.account === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#add-method').innerHTML = Object.entries(METHOD_LABEL).map(([k, l]) =>
    `<option value="${k}" ${ADD.method === k ? 'selected' : ''}>${l}</option>`).join('');
  const known = ST.allTags(S.txs);
  const shown = [...new Set([...ADD.tags, ...known])].slice(0, 10);
  $('#add-flags').innerHTML = `
    <button class="chip ${ADD.business ? 'on' : ''}" data-flag="business">עסקי</button>
    <button class="chip ${ADD.currency === 'USD' ? 'on' : ''}" data-flag="usd">דולר</button>
    ${shown.map(t => `<button class="chip ${ADD.tags.includes(t) ? 'on' : ''}" data-tagtoggle="${esc(t)}">#${esc(t)}</button>`).join('')}
    <button class="chip" id="add-newtag">+ תגית</button>`;
  $('#add-save').disabled = !toAgorot(ADD.amount);
  $('#add-save').textContent = ADD.editId ? 'עדכון' : 'שמירה';
}

function key(k) {
  if (k === 'del') ADD.amount = ADD.amount.slice(0, -1);
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
    merchant, amount, currency: ADD.currency, ils: toILS(amount, ADD.currency),
    dept: ADD.dept, cat: ADD.cat, method: $('#add-method').value,
    account: $('#add-account').value,
    scope: ADD.business ? 'business' : undefined,
    tags: ADD.tags,
  });
  if (ADD.editId) {
    const old = S.txs.find(t => t.id === ADD.editId);
    if (old) Object.assign(rec, { ts: old.ts, source: old.source, raw: old.raw, fixedId: old.fixedId, needsReview: false });
  }
  await DB.saveTx(rec);
  if (merchant) await DB.learn(merchant, { dept: rec.dept, cat: rec.cat, kind: rec.kind, need: rec.need, scope: rec.scope, account: rec.account });
  await reload();
  closeSheet('sh-add');
  toast(ADD.editId ? 'עודכן' : `נשמר ${money(rec.ils)}`);
  render();
}

/* ==================== בורר קטגוריות ==================== */

let catTarget = null;

function openCatPicker(target, current) {
  catTarget = target;
  $('#cat-picker').innerHTML = DEPTS.map(d => `
    <div class="grp">
      <div class="h">${icon(d.icon, 15)}<span>${esc(d.label)}</span></div>
      <div class="chipset">${d.cats.map(c =>
        `<button class="chip ${current === `${d.key}/${c.key}` ? 'on' : ''}" data-pick="${d.key}/${c.key}">${esc(c.label)}</button>`).join('')}</div>
    </div>`).join('');
  openSheet('sh-cat');
}

let RULE_EDIT = null;

async function onCatPicked(dk, ck) {
  closeSheet('sh-cat');
  const d = defaultsFor(dk, ck);
  if (catTarget?.split !== undefined) {
    Object.assign(SPLIT.parts[catTarget.split], { dept: dk, cat: ck });
    drawSplit(); return;
  }
  if (catTarget === 'bulk') {
    await bulkApply(t => { t.dept = dk; t.cat = ck; Object.assign(t, defaultsFor(dk, ck)); },
      'סווגו ל' + catLabel(dk, ck));
    SEL.clear();
    return;
  }
  if (catTarget?.merch) {
    const key = DB.normMerchant(catTarget.merch);
    const rows = S.txs.filter(t => DB.normMerchant(t.merchant) === key);
    await DB.snapshot('לפני סיווג בית עסק');
    for (const t of rows) { t.dept = dk; t.cat = ck; Object.assign(t, defaultsFor(dk, ck)); }
    await DB.saveTxMany(rows);
    await DB.learn(catTarget.merch, { dept: dk, cat: ck, ...defaultsFor(dk, ck) });
    await reload();
    toast(`${rows.length} תנועות סווגו · החוק עודכן`);
    openMerchant(catTarget.merch);
    return;
  }
  if (catTarget === 'rule' && RULE_EDIT) {
    const r = S.rules.find(x => x.key === RULE_EDIT);
    if (r) { await DB.put('rules', { ...r, dept: dk, cat: ck }); await reload(); }
    RULE_EDIT = null;
    openRules(); toast('החוק עודכן'); return;
  }
  if (catTarget === 'add') {
    ADD.dept = dk; ADD.cat = ck; ADD.touched = true;
    ADD.income = flowOf(dk) === 'in';
    ADD.business = d.scope === 'business';
    ADD.account = d.account;
    
    drawAdd();
  } else if (typeof catTarget === 'number') {
    Object.assign(SHOT.items[catTarget], { dept: dk, cat: ck, ...d });
    drawItems();
  } else if (catTarget === 'fixed') {
    FIXED.dept = dk; FIXED.cat = ck; FIXED.account = d.account;
    drawFixed();
  }
}

/* ==================== צילום מסך ==================== */

const SHOT = { items: [], busy: false, err: '', doc: '', pendingIds: [], progress: '' };

function openShot(blobs = null, pendingIds = []) {
  Object.assign(SHOT, { items: [], busy: false, err: '', doc: '', pendingIds, progress: '' });
  openSheet('sh-shot');
  drawShot();
  if (blobs?.length) runParse(blobs);
}

const DOC_LABEL = {
  credit_statement: 'דף אשראי', bank_statement: 'תנועות בנק', app_receipt: 'קבלה',
  single_receipt: 'קבלה', wallet: 'ארנק דיגיטלי', other: '',
};

function drawShot() {
  const b = $('#shot-body');
  if (SHOT.busy) {
    b.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto 14px"></div>
      מפענח את הצילום…<div class="hint">${esc(SHOT.progress)}</div></div>`;
    return;
  }
  if (SHOT.err) {
    b.innerHTML = `<div class="note bad">${icon('alert')}<span class="grow">${esc(SHOT.err)}</span></div>
      <button class="btn accent" data-shot="pick">${icon('camera')}בחירת תמונות</button>
      <button class="btn ghost" data-shot="manual" style="margin-top:9px">הזנה ידנית</button>`;
    return;
  }
  if (!SHOT.items.length) {
    b.innerHTML = `
      <button class="btn accent" data-shot="pick">${icon('camera')}בחירת צילומי מסך</button>
      <div class="hint" style="margin:10px 0 18px">
        דף אשראי, תנועות בנק, קבלה, או מסך של ביט / פייבוקס / ארנק. אפשר לבחור כמה תמונות יחד —
        כל שורה תזוהה, תסווג, ותקבל מקור בנפרד.
        ${S.hasKey ? '' : '<br><b style="color:var(--critical)">לא הוגדר מפתח Gemini. עבור להגדרות.</b>'}
      </div>
      <button class="btn ghost" data-shot="manual">הזנה ידנית במקום</button>
      <div class="hint">מצב מקומי — התמונה לא נשלחת לשום מקום ואתה מקליד בעצמך. לצילומים רגישים.</div>`;
    return;
  }
  const on = SHOT.items.filter(i => i.on);
  b.innerHTML = `
    <div class="note ok">${icon('check')}<span class="grow">זוהו ${SHOT.items.length} שורות${SHOT.doc && DOC_LABEL[SHOT.doc] ? ` · ${DOC_LABEL[SHOT.doc]}` : ''}</span>
      <button data-shot="toggleall">${on.length === SHOT.items.length ? 'בטל הכל' : 'סמן הכל'}</button></div>
    <div class="parsed" id="shot-items"></div>
    <button class="btn accent" data-shot="save" ${on.length ? '' : 'disabled'}>${saveLabel(on)}</button>
    <button class="btn ghost" data-shot="pick" style="margin-top:9px">תמונות נוספות</button>`;
  drawItems();
}

const shotSum = (items) => items.reduce((s, i) => flowOf(i.dept) === 'out' ? s + toILS(i.amount, i.currency) : s, 0);
const saveLabel = (on) => `שמירת ${on.length} שורות · ${money(shotSum(on))}`;

function drawItems() {
  const host = $('#shot-items');
  if (!host) return;
  host.innerHTML = SHOT.items.map((it, i) => {
    const inc = flowOf(it.dept) === 'in';
    const low = (it.confidence ?? 1) < 0.7;
    return `<div class="item ${it.on ? 'on' : 'off'} ${it.open ? 'open' : ''}" data-i="${i}">
      <div class="head">
        <span class="box" data-tog="${i}">${it.on ? icon('check', 12) : ''}</span>
        <span class="nm" data-open="${i}">${esc(it.merchant || '—')}</span>
        <span class="amt" style="${inc ? 'color:var(--delta-up)' : ''}">${inc ? '+' : ''}${CUR_SIGN[it.currency] || '₪'}${(it.amount / 100).toLocaleString('he-IL', { maximumFractionDigits: 2 })}</span>
      </div>
      <div class="sub">
        <button class="cat" data-catbtn="${i}">${esc(pathLabel(it.dept, it.cat))}</button>
        <span class="dt">${esc(it.dateBuy)}</span>
        ${it.installmentOf > 1 ? `<span class="pill">תשלום ${it.installmentN}/${it.installmentOf}</span>` : ''}
        ${it.dup ? '<span class="pill dup">כפילות אפשרית</span>' : ''}
        ${low ? '<span class="pill warn">ודאות נמוכה</span>' : ''}
        <button class="dt" data-open="${i}" style="text-decoration:underline;margin-inline-start:auto">${it.open ? 'סגור' : 'ערוך'}</button>
      </div>
      <div class="edit">
        <div class="pair" style="margin-bottom:9px">
          <div><label style="font-size:10px;color:var(--ink-3)">סכום</label>
            <input class="inp" type="number" step="0.01" inputmode="decimal" value="${it.amount / 100}" data-fld="amount" data-i="${i}"></div>
          <div><label style="font-size:10px;color:var(--ink-3)">תאריך</label>
            <input class="inp" type="date" value="${esc(it.dateBuy)}" data-fld="dateBuy" data-i="${i}"></div>
        </div>
        <input class="inp" placeholder="בית עסק" value="${esc(it.merchant)}" data-fld="merchant" data-i="${i}" style="margin-bottom:9px">
        <div class="pair">
          <div><label style="font-size:10px;color:var(--ink-3)">מקור</label>
            <select class="inp" data-fld="account" data-i="${i}">${S.accounts.map(s => `<option value="${esc(s.id)}" ${it.account === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
          <div><label style="font-size:10px;color:var(--ink-3)">אמצעי</label>
            <select class="inp" data-fld="method" data-i="${i}">${Object.entries(METHOD_LABEL).map(([k, l]) => `<option value="${k}" ${it.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
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
    SHOT.busy = false; SHOT.err = e.message || String(e); drawShot(); return;
  }
  const known = live(S.txs).map(t => ({ ...t, amount: ils(t) }));
  for (const it of out) {
    it.dup = !!DB.findDuplicate(
      { id: '_', amount: toILS(it.amount, it.currency), dateBuy: it.dateBuy, merchant: it.merchant }, known);
    if (it.dup) it.on = false;
  }
  Object.assign(SHOT, { items: out, busy: false, progress: '' });
  if (!out.length) SHOT.err = 'לא זוהו שורות בתמונה. נסה צילום ברור יותר, או הזנה ידנית.';
  drawShot();
}

async function normalizeItem(r) {
  const amount = Math.round(Math.abs(Number(r.amount) || 0) * 100);
  let dk = r.dept, ck = r.cat;
  if (!dept(dk)) dk = r.isIncome ? 'income' : 'food';
  if (!cat(dk, ck)) ck = 'general';
  const rule = await DB.recall(r.merchant);
  if (rule?.dept && dept(rule.dept)) { dk = rule.dept; ck = cat(rule.dept, rule.cat) ? rule.cat : 'general'; }
  const d = defaultsFor(dk, ck);
  const inst = r.installmentOf > 1 ? { n: r.installmentN || 1, of: r.installmentOf } : null;
  return {
    on: true, open: false, dup: false,
    dateBuy: /^\d{4}-\d{2}-\d{2}$/.test(r.dateBuy || '') ? r.dateBuy : todayISO(),
    dateCharge: /^\d{4}-\d{2}-\d{2}$/.test(r.dateCharge || '') ? r.dateCharge : null,
    merchant: (r.merchant || '').trim(),
    amount, currency: CUR_SIGN[r.currency] ? r.currency : 'ILS',
    dept: dk, cat: ck,
    kind: rule?.kind || r.kind || d.kind,
    need: rule?.need || r.need || d.need,
    scope: rule?.scope || r.scope || d.scope,
    account: rule?.account || d.account,
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
    account: it.account, method: it.method,
    installment: it.installmentOf > 1 ? { n: it.installmentN, of: it.installmentOf } : null,
    source: 'ocr', confidence: it.confidence, raw: it.raw,
    needsReview: (it.confidence ?? 1) < 0.7,
  }));
  await DB.saveTxMany(recs);
  for (const it of on) {
    if (it.merchant) await DB.learn(it.merchant, { dept: it.dept, cat: it.cat, kind: it.kind, need: it.need, scope: it.scope, account: it.account });
  }
  for (const id of SHOT.pendingIds) await DB.del('pending', id);
  await reload();
  closeSheet('sh-shot');
  toast(`נשמרו ${recs.length} תנועות`);
  render();
}

/* ==================== מגירת תנועה ==================== */

function openTx(id) {
  const t = S.txs.find(x => x.id === id);
  if (!t) return;
  const D = dept(t.dept);
  $('#tx-body').innerHTML = `
    <div class="panel" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:11px;margin-bottom:10px">
        <span class="gl" style="width:34px;height:34px;flex:0 0 34px;border-radius:8px;display:grid;place-items:center;background:var(--surface-sunk)">${icon(D?.icon || 'list', 18)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:620;font-size:16px">${esc(t.merchant || catLabel(t.dept, t.cat))}</div>
          <div class="hint" style="margin:0">${esc(pathLabel(t.dept, t.cat))}</div>
        </div>
        <div style="font-size:21px;font-weight:660" class="num">${money(ils(t))}</div>
      </div>
      ${table([{ label: 'שדה' }, { label: 'ערך', n: true }], [
        { cells: ['תאריך קנייה', t.dateBuy] },
        ...(t.dateCharge ? [{ cells: ['תאריך חיוב', t.dateCharge] }] : []),
        { cells: ['אמצעי', METHOD_LABEL[t.method] || '—'] },
        { cells: ['מקור', esc(acctName(acctOf(t)))] },
        { cells: ['סוג', KIND_LABEL[t.kind]] },
        { cells: ['חיוניות', NEED_LABEL[t.need]] },
        { cells: ['היקף', t.scope === 'business' ? 'עסקי' : 'פרטי'] },
        ...(t.installment ? [{ cells: ['תשלומים', `${t.installment.n} מתוך ${t.installment.of}`] }] : []),
        ...(t.currency !== 'ILS' ? [{ cells: ['מקורי', `${CUR_SIGN[t.currency]}${(t.amount / 100).toLocaleString('he-IL')}`] }] : []),
        { cells: ['מקור הרישום', { manual: 'ידני', ocr: 'צילום מסך', recurring: 'הוצאה קבועה' }[t.source] || t.source] },
      ])}
      ${t.raw ? `<div class="hint">טקסט מקורי: ${esc(t.raw)}</div>` : ''}
    </div>
    ${t.needsReview ? `<button class="btn accent" data-tx-act="ok" style="margin-bottom:9px">${icon('check')}אשר ונקה מהתור</button>` : ''}
    <button class="btn ghost" data-tx-act="edit" style="margin-bottom:9px">עריכה</button>
    ${t.merchant ? `<button class="btn ghost" data-tx-act="merch" style="margin-bottom:9px">כל התנועות מ${esc(t.merchant)}</button>` : ''}
    ${flowOf(t.dept) === 'out' && !t.splitOf && !t.installment
      ? '<button class="btn ghost" data-tx-act="split" style="margin-bottom:9px">פיצול בין קטגוריות</button>' : ''}
    ${t.installment ? '<div class="hint" style="margin-bottom:9px">תנועה בתשלומים אינה ניתנת לפיצול — הפיצול היה מנתק אותה מלוח התשלומים ומהתחייבויות העתיד.</div>' : ''}
    <button class="btn ghost" data-tx-act="${t.dupOf ? 'undup' : 'dup'}" style="margin-bottom:9px">${t.dupOf ? 'זו לא כפילות' : 'סמן ככפילות'}</button>
    <button class="btn danger" data-tx-act="del">${icon('trash')}מחיקה</button>`;
  $('#tx-body').dataset.id = id;
  openSheet('sh-tx');
}

async function txAction(action, id) {
  const t = S.txs.find(x => x.id === id);
  if (!t) return;
  if (action === 'del') {
    await DB.del('tx', id); await reload(); closeSheet('sh-tx'); toast('נמחק'); render(); return;
  }
  if (action === 'split') { closeSheet('sh-tx'); openSplit(id); return; }
  if (action === 'merch') {
    const t = S.txs.find(x => x.id === id);
    closeSheet('sh-tx');
    if (t?.merchant) openMerchant(t.merchant);
    return;
  }
  if (action === 'edit') {
    closeSheet('sh-tx');
    openAdd({
      editId: t.id, amount: String(t.amount / 100), dept: t.dept, cat: t.cat,
      method: t.method, date: t.dateBuy, merchant: t.merchant, account: acctOf(t),
      income: flowOf(t.dept) === 'in', business: t.scope === 'business', currency: t.currency,
      tags: [...(t.tags || [])],
    });
    return;
  }
  if (action === 'ok') t.needsReview = false;
  if (action === 'dup') t.dupOf = '_manual';
  if (action === 'undup') t.dupOf = null;
  await DB.saveTx(t); await reload(); closeSheet('sh-tx'); render();
}

/* ==================== הוצאה קבועה ==================== */

const FIXED = { id: null, merchant: '', amount: 0, dept: 'home', cat: 'rent', day: 1, method: 'bank', account: 'bank1', active: true };

function openFixed(id = null) {
  const f = id ? S.fixed.find(x => x.id === id) : null;
  Object.assign(FIXED, { id: null, merchant: '', amount: 0, dept: 'home', cat: 'rent', day: 1, method: 'bank', account: 'bank1', active: true }, f || {});
  drawFixed();
  openSheet('sh-fixed');
}

function drawFixed() {
  $('#fixed-body').innerHTML = `
    <div class="field"><label>שם</label><input class="inp" id="f-merch" value="${esc(FIXED.merchant)}" placeholder="שכר דירה"></div>
    <div class="pair">
      <div class="field"><label>סכום חודשי ₪</label><input class="inp" id="f-amt" type="number" step="0.01" inputmode="decimal" value="${FIXED.amount ? FIXED.amount / 100 : ''}"></div>
      <div class="field"><label>יום בחודש</label><input class="inp" id="f-day" type="number" min="1" max="31" value="${FIXED.day}"></div>
    </div>
    <div class="field"><label>קטגוריה</label>
      <button class="inp" data-fixedcat style="text-align:right">${esc(pathLabel(FIXED.dept, FIXED.cat))}</button></div>
    <div class="pair">
      <div class="field"><label>חשבון</label><select class="inp" id="f-account">${S.accounts.map(s => `<option value="${esc(s.id)}" ${FIXED.account === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>אמצעי</label><select class="inp" id="f-method">${Object.entries(METHOD_LABEL).map(([k, l]) => `<option value="${k}" ${FIXED.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="chipset" style="margin-bottom:14px"><button class="chip ${FIXED.active ? 'on' : ''}" data-factive>${FIXED.active ? 'פעיל' : 'כבוי'}</button></div>
    <button class="btn accent" data-fsave>שמירה</button>
    ${FIXED.id ? '<button class="btn danger" data-fdel style="margin-top:9px">מחיקה</button>' : ''}`;
}

async function saveFixed() {
  FIXED.merchant = $('#f-merch').value.trim();
  FIXED.amount = toAgorot($('#f-amt').value);
  FIXED.day = Math.min(31, Math.max(1, parseInt($('#f-day').value) || 1));
  FIXED.account = $('#f-account').value;
  FIXED.method = $('#f-method').value;
  if (!FIXED.merchant || !FIXED.amount) { toast('חסר שם או סכום'); return; }
  await DB.put('fixed', { ...FIXED, id: FIXED.id || DB.uid(), startMonth: FIXED.startMonth || curMonth() });
  await reload();
  await applyFixedForMonth(curMonth());
  closeSheet('sh-fixed'); toast('נשמר'); render();
}

/* ==================== מקורות ==================== */

const ACCT = { id: null, name: '', type: 'bank', slot: 0, active: true };

function openAccount(id = null) {
  const s = id ? S.accounts.find(x => x.id === id) : null;
  Object.assign(ACCT, { id: null, name: '', type: 'bank', slot: nextSlot(), active: true }, s || {});
  drawAccount();
  openSheet('sh-account');
}
const nextSlot = () => {
  const used = new Set(S.accounts.map(s => s.slot));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return S.accounts.length % 8;
};

function drawAccount() {
  const rows = live(S.txs).filter(t => acctOf(t) === ACCT.id);
  const i = rows.filter(t => flowOf(t.dept) === 'in').reduce((a, t) => a + ils(t), 0);
  const o = rows.filter(t => flowOf(t.dept) === 'out').reduce((a, t) => a + ils(t), 0);
  $('#account-body').innerHTML = `
    <div class="field"><label>שם</label><input class="inp" id="a-name" value="${esc(ACCT.name)}" placeholder="חשבון ג׳ / כרטיס נפרד"></div>
    <div class="field"><label>סוג</label><select class="inp" id="a-type">${Object.entries(ACCOUNT_TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${ACCT.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>צבע</label><div class="chipset">${Array.from({ length: 8 }, (_, n) =>
      `<button class="chip ${ACCT.slot === n ? 'on' : ''}" data-slot="${n}"><i class="swatch" style="background:${C.seriesVar(n)};margin:0"></i></button>`).join('')}</div></div>
    ${ACCT.id ? `<div class="panel" style="margin-bottom:14px">${table(
      [{ label: 'מאז ומתמיד' }, { label: 'סכום', n: true }],
      [{ cells: ['נכנס', `<span class="num">${money(i)}</span>`] },
       { cells: ['יצא', `<span class="num">${money(o)}</span>`] },
       { cells: ['נטו', `<span class="num" style="color:${i - o >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${money(i - o)}</span>`] },
       { cells: ['תנועות', `<span class="num">${rows.length}</span>`] }],
    )}</div>` : ''}
    <button class="btn accent" data-ssave>שמירה</button>
    ${ACCT.id && !ACCT.builtin ? '<button class="btn danger" data-sdel style="margin-top:9px">מחיקה</button>' : ''}
    ${ACCT.builtin ? '<div class="hint">חשבון מובנה — אפשר לשנות שם וצבע, אי אפשר למחוק.</div>' : ''}`;
}

async function saveAccount() {
  ACCT.name = $('#a-name').value.trim();
  ACCT.type = $('#a-type').value;
  if (!ACCT.name) { toast('חסר שם'); return; }
  await DB.put('accounts', { ...ACCT, id: ACCT.id || DB.uid() });
  await reload();
  closeSheet('sh-account'); toast('נשמר'); render();
}

/* ==================== גיבוי ==================== */

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function doExport() {
  const data = await DB.exportAll();
  const json = JSON.stringify(data, null, 1);
  const name = `kesef-${todayISO()}.json`;
  let shared = false;
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'גיבוי כסף' });
      shared = true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  if (!shared) download(name, json);
  S.lastExport = Date.now();
  await DB.setSetting('lastExport', S.lastExport);
  await DB.snapshot('ידני');
  toast(shared ? 'הגיבוי נשלח' : 'הגיבוי ירד');
  render();
}

/* ==================== קוד נעילה וגיבוי מוצפן ==================== */

function openPin(mode) {
  const on = mode === 'on';
  $('#pin-title').textContent = on ? 'הגדרת קוד נעילה' : 'ביטול קוד נעילה';
  $('#pin-body').innerHTML = `
    <div class="field"><label>${on ? 'קוד חדש — 4 עד 12 ספרות' : 'הקוד הנוכחי'}</label>
      <input class="inp" id="pin-1" type="password" inputmode="numeric" autocomplete="off"
        style="text-align:center;font-size:20px;letter-spacing:.3em"></div>
    ${on ? `<div class="field"><label>אישור</label>
      <input class="inp" id="pin-2" type="password" inputmode="numeric" autocomplete="off"
        style="text-align:center;font-size:20px;letter-spacing:.3em"></div>` : ''}
    <div id="pin-msg"></div>
    <button class="btn accent" id="pin-go">${on ? 'הפעלה' : 'ביטול הנעילה'}</button>
    ${on ? `<div class="note warn" style="margin-top:12px">${icon('alert')}<span>
      אין שחזור. אם תשכח את הקוד הנתונים אבודים — <b>ייצא גיבוי לפני שאתה מפעיל</b>.</span></div>` : ''}`;
  openSheet('sh-pin');
  $('#pin-go').onclick = async () => {
    const a = $('#pin-1').value.trim();
    const msg = (html) => { $('#pin-msg').innerHTML = html; };
    try {
      if (on) {
        if (a !== $('#pin-2').value.trim()) return msg(`<div class="note bad">${icon('alert')}<span>הקודים אינם תואמים</span></div>`);
        await Crypto.enablePin(DB, a);
        // הסוד הוצפן במפתח הישן — צריך לאטום אותו מחדש במפתח החדש
        const key = $('#st-key').dataset.plain;
        if (key) await DB.setSecret('geminiKey', key);
        else if (S.hasKey) { await DB.del('meta', 'geminiKey'); S.hasKey = false; }
      } else {
        await Crypto.disablePin(DB, a);
        if (S.hasKey) { await DB.del('meta', 'geminiKey'); S.hasKey = false; }
      }
      closeSheet('sh-pin');
      toast(on ? 'הנעילה הופעלה' : 'הנעילה בוטלה');
      renderSettings();
    } catch (e) { msg(`<div class="note bad">${icon('alert')}<span>${esc(e.message)}</span></div>`); }
  };
}

async function doExportEncrypted() {
  const pass = prompt('סיסמה לגיבוי (8 תווים לפחות). היא לא נשמרת בשום מקום:');
  if (!pass) return;
  try {
    const data = await DB.exportAll();
    const box = await Crypto.sealExport(JSON.stringify(data), pass);
    download(`kesef-${todayISO()}.enc.json`, JSON.stringify(box));
    S.lastExport = Date.now();
    await DB.setSetting('lastExport', S.lastExport);
    toast('גיבוי מוצפן ירד');
    render();
  } catch (e) { toast(e.message, 3500); }
}

function doCsv() {
  const head = ['תאריך קנייה', 'תאריך חיוב', 'בית עסק', 'מחלקה', 'קטגוריה', 'תווית מלאה', 'חשבון',
    'סכום מקורי', 'מטבע', 'שקלים', 'סוג', 'חיוניות', 'היקף', 'אמצעי', 'תשלומים', 'תגיות', 'הערה', 'רישום', 'זרימה'];
  const rows = S.txs.map(t => [
    t.dateBuy, t.dateCharge || '', t.merchant, dept(t.dept)?.label || t.dept, catLabel(t.dept, t.cat),
    pathLabel(t.dept, t.cat), acctName(acctOf(t)),
    (t.amount / 100).toFixed(2), t.currency, (ils(t) / 100).toFixed(2),
    KIND_LABEL[t.kind], NEED_LABEL[t.need], t.scope === 'business' ? 'עסקי' : 'פרטי',
    METHOD_LABEL[t.method], t.installment ? `${t.installment.n}/${t.installment.of}` : '',
    (t.tags || []).join(' | '),
    t.note, t.source, flowOf(t.dept),
  ]);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  download(`kesef-${todayISO()}.csv`, '﻿' + [head.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n'), 'text/csv');
  toast('CSV ירד');
}

/* ==================== חיווט ==================== */

function wire() {
  $('#add-keys').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']
    .map(k => `<button data-key="${k}" class="${k === 'del' || k === '.' ? 'fn' : ''}">${k === 'del' ? '⌫' : k}</button>`).join('');

  document.addEventListener('click', async (e) => {
    const t = e.target;
    const hit = (sel) => t.closest(sel);

    const go = hit('[data-go]');
    if (go) { S.view = go.dataset.go; scrollTo(0, 0); render(); return; }
    if (hit('[data-close]')) { closeAll(); return; }
    if (hit('#go-settings')) { S.view = 'settings'; scrollTo(0, 0); render(); return; }
    if (hit('#go-budget')) { S.view = 'settings'; render(); return; }
    if (hit('#see-all')) { S.view = 'ledger'; render(); return; }
    if (hit('#act-cash')) { openAdd({ method: 'cash', account: 'cash' }); return; }
    if (hit('#act-shot')) { openShot(); return; }
    if (hit('#add-more')) {
      const box = $('#add-extra');
      box.hidden = !box.hidden;
      hit('#add-more').textContent = box.hidden ? 'אפשרויות נוספות' : 'פחות אפשרויות';
      return;
    }

    // בורר חשבון בבית
    const as = hit('[data-acctsel]');
    if (as) { S.acctFilter = as.dataset.acctsel || null; renderHome(); return; }

    // הוצאה מול הכנסה
    const dir = hit('[data-dir]')?.dataset.dir;
    if (dir) {
      const wantIncome = dir === 'in';
      if (wantIncome !== ADD.income) {
        ADD.income = wantIncome;
        ADD.dept = wantIncome ? 'income' : 'food';
        ADD.cat = 'general';
      }
      drawAdd(); return;
    }

    const act = hit('[data-act]')?.dataset.act;
    if (act === 'review') { S.view = 'ledger'; S.filter = 'review'; render(); return; }
    if (act === 'settings') { S.view = 'settings'; render(); return; }
    if (act === 'export') { await doExport(); return; }


    const tx = hit('[data-tx]');
    if (tx) { openTx(tx.dataset.tx); return; }

    // הוספה
    const k = hit('[data-key]'); if (k) { key(k.dataset.key); return; }
    const sc = hit('[data-setcat]');
    if (sc) {
      const [d, c] = sc.dataset.setcat.split('/');
      ADD.dept = d; ADD.cat = c; ADD.touched = true;
      ADD.account = defaultsFor(d, c).account;
      drawAdd(); return;
    }
    if (hit('#add-cat')) { openCatPicker('add', `${ADD.dept}/${ADD.cat}`); return; }
    const fl = hit('[data-flag]')?.dataset.flag;

    if (fl === 'business') { ADD.business = !ADD.business; drawAdd(); return; }
    if (fl === 'usd') { ADD.currency = ADD.currency === 'USD' ? 'ILS' : 'USD'; drawAdd(); return; }
    if (hit('#add-save')) { await saveAdd(); return; }

    const pk = hit('[data-pick]');
    if (pk) { const [d, c] = pk.dataset.pick.split('/'); onCatPicked(d, c); return; }

    // צילום
    const sh = hit('[data-shot]')?.dataset.shot;
    if (sh === 'pick') { $('#filein').click(); return; }
    if (sh === 'manual') { closeSheet('sh-shot'); openAdd({ method: 'credit' }); return; }
    if (sh === 'toggleall') {
      const allOn = SHOT.items.every(i => i.on);
      SHOT.items.forEach(i => { i.on = !allOn; }); drawShot(); return;
    }
    if (sh === 'save') { await saveShot(); return; }
    const tg = hit('[data-tog]');
    if (tg) { const i = +tg.dataset.tog; SHOT.items[i].on = !SHOT.items[i].on; drawShot(); return; }
    const op = hit('[data-open]');
    if (op) { const i = +op.dataset.open; SHOT.items[i].open = !SHOT.items[i].open; drawItems(); return; }
    const cb = hit('[data-catbtn]');
    if (cb) { const i = +cb.dataset.catbtn; openCatPicker(i, `${SHOT.items[i].dept}/${SHOT.items[i].cat}`); return; }

    // תנועה
    const ta = hit('[data-tx-act]')?.dataset.txAct;
    if (ta) { await txAction(ta, $('#tx-body').dataset.id); return; }

    // מסננים
    const f = hit('[data-f]');
    if (f) {
      const v = f.dataset.f;
      if (v === 'cleardept') S.deptFilter = null;
      else if (v === 'clearacct') S.acctFilter = null;
      else S.filter = v;
      renderLedger(); return;
    }
    /* ---- בחירה מרובה ---- */
    const sel = hit('[data-sel]');
    if (sel) {
      e.stopPropagation();
      const id = sel.dataset.sel;
      SEL.has(id) ? SEL.delete(id) : SEL.add(id);
      renderLedger(); return;
    }
    const bulk = hit('[data-bulk]')?.dataset.bulk;
    if (bulk === 'none') { SEL.clear(); renderLedger(); return; }
    if (bulk === 'all') {
      const shown = [...document.querySelectorAll('#lg-list [data-sel]')].map(x => x.dataset.sel);
      const allOn = shown.every(id => SEL.has(id));
      shown.forEach(id => allOn ? SEL.delete(id) : SEL.add(id));
      renderLedger(); return;
    }
    if (bulk === 'cat') { openCatPicker('bulk', ''); return; }
    if (bulk === 'acct') {
      const names = S.accounts.filter(a => a.active !== false);
      const pick = prompt('לאיזה חשבון?\n' + names.map((a, i) => `${i + 1}. ${a.name}`).join('\n'));
      const idx = parseInt(pick) - 1;
      if (!names[idx]) return;
      await bulkApply(t => { t.account = names[idx].id; }, 'הועברו ל' + names[idx].name);
      SEL.clear(); return;
    }
    if (bulk === 'tag') {
      const tg = (prompt('שם תגית להוספה:') || '').trim().slice(0, 24);
      if (!tg) return;
      await bulkApply(t => { t.tags = [...new Set([...(t.tags || []), tg])]; }, 'תויגו ' + tg);
      SEL.clear(); return;
    }
    if (bulk === 'del') {
      const rows = S.txs.filter(t => SEL.has(t.id));
      if (!confirm(`למחוק ${rows.length} תנועות?`)) return;
      await DB.snapshot('לפני מחיקה מרובה');
      UNDO.push({ label: `מחיקת ${rows.length} תנועות`, deleted: true, before: rows.map(r => ({ ...r })) });
      for (const t of rows) await DB.del('tx', t.id);
      SEL.clear(); await reload(); toast(`${rows.length} נמחקו`); render(); return;
    }
    if (hit('#undo-last')) { await undoLast(); return; }

    const dr = hit('[data-deptrow]');
    if (dr) { S.deptFilter = dr.dataset.deptrow; S.acctFilter = null; S.filter = 'all'; S.q = ''; $('#q').value = ''; S.view = 'ledger'; scrollTo(0, 0); render(); return; }
    const sr = hit('[data-acctrow]');
    if (sr) { S.acctFilter = sr.dataset.acctrow; S.deptFilter = null; S.filter = 'all'; S.view = 'ledger'; scrollTo(0, 0); render(); return; }

    // מתגי גרף/טבלה
    const tgl = hit('[data-toggle] button');
    if (tgl) {
      const group = tgl.closest('[data-toggle]').dataset.toggle;
      S.modes[group] = tgl.dataset.mode;
      $$('button', tgl.parentElement).forEach(b => b.classList.toggle('on', b === tgl));
      ({ accounts: () => renderAccounts(statsFor(S.month)), depts: () => renderDepts(statsFor(S.month)), stack: renderStack, heat: () => renderHeat(statsFor(S.month), S.month) })[group]();
      return;
    }

    // ניווט חודש
    if (hit('#an-prev')) { S.month = shiftMonth(S.month, -1); renderAnalysis(); return; }
    if (hit('#an-next')) { S.month = shiftMonth(S.month, 1); renderAnalysis(); return; }

    // הוצאות קבועות
    const fx = hit('[data-fixed]'); if (fx) { openFixed(fx.dataset.fixed); return; }
    if (hit('#st-addfixed')) { openFixed(); return; }
    if (hit('[data-fixedcat]')) { openCatPicker('fixed', `${FIXED.dept}/${FIXED.cat}`); return; }
    if (hit('[data-factive]')) { FIXED.active = !FIXED.active; drawFixed(); return; }
    if (hit('[data-fsave]')) { await saveFixed(); return; }
    if (hit('[data-fdel]')) { await DB.del('fixed', FIXED.id); await reload(); closeSheet('sh-fixed'); toast('נמחק'); render(); return; }

    // מקורות
    // המפתח ב-dataset חייב להתאים בדיוק לשם התכונה. מפתח שגוי מחזיר
    // undefined, העורך נפתח כ"חשבון חדש", ועריכה יוצרת כפילות במקום לעדכן.
    const sm = hit('[data-acct]'); if (sm) { openAccount(sm.dataset.acct); return; }
    if (hit('#st-addaccount')) { openAccount(); return; }
    const sl = hit('[data-slot]'); if (sl) { ACCT.slot = +sl.dataset.slot; drawAccount(); return; }
    if (hit('[data-ssave]')) { await saveAccount(); return; }
    if (hit('[data-sdel]')) {
      if (!confirm('למחוק את החשבון? התנועות שלו יעברו לחשבון הראשי.')) return;
      const moved = S.txs.filter(t => acctOf(t) === ACCT.id);
      for (const t of moved) t.account = 'bank1';
      if (moved.length) await DB.saveTxMany(moved);
      await DB.del('accounts', ACCT.id);
      await reload(); closeSheet('sh-account'); toast('נמחק'); render(); return;
    }

    // הגדרות
    if (hit('#st-savekey')) { await saveKey(); return; }
    if (hit('#st-test')) { await testKey(); return; }
    if (hit('#st-savebudget')) {
      S.budget = toAgorot($('#st-budget').value);
      await DB.setSetting('budget', S.budget); toast('נשמר'); return;
    }
    if (hit('#st-export')) { await doExport(); return; }
    if (hit('#st-csv')) { doCsv(); return; }
    if (hit('#st-import')) { $('#jsonin').click(); return; }
    const th = hit('[data-theme]');
    if (th) { applyTheme(th.dataset.theme); await DB.setSetting('theme', th.dataset.theme); renderSettings(); return; }

    // אבטחה
    const pn = hit('[data-pin]')?.dataset.pin;
    if (pn) { openPin(pn); return; }
    if (hit('#st-export-enc')) { await doExportEncrypted(); return; }

    /* ---- סינון מתקדם ---- */
    const advTag = hit('[data-advtag]')?.dataset.advtag;
    if (advTag) { S.adv.tag = S.adv.tag === advTag ? '' : advTag; renderLedger(); return; }
    if (hit('#lg-clear')) {
      S.adv = { from: '', to: '', min: null, max: null, tag: '' };
      ['lg-from', 'lg-to', 'lg-min', 'lg-max'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
      renderLedger(); return;
    }

    /* ---- רשימת ההתחלה ---- */
    const setup = hit('[data-setup]')?.dataset.setup;
    if (setup) {
      if (setup === 'set-balances') { openBalances(); return; }
      if (setup === 'act-shot') { openShot(); return; }
      S.view = 'settings'; render();
      // ממתינים לרינדור ואז מקפיצים לשדה הרלוונטי
      setTimeout(() => {
        const target = { 'go-accounts': '#st-accounts', 'go-budget': '#st-budget', 'go-key': '#st-key' }[setup];
        const el = $(target);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (el.tagName === 'INPUT') el.focus();
      }, 260);
      return;
    }

    /* ---- בית עסק ---- */
    const merch = hit('[data-merch]')?.dataset.merch;
    if (merch) { openMerchant(merch); return; }
    const mact = hit('[data-merch-act]')?.dataset.merchAct;
    if (mact) { await merchantAction(mact); return; }

    /* ---- שאל את הכסף ---- */
    if (hit('#ask-go')) { await runAsk(); return; }

    /* ---- דוחות ---- */
    if (hit('#rep-export')) {
      const m = shiftMonth(curMonth(), -1);
      const src = statsFor(m).count ? m : curMonth();
      download(`דוח-כסף-${src}.html`, buildMonthReport(src), 'text/html');
      toast('הדוח ירד'); return;
    }
    const goal = hit('[data-goal]')?.dataset.goal;
    if (goal) {
      const cur = S.budgets.find(b => b.key === 'goal:' + goal)?.amount || 0;
      const v = prompt(`יעד צבירה עבור ${goal} (₪). השאר ריק לביטול:`, cur ? String(cur / 100) : '');
      if (v === null) return;
      const amount = toAgorot(v);
      if (amount > 0) await DB.put('budgets', { key: 'goal:' + goal, amount, rollover: false, since: curMonth() });
      else await DB.del('budgets', 'goal:' + goal);
      await reload(); renderWealth(); toast(amount ? 'היעד נשמר' : 'היעד הוסר'); return;
    }

    /* ---- יתרות ---- */
    if (hit('#edit-balances') || hit('#set-balances')) { openBalances(); return; }
    if (hit('#save-balances')) { await saveBalances(); return; }

    /* ---- תקציבים ---- */
    if (hit('#edit-budgets') || hit('#set-budgets')) { openBudgets(); return; }
    if (hit('#save-budgets')) { await saveBudgets(); return; }
    const roll = hit('[data-roll]')?.dataset.roll;
    if (roll) {
      ROLL.has(roll) ? ROLL.delete(roll) : ROLL.add(roll);
      hit('[data-roll]').classList.toggle('on');
      return;
    }
    const sugBtn = hit('[data-sug]')?.dataset.sug;
    if (sugBtn) {
      const [k, v] = sugBtn.split(':');
      const inp = $(`[data-budget="${k}"]`);
      if (inp) inp.value = (Number(v) / 100).toFixed(0);
      return;
    }

    /* ---- פיצול ---- */
    if (hit('#split-add')) {
      SPLIT.parts.push({ amount: 0, dept: 'food', cat: 'general' });
      drawSplit(); return;
    }
    if (hit('#split-fix')) {
      // מפילים את ההפרש על החלק האחרון — הדרך המהירה לסגור אותו
      const sum = SPLIT.parts.reduce((s, p) => s + p.amount, 0);
      const last = SPLIT.parts.at(-1);
      last.amount = Math.max(0, last.amount + (ils(SPLIT.parent) - sum));
      drawSplit(); return;
    }
    const splitDel = hit('[data-splitdel]');
    if (splitDel) { SPLIT.parts.splice(+splitDel.dataset.splitdel, 1); drawSplit(); return; }
    const splitCat = hit('[data-splitcat]');
    if (splitCat) {
      const i = +splitCat.dataset.splitcat;
      openCatPicker({ split: i }, `${SPLIT.parts[i].dept}/${SPLIT.parts[i].cat}`);
      return;
    }
    if (hit('#split-save')) { await saveSplit(); return; }

    /* ---- חוקים ---- */
    if (hit('#st-managerules')) { openRules(); return; }
    const ruleDel = hit('[data-ruledel]');
    if (ruleDel) {
      await DB.del('rules', ruleDel.dataset.ruledel);
      await reload(); openRules(); toast('החוק נמחק'); return;
    }
    const ruleEdit = hit('[data-ruleedit]');
    if (ruleEdit) { RULE_EDIT = ruleEdit.dataset.ruleedit; openCatPicker('rule', ''); return; }

    /* ---- תגיות ---- */
    const tagBtn = hit('[data-tagtoggle]');
    if (tagBtn) {
      const tag = tagBtn.dataset.tagtoggle;
      const i = ADD.tags.indexOf(tag);
      if (i >= 0) ADD.tags.splice(i, 1); else ADD.tags.push(tag);
      drawAdd(); return;
    }
    if (hit('#add-newtag')) {
      const t2 = prompt('שם התגית (לדוגמה: חופשה, שיפוץ):');
      const clean = (t2 || '').trim().slice(0, 24);
      if (clean && !ADD.tags.includes(clean)) ADD.tags.push(clean);
      drawAdd(); return;
    }
    const rs = hit('[data-restore]');
    if (rs) {
      if (!confirm('לשחזר לגיבוי הזה? המצב הנוכחי יוחלף (ונשמר כגיבוי לפני כן).')) return;
      const st = await DB.restoreSnapshot(rs.dataset.restore);
      await reload(); toast(`שוחזרו ${st.tx} תנועות`); render(); return;
    }
    if (hit('#st-clearrules')) {
      if (!confirm('לאפס את המילון הלומד?')) return;
      await DB.snapshot('לפני איפוס מילון');
      await DB.clear('rules'); await reload(); toast('אופס'); render(); return;
    }
    if (hit('#st-wipe')) {
      if (!confirm('למחוק את כל התנועות, הכללים, המקורות וההוצאות הקבועות?')) return;
      if (!confirm('בטוח? ייווצר גיבוי מקומי אוטומטי שאפשר לשחזר ממנו.')) return;
      await DB.snapshot('לפני מחיקה מלאה');
      await DB.clear('tx'); await DB.clear('rules'); await DB.clear('fixed'); await DB.clear('accounts');
      await ensureAccounts(); await reload(); toast('נמחק — ניתן לשחזר'); render(); return;
    }
  });

  $('#q').addEventListener('input', (e) => { S.q = e.target.value; renderLedger(); });
  $('#ask-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAsk(); });

  // סינון מתקדם
  const advMap = { 'lg-from': 'from', 'lg-to': 'to', 'lg-min': 'min', 'lg-max': 'max' };
  document.addEventListener('input', (e) => {
    const key = advMap[e.target.id];
    if (!key) return;
    const v = e.target.value.trim();
    S.adv[key] = (key === 'min' || key === 'max') ? (v === '' ? null : toAgorot(v)) : v;
    renderLedger();
  });

  $('#add-merch').addEventListener('input', async (e) => {
    if (ADD.touched) return;
    const rule = await DB.recall(e.target.value);
    if (rule?.dept && dept(rule.dept)) {
      ADD.dept = rule.dept;
      ADD.cat = cat(rule.dept, rule.cat) ? rule.cat : 'general';
      ADD.business = rule.scope === 'business';
      ADD.account = rule.account || defaultsFor(ADD.dept, ADD.cat).account;
      ADD.income = flowOf(ADD.dept) === 'in';
      drawAdd();
    }
  });

  // שדות הסכום בפיצול — בלי המאזין הזה הערכים שמוקלדים אינם נקראים,
  // והפיצול נשמר תמיד לפי החלוקה ההתחלתית. תקלה שנראית כמו פיצ׳ר עובד.
  $('#split-body').addEventListener('input', (e) => {
    const el = e.target.closest('[data-splitamt]');
    if (!el) return;
    const i = +el.dataset.splitamt;
    SPLIT.parts[i].amount = toAgorot(el.value);
    updateSplitBalance();
  });

  $('#shot-body').addEventListener('input', (e) => {
    const el = e.target.closest('[data-fld]');
    if (!el) return;
    const it = SHOT.items[+el.dataset.i];
    const f = el.dataset.fld;
    it[f] = f === 'amount' ? toAgorot(el.value) : el.value;
    const btn = $('[data-shot="save"]');
    if (btn) btn.textContent = saveLabel(SHOT.items.filter(i => i.on));
  });

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
      let data = JSON.parse(await file.text());
      if (data?.encrypted) {
        const pass = prompt('הקובץ מוצפן. הקלד את הסיסמה:');
        if (!pass) return;
        data = JSON.parse(await Crypto.openExport(data, pass));
      }
      await DB.snapshot('לפני ייבוא');
      const st = await DB.importAll(data);
      await ensureAccounts(); await reload();
      // הוצאות קבועות שיובאו חייבות להירשם כבר החודש. בלי זה הן יושבות
      // בהגדרות ולא מופיעות בשום מקום עד ההפעלה הבאה — נראה כמו ייבוא שנכשל.
      if (st.fixed) { await applyFixedForMonth(curMonth()); await reload(); }
      const parts = [];
      if (st.tx) parts.push(`${st.tx} תנועות`);
      if (st.fixed) parts.push(`${st.fixed} הוצאות קבועות`);
      if (st.budgets) parts.push(`${st.budgets} תקציבים`);
      if (st.accounts) parts.push(`${st.accounts} חשבונות`);
      toast(parts.length ? `יובאו ${parts.join(' · ')}` : 'לא נמצא מה לייבא', 3600);
      render();
    } catch (err) { toast('ייבוא נכשל: ' + err.message, 3500); }
  });

  $('#st-model').addEventListener('change', async (e) => {
    await DB.setSetting('geminiModel', e.target.value); toast('המודל עודכן');
  });

  // המפתח הגולמי נשמר רק לרגע, כדי לאפשר אטימה מחדש בעת הפעלת קוד נעילה
  $('#st-key').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (v && !MASK.test(v)) e.target.dataset.plain = v; else delete e.target.dataset.plain;
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id === 'st-autolock') {
      S.autoLock = Number(e.target.value);
      await DB.setSetting('autoLockMin', S.autoLock);
      armAutoLock();
      toast(S.autoLock ? `נעילה אוטומטית אחרי ${S.autoLock} דקות` : 'נעילה אוטומטית כבויה');
    }
  });

  addEventListener('scroll', () => C.hideTip(), { passive: true });
}

const MASK = /^•+$/;

async function saveKey() {
  const key = $('#st-key').value.trim();
  if (!key || MASK.test(key)) { $('#st-keymsg').innerHTML = `<div class="note bad">${icon('alert')}<span>לא הוזן מפתח חדש</span></div>`; return; }
  $('#st-keymsg').innerHTML = `<div class="note info"><div class="spinner"></div><span>בודק…</span></div>`;
  try {
    const model = await AI.testKey(key);
    await DB.setSecret('geminiKey', key);      // נשמר מוצפן, לא בטקסט גלוי
    await AI.resolveModel(key, { force: true });
    S.hasKey = true;
    $('#st-keymsg').innerHTML = `<div class="note ok">${icon('check')}<span>המפתח נשמר מוצפן · מודל ${esc((model || '').replace('models/', ''))}</span></div>`;
    renderSettings();
  } catch (e) {
    $('#st-keymsg').innerHTML = `<div class="note bad">${icon('alert')}<span>${esc(e.message)}</span></div>`;
  }
}

async function testKey() {
  const typed = $('#st-key').value.trim();
  const key = (typed && !MASK.test(typed)) ? typed : await DB.getSecret('geminiKey');
  if (!key) { $('#st-keymsg').innerHTML = `<div class="note bad">${icon('alert')}<span>לא הוזן מפתח</span></div>`; return; }
  $('#st-keymsg').innerHTML = `<div class="note info"><div class="spinner"></div><span>בודק…</span></div>`;
  try {
    const models = await AI.listModels(key);
    $('#st-keymsg').innerHTML = `<div class="note ok">${icon('check')}<span>תקין · ${models.length} מודלים · מומלץ ${esc(models[0].replace('models/', ''))}</span></div>`;
  } catch (e) {
    $('#st-keymsg').innerHTML = `<div class="note bad">${icon('alert')}<span>${esc(e.message)}</span></div>`;
  }
}

if (new URLSearchParams(location.search).has('debug')) {
  window.__kesef = { S, SHOT, ADD, DB, AI, C, IN, ST, Crypto, mkTx, normalizeItem, statsFor, render, reload, openShot, drawShot };
}

init();
