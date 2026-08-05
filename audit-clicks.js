// ביקורת חיווט — לוחצת על נציג אחד מכל סוג כפתור ומודדת אם משהו קרה.
//
// הבדיקות הרגילות בודקות לוגיקה. הן לא תופסות שדה שמצויר ואיש לא קורא
// ממנו, או כפתור בלי מטפל. את זה תופסים רק בלחיצה בפועל.
// "לחיצה מתה" = לא נזרקה שגיאה ולא השתנה דבר ב-DOM — בדיוק הפרופיל
// של פיצ׳ר שנראה עובד ואינו עובד.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const R = { clicked: 0, dead: [], errors: [], skipped: [], inputs: { live: 0, dead: [] }, ran: [] };

let mutated = false;
const observer = new MutationObserver(() => { mutated = true; });

const errors = [];
const onErr = (e) => errors.push(e.message || String(e.reason));

function tag(el) {
  const d = [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name + (a.value ? '=' + a.value : ''));
  return (el.id ? '#' + el.id : '') + (d.length ? ' [' + d.join(' ') + ']' : '') +
    ' «' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) + '»';
}

/** לחיצה עליהם הרסנית, פותחת דיאלוג, או יוצאת מהאפליקציה */
const SKIP = [
  '#st-wipe', '#st-clearrules', '#split-save', '#save-balances', '#save-budgets', '#add-save',
  '#st-export', '#st-export-enc', '#st-csv', '#st-import', '#filein', '#jsonin', '#add-newtag',
  '[data-restore]', '[data-fdel]', '[data-sdel]', '[data-ruledel]', '[data-fsave]', '[data-ssave]',
  '#st-savekey', '#st-test', '#act-shot', '[data-shot]', '#lock-go', '#pin-go', '[data-pin]',
];
const skip = (el) => SKIP.some(s => el.matches(s));

/** דפוס הכפתור — 90 קטגוריות הן דפוס אחד, לא 90 */
const kind = (el) =>
  (el.id || '') + '|' +
  [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name).sort().join(',') + '|' +
  String(el.className).replace(/\bon\b/, '');

async function clickOnePerKind(scope, label, budgetMs = 4000) {
  const t0 = performance.now();
  const seen = new Set();
  for (const el of [...scope.querySelectorAll('button, .row[data-tx], .chip, .quick')]) {
    if (performance.now() - t0 > budgetMs) { R.skipped.push(label + ' (חריגת זמן)'); break; }
    if (!document.body.contains(el)) continue;
    if (skip(el)) { R.skipped.push(label + ' ' + tag(el)); continue; }
    const k = kind(el);
    if (seen.has(k)) continue;
    seen.add(k);
    mutated = false;
    const before = errors.length;
    try { el.click(); } catch (e) { errors.push(tag(el) + ': ' + e.message); }
    await sleep(20);
    R.clicked++;
    if (errors.length > before) R.errors.push(label + ' ' + tag(el) + ' → ' + errors.at(-1));
    else if (!mutated) R.dead.push(label + ' ' + tag(el));
  }
}

/** שדה שאיש לא קורא ממנו = ערך שנכתב ונעלם */
async function probeInputs(scope, label) {
  for (const el of scope.querySelectorAll('input[data-splitamt], input[data-bal], input[data-budget], input[data-fld]')) {
    mutated = false;
    const old = el.value;
    el.value = '17';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(35);
    if (mutated) R.inputs.live++; else R.inputs.dead.push(label + ' ' + tag(el));
    el.value = old;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const closeSheets = () => {
  document.querySelectorAll('.sheet.on').forEach(s => s.classList.remove('on'));
  document.body.style.overflow = '';
};

export async function runAudit(K) {
  const dialogs = { confirm: window.confirm, prompt: window.prompt, alert: window.alert };
  Object.assign(window, { confirm: () => false, prompt: () => null, alert: () => {} });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onErr);
  try { return await crawl(K); }
  catch (e) { R.errors.push('הזחלן נפל: ' + e.message); return R; }
  finally {
    Object.assign(window, dialogs);
    observer.disconnect();
    removeEventListener('error', onErr);
    removeEventListener('unhandledrejection', onErr);
    closeSheets();
  }
}

async function seed(K) {
  await K.DB.clear('tx');
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    rows.push(K.mkTx({ dateBuy: `${m}-05`, merchant: 'NETFLIX', amount: 4500, ils: 4500, dept: 'subs', cat: 'streaming' }));
    rows.push(K.mkTx({ dateBuy: `${m}-10`, merchant: 'משכורת', amount: 900000, ils: 900000, dept: 'income', cat: 'salary' }));
    rows.push(K.mkTx({ dateBuy: `${m}-12`, merchant: 'רמי לוי', amount: 32000, ils: 32000, dept: 'food', cat: 'super', account: 'cash', method: 'cash' }));
    rows.push(K.mkTx({ dateBuy: `${m}-15`, merchant: 'KSP', amount: 49900, ils: 49900, dept: 'shopping', cat: 'electronics', installment: { n: i + 1, of: 12 } }));
    rows.push(K.mkTx({ dateBuy: `${m}-18`, merchant: 'פז', amount: 30000, ils: 30000, dept: 'transport', cat: 'fuel', account: 'bank2' }));
  }
  await K.DB.saveTxMany(rows);
  await K.DB.putMany('budgets', [{ key: 'food', amount: 200000 }, { key: 'transport', amount: 100000 }]);
  for (const a of K.S.accounts) await K.DB.put('accounts', { ...a, balance: 500000, balanceDate: rows.at(-1).dateBuy });
  await K.DB.put('fixed', { id: 'fx1', merchant: 'שכר דירה', amount: 540000, dept: 'home', cat: 'rent', day: 1, account: 'bank1', method: 'bank', active: true });
  await K.DB.learn('רמי לוי', { dept: 'food', cat: 'super' });
  await K.reload();
}

async function crawl(K) {
  await seed(K);

  for (const v of ['home', 'analysis', 'insights', 'ledger', 'settings']) {
    R.ran.push('view:' + v);
    K.S.view = v; K.render(); await sleep(350);
    await clickOnePerKind(document.querySelector('#v-' + v), `[${v}]`);
    closeSheets();
  }

  const sheets = [
    ['sh-add', async () => { K.S.view = 'home'; K.render(); await sleep(200); document.querySelector('#act-cash').click(); }],
    ['sh-cat', async () => { K.S.view = 'home'; K.render(); await sleep(200); document.querySelector('#act-cash').click(); await sleep(200); document.querySelector('#add-cat').click(); }],
    ['sh-balances', async () => { K.S.view = 'home'; K.render(); await sleep(200); document.querySelector('#edit-balances').click(); }],
    ['sh-budgets', async () => { K.S.view = 'home'; K.render(); await sleep(200); document.querySelector('#edit-budgets').click(); }],
    ['sh-tx', async () => { K.S.view = 'home'; K.render(); await sleep(200); document.querySelector('[data-tx]').click(); }],
    ['sh-fixed', async () => { K.S.view = 'settings'; K.render(); await sleep(350); document.querySelector('[data-fixed]')?.click(); }],
    ['sh-account', async () => { K.S.view = 'settings'; K.render(); await sleep(350); document.querySelector('[data-acct]')?.click(); }],
    ['sh-rules', async () => { K.S.view = 'settings'; K.render(); await sleep(350); document.querySelector('#st-managerules')?.click(); }],
  ];

  for (const [id, open] of sheets) {
    R.ran.push('sheet:' + id);
    closeSheets();
    try { await open(); } catch (e) { R.errors.push(id + ' לא נפתחה: ' + e.message); continue; }
    await sleep(350);
    const sheet = document.querySelector('#' + id);
    if (!sheet?.classList.contains('on')) { R.errors.push(id + ' לא נפתחה'); continue; }
    await probeInputs(sheet, `[${id}]`);
    await clickOnePerKind(sheet, `[${id}]`, 3000);
    closeSheets();
  }

  // הפיצול נפתח בשני שלבים
  R.ran.push('sheet:sh-split');
  closeSheets();
  K.S.view = 'home'; K.render(); await sleep(300);
  const plain = [...document.querySelectorAll('[data-tx]')]
    .find(el => { const t = K.S.txs.find(x => x.id === el.dataset.tx); return t && !t.installment && K.ST.flowOf(t.dept) === 'out'; });
  if (!plain) { R.errors.push('sh-split: לא נמצאה תנועה שניתן לפצל'); return R; }
  plain.click(); await sleep(300);
  const btn = document.querySelector('[data-tx-act="split"]');
  if (!btn) { R.errors.push('sh-split: כפתור הפיצול חסר'); return R; }
  btn.click(); await sleep(350);
  await probeInputs(document.querySelector('#sh-split'), '[sh-split]');
  await clickOnePerKind(document.querySelector('#sh-split'), '[sh-split]', 3000);
  closeSheets();
  return R;
}
