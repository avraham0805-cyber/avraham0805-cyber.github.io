// גרפים — SVG מחושב ידנית, בלי ספריות.
// כללי הברזל: ציר אחד בלבד, סימנים דקים, רשת קווי-שיער, מרווח 2px בין מילויים,
// תיוג ישיר סלקטיבי, ולכל גרף יש תאום טבלאי.

const NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const c of [].concat(children)) if (c) n.appendChild(c);
  return n;
};
const txt = (s, attrs = {}) => {
  const n = el('text', attrs);
  n.textContent = s;
  return n;
};

/** ניקוד סדרה 0..7 → משתנה CSS. לעולם לא מחזורי — מעל 8 מקפלים ל"אחר". */
export const seriesVar = (i) => `var(--s${(i % 8) + 1})`;
export const OTHER_COLOR = 'var(--ink-3)';

/* ==================== שכבת ריחוף ==================== */

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
export function hideTip() { tip().classList.remove('on'); }

function bindTip(node, html) {
  const show = (e) => {
    const t = tip();
    t.innerHTML = html;
    t.classList.add('on');
    const r = t.getBoundingClientRect();
    const pad = 10;
    let x = (e.touches?.[0]?.clientX ?? e.clientX) - r.width / 2;
    let y = (e.touches?.[0]?.clientY ?? e.clientY) - r.height - 12;
    x = Math.max(pad, Math.min(x, innerWidth - r.width - pad));
    if (y < pad) y = (e.touches?.[0]?.clientY ?? e.clientY) + 16;
    t.style.left = x + 'px';
    t.style.top = (y + scrollY) + 'px';
  };
  node.addEventListener('pointerenter', show);
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerleave', hideTip);
  node.addEventListener('focus', (e) => show({ clientX: node.getBoundingClientRect().left + 20, clientY: node.getBoundingClientRect().top, ...e }));
  node.addEventListener('blur', hideTip);
}

/* ==================== עמודות לאורך זמן ==================== */

/**
 * סדרה אחת → צבע אחד. החודש הנוכחי מודגש, השאר עמומים.
 * items: [{ label, value, sub, current }]
 */
export function columns(items, { height = 132, fmt = String, onPick = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  if (!items.length) return wrap;

  const W = 100, H = height, padB = 20, padT = 12;
  const plotH = H - padB - padT;
  const max = Math.max(...items.map(d => d.value), 1);
  const n = items.length;
  const slot = W / n;
  const bw = Math.max(2.2, slot * 0.52);

  const svg = el('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
    style: `height:${H}px`, role: 'img',
  });

  // רשת — שני קווי שיער בלבד, מלאים, לא מקווקווים
  for (const f of [0.5, 1]) {
    svg.appendChild(el('line', {
      class: 'grid', x1: 0, x2: W, y1: padT + plotH * (1 - f), y2: padT + plotH * (1 - f),
      vectorEffect: 'non-scaling-stroke',
    }));
  }
  svg.appendChild(el('line', { class: 'base', x1: 0, x2: W, y1: padT + plotH, y2: padT + plotH, vectorEffect: 'non-scaling-stroke' }));

  items.forEach((d, i) => {
    const h = Math.max(d.value > 0 ? 1.5 : 0, plotH * (d.value / max));
    const x = slot * i + (slot - bw) / 2;
    const y = padT + plotH - h;
    const bar = el('rect', {
      class: 'bar' + (d.current ? '' : ' dim'), x, y, width: bw, height: h,
      rx: Math.min(1.4, bw / 3), fill: 'var(--s1)',
    });
    svg.appendChild(bar);
    const hit = el('rect', { class: 'hit', x: slot * i, y: 0, width: slot, height: H, tabindex: 0 });
    bindTip(hit, `<div class="k">${d.label}</div><b>${fmt(d.value)}</b>${d.sub ? `<div class="k">${d.sub}</div>` : ''}`);
    if (onPick) hit.addEventListener('click', () => onPick(d, i));
    svg.appendChild(hit);
  });

  wrap.appendChild(svg);

  // תוויות ציר — כל שנייה כשצפוף, כדי שלא יתנגשו
  const axis = document.createElement('div');
  axis.style.cssText = `display:grid;grid-template-columns:repeat(${n},1fr);margin-top:6px`;
  items.forEach((d, i) => {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:10px;text-align:center;color:var(--ink-3);font-variant-numeric:tabular-nums';
    s.textContent = (n > 8 && i % 2 === 1 && !d.current) ? '' : d.label;
    if (d.current) s.style.color = 'var(--ink)';
    axis.appendChild(s);
  });
  wrap.appendChild(axis);
  return wrap;
}

/* ==================== עמודות ערומות ==================== */

/**
 * הרכב לאורך זמן. עד 8 סדרות + "אחר"; מרווח 2px בין מקטעים.
 * cols: [{ label, parts: [{key,value}], total }]  ·  keys: [{key,label,color}]
 */
export function stacked(cols, keys, { height = 150, fmt = String } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  if (!cols.length) return wrap;

  const H = height, padB = 4, padT = 10;
  const plotH = H - padB - padT;
  const max = Math.max(...cols.map(c => c.total), 1);
  const n = cols.length;
  const svg = el('svg', { class: 'chart', viewBox: `0 0 100 ${H}`, preserveAspectRatio: 'none', style: `height:${H}px` });
  const slot = 100 / n;
  const bw = Math.max(2.5, slot * 0.56);
  const GAP = 2; // מרווח משטח בין מקטעים — לא מסגרת

  cols.forEach((c, i) => {
    const x = slot * i + (slot - bw) / 2;
    let acc = 0;
    const segs = keys.map(k => ({ k, v: c.parts[k.key] || 0 })).filter(s => s.v > 0);
    segs.forEach((s) => {
      const h = plotH * (s.v / max);
      const y = padT + plotH - acc - h;
      if (h > 0.4) {
        svg.appendChild(el('rect', {
          x, y: y + (acc > 0 ? GAP / 2 : 0), width: bw,
          height: Math.max(0.8, h - (acc > 0 ? GAP / 2 : 0)), fill: s.k.color,
        }));
      }
      acc += h;
    });
    const hit = el('rect', { class: 'hit', x: slot * i, y: 0, width: slot, height: H, tabindex: 0 });
    const lines = segs.slice().reverse().slice(0, 6)
      .map(s => `<div><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${s.k.color};margin-inline-end:5px"></span>${s.k.label} <b>${fmt(s.v)}</b></div>`)
      .join('');
    bindTip(hit, `<div class="k">${c.label}</div><b>${fmt(c.total)}</b>${lines}`);
    svg.appendChild(hit);
  });

  wrap.appendChild(svg);
  const axis = document.createElement('div');
  axis.style.cssText = `display:grid;grid-template-columns:repeat(${n},1fr);margin-top:6px`;
  cols.forEach((c, i) => {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:10px;text-align:center;color:var(--ink-3)';
    s.textContent = (n > 8 && i % 2 === 1) ? '' : c.label;
    axis.appendChild(s);
  });
  wrap.appendChild(axis);
  return wrap;
}

/* ==================== פרפר — הכנסה מול הוצאה ==================== */

/**
 * קוטביות סביב אפס: כחול=נכנס, אדום=יוצא, אמצע ניטרלי.
 * rows: [{ label, inV, outV, net }]
 */
export function butterfly(rows, { fmt = String, onPick = null } = {}) {
  const box = document.createElement('div');
  if (!rows.length) return box;
  const max = Math.max(...rows.flatMap(r => [r.inV, r.outV]), 1);

  rows.forEach((r, idx) => {
    const line = document.createElement('div');
    line.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--rule)';
    if (onPick) { line.style.cursor = 'pointer'; line.addEventListener('click', () => onPick(r, idx)); }

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-bottom:7px';
    head.innerHTML =
      `<span style="flex:1;font-size:13.5px;font-weight:560">${r.label}</span>` +
      `<span class="num" style="font-size:13.5px;font-weight:640;color:${r.net >= 0 ? 'var(--delta-up)' : 'var(--neg)'}">${r.net >= 0 ? '+' : '−'}${fmt(Math.abs(r.net))}</span>`;
    line.appendChild(head);

    const track = document.createElement('div');
    track.style.cssText = 'display:flex;align-items:center;height:9px;gap:2px';
    const left = document.createElement('div');
    left.style.cssText = 'flex:1;display:flex;justify-content:flex-start;height:100%';
    const right = document.createElement('div');
    right.style.cssText = 'flex:1;display:flex;justify-content:flex-end;height:100%';
    const mid = document.createElement('div');
    mid.style.cssText = 'width:1px;height:13px;background:var(--rule-2);flex:0 0 1px';

    const inBar = document.createElement('i');
    inBar.style.cssText = `display:block;height:100%;width:${(r.inV / max) * 100}%;background:var(--pos);border-radius:0 3px 3px 0`;
    const outBar = document.createElement('i');
    outBar.style.cssText = `display:block;height:100%;width:${(r.outV / max) * 100}%;background:var(--neg);border-radius:3px 0 0 3px`;

    // RTL: הכנסה יוצאת ימינה מהאמצע, הוצאה שמאלה
    right.appendChild(inBar); left.appendChild(outBar);
    track.append(right, mid, left);
    line.appendChild(track);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:space-between;margin-top:5px;font-size:11px;color:var(--ink-3)';
    foot.innerHTML =
      `<span class="num">נכנס ${fmt(r.inV)}</span><span class="num">יצא ${fmt(r.outV)}</span>`;
    line.appendChild(foot);
    box.appendChild(line);
  });
  return box;
}

/* ==================== קו ניצוץ ==================== */

export function sparkline(values, { width = 62, height = 18, color = 'var(--s1)' } = {}) {
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, style: `width:${width}px;height:${height}px` });
  if (values.length < 2) return svg;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const span = (max - min) || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(2)}`);
  svg.appendChild(el('polyline', {
    points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', vectorEffect: 'non-scaling-stroke',
  }));
  const lastY = height - 2 - ((values.at(-1) - min) / span) * (height - 4);
  svg.appendChild(el('circle', { cx: width, cy: lastY, r: 2.2, fill: color }));
  return svg;
}

/* ==================== מפת חום לפי יום בחודש ==================== */

const HEAT_STEPS = ['var(--q1)', 'var(--q2)', 'var(--q4)', 'var(--q6)', 'var(--q8)'];

export function heatmap(byDay, daysInMonth, { fmt = String, monthLabel = '' } = {}) {
  const box = document.createElement('div');
  const max = Math.max(...Object.values(byDay), 1);
  const grid = document.createElement('div');
  grid.className = 'heat';
  for (let d = 1; d <= daysInMonth; d++) {
    const v = byDay[d] || 0;
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.tabIndex = 0;
    if (v > 0) {
      const step = Math.min(HEAT_STEPS.length - 1, Math.floor((v / max) * HEAT_STEPS.length));
      cell.style.background = HEAT_STEPS[step];
    }
    bindTip(cell, `<div class="k">${d} ${monthLabel}</div><b>${v ? fmt(v) : 'ללא הוצאה'}</b>`);
    grid.appendChild(cell);
  }
  box.appendChild(grid);

  const scale = document.createElement('div');
  scale.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:10px;font-size:11px;color:var(--ink-3)';
  scale.innerHTML = '<span>נמוך</span>' +
    HEAT_STEPS.map(c => `<i style="width:15px;height:8px;border-radius:2px;background:${c};display:inline-block"></i>`).join('') +
    `<span>גבוה · עד ${fmt(max)}</span>`;
  box.appendChild(scale);
  return box;
}

/* ==================== מפל — מהכנסה לנטו ==================== */

/** steps: [{label, value, type:'base'|'add'|'sub'|'total'}] */
export function waterfall(steps, { height = 160, fmt = String } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  if (!steps.length) return wrap;

  const H = height, padT = 14, padB = 6;
  const plotH = H - padT - padB;
  let run = 0;
  const marks = steps.map(s => {
    if (s.type === 'total') return { ...s, from: 0, to: s.value };
    const from = run;
    run += (s.type === 'sub' ? -s.value : s.value);
    return { ...s, from, to: run };
  });
  const hi = Math.max(...marks.flatMap(m => [m.from, m.to]), 1);
  const lo = Math.min(...marks.flatMap(m => [m.from, m.to]), 0);
  const span = (hi - lo) || 1;
  const y = (v) => padT + plotH * (1 - (v - lo) / span);

  const svg = el('svg', { class: 'chart', viewBox: `0 0 100 ${H}`, preserveAspectRatio: 'none', style: `height:${H}px` });
  svg.appendChild(el('line', { class: 'base', x1: 0, x2: 100, y1: y(0), y2: y(0), vectorEffect: 'non-scaling-stroke' }));

  const n = marks.length, slot = 100 / n, bw = slot * 0.5;
  const COLOR = { base: 'var(--ink-3)', add: 'var(--pos)', sub: 'var(--neg)', total: 'var(--ink)' };

  marks.forEach((m, i) => {
    const x = slot * i + (slot - bw) / 2;
    const yt = Math.min(y(m.from), y(m.to)), yb = Math.max(y(m.from), y(m.to));
    svg.appendChild(el('rect', { x, y: yt, width: bw, height: Math.max(1.5, yb - yt), rx: 1.2, fill: COLOR[m.type] }));
    if (i < n - 1 && m.type !== 'total') {
      svg.appendChild(el('line', {
        class: 'grid', x1: x, x2: slot * (i + 1) + (slot - bw) / 2 + bw,
        y1: y(m.to), y2: y(m.to), vectorEffect: 'non-scaling-stroke',
      }));
    }
    const hit = el('rect', { class: 'hit', x: slot * i, y: 0, width: slot, height: H, tabindex: 0 });
    bindTip(hit, `<div class="k">${m.label}</div><b>${fmt(m.value)}</b>`);
    svg.appendChild(hit);
  });
  wrap.appendChild(svg);

  const axis = document.createElement('div');
  axis.style.cssText = `display:grid;grid-template-columns:repeat(${n},1fr);margin-top:6px`;
  marks.forEach(m => {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:10.5px;text-align:center;color:var(--ink-3);line-height:1.3';
    s.innerHTML = `${m.label}<br><b class="num" style="color:var(--ink-2)">${fmt(m.value)}</b>`;
    axis.appendChild(s);
  });
  wrap.appendChild(axis);
  return wrap;
}

/* ==================== סנקי — זרימת הכסף ==================== */

/**
 * הגרף המזוהה ביותר בתחום: מאיפה הכסף נכנס, לאן הוא יצא, ומה נשאר.
 * שלוש עמודות — מקורות הכנסה, צומת מרכזי, ויעדי הוצאה.
 * sources/targets: [{label, value, color}]
 */
export function sankey(sources, targets, { height = 300, fmt = String, hubLabel = 'נכנס' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  const totalIn = sources.reduce((s, x) => s + x.value, 0);
  const totalOut = targets.reduce((s, x) => s + x.value, 0);
  if (!totalIn && !totalOut) return wrap;

  const W = 100, H = height, PAD = 8;
  const scale = Math.max(totalIn, totalOut) || 1;
  const usable = H - PAD * 2;
  const GAP = 3;                       // מרווח משטח בין רצועות
  const colW = 13, hubW = 5;
  const hubX = (W - hubW) / 2;

  const svg = el('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
    style: `height:${H}px`, role: 'img',
  });

  const lay = (items, total) => {
    const n = items.filter(i => i.value > 0).length;
    const room = usable - GAP * Math.max(0, n - 1);
    let y = PAD;
    return items.filter(i => i.value > 0).map(i => {
      const h = Math.max(1.2, room * (i.value / (total || 1)));
      const rec = { ...i, y, h };
      y += h + GAP;
      return rec;
    });
  };

  const inRows = lay(sources, scale);
  const outRows = lay(targets, scale);

  // הצומת מתפרש על מלוא הגובה של הצד הגדול
  const hubTop = PAD, hubH = usable;
  svg.appendChild(el('rect', { x: hubX, y: hubTop, width: hubW, height: hubH, rx: 1, fill: 'var(--ink-3)' }));

  // רצועות — עקומת בזייה בין הקצה לצומת
  const ribbon = (x0, w0, y0, h0, x1, y1, h1, color) => {
    const mid = (x0 + w0 + x1) / 2;
    const d = `M${x0 + w0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}
               L${x1},${y1 + h1} C${mid},${y1 + h1} ${mid},${y0 + h0} ${x0 + w0},${y0 + h0} Z`;
    return el('path', { d, fill: color, 'fill-opacity': .34 });
  };

  // RTL: הכנסות מימין, הוצאות משמאל
  let acc = hubTop;
  for (const r of inRows) {
    const share = hubH * (r.value / scale);
    svg.appendChild(ribbon(W - colW, 0, r.y, r.h, hubX + hubW, acc, share, r.color));
    svg.appendChild(el('rect', { x: W - colW, y: r.y, width: colW, height: r.h, rx: 1, fill: r.color }));
    const hit = el('rect', { class: 'hit', x: W - colW, y: r.y, width: colW, height: r.h, tabindex: 0 });
    bindTip(hit, `<div class="k">${r.label}</div><b>${fmt(r.value)}</b>`);
    svg.appendChild(hit);
    acc += share;
  }

  acc = hubTop;
  for (const r of outRows) {
    const share = hubH * (r.value / scale);
    svg.appendChild(ribbon(hubX, 0, acc, share, colW, r.y, r.h, r.color));
    svg.appendChild(el('rect', { x: 0, y: r.y, width: colW, height: r.h, rx: 1, fill: r.color }));
    const hit = el('rect', { class: 'hit', x: 0, y: r.y, width: colW, height: r.h, tabindex: 0 });
    bindTip(hit, `<div class="k">${r.label}</div><b>${fmt(r.value)}</b>`);
    svg.appendChild(hit);
    acc += share;
  }
  wrap.appendChild(svg);

  // תוויות — מודפסות ב-HTML כדי שיישארו קריאות בכל רוחב
  const legendRow = (rows, align) => rows.map(r =>
    `<div style="display:flex;align-items:center;gap:6px;justify-content:${align};margin-bottom:3px">
       <i class="swatch" style="background:${r.color};margin:0"></i>
       <span style="font-size:11px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}</span>
       <span class="num" style="font-size:11px;color:var(--ink-3)">${fmt(r.value)}</span>
     </div>`).join('');

  // סדר העמודות חייב להתאים לצדדים בגרף: בעברית הילד הראשון יושב מימין,
  // ובגרף ההכנסות מצוירות מימין — לכן הן קודמות.
  const labels = document.createElement('div');
  labels.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px';
  labels.innerHTML =
    `<div><div style="font-size:10px;font-weight:660;letter-spacing:.08em;color:var(--ink-3);margin-bottom:6px">${hubLabel}</div>${legendRow(inRows, 'flex-start')}</div>` +
    `<div><div style="font-size:10px;font-weight:660;letter-spacing:.08em;color:var(--ink-3);margin-bottom:6px">יצא</div>${legendRow(outRows, 'flex-start')}</div>`;
  wrap.appendChild(labels);
  return wrap;
}

/* ==================== קו מצטבר ==================== */

/**
 * ההוצאה המצטברת מתחילת החודש מול אותה נקודה בחודש הקודם.
 * זה המבט היומי: האם אני מעל או מתחת לעצמי.
 */
export function cumulativeLine(current, previous, { height = 110, fmt = String, budget = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  const n = Math.max(current.length, previous.length);
  if (!n) return wrap;
  const max = Math.max(...current, ...previous, budget, 1);
  const W = 100, H = height, padT = 6, padB = 4;
  const plot = H - padT - padB;
  const x = (i) => (i / Math.max(1, n - 1)) * W;
  const y = (v) => padT + plot * (1 - v / max);

  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', style: `height:${H}px` });

  if (budget) {
    svg.appendChild(el('line', {
      class: 'grid', x1: 0, x2: W, y1: y(budget), y2: y(budget), vectorEffect: 'non-scaling-stroke',
    }));
  }

  const path = (arr, color, width, opacity = 1) => {
    if (arr.length < 2) return null;
    return el('polyline', {
      points: arr.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' '),
      fill: 'none', stroke: color, 'stroke-width': width, opacity,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', vectorEffect: 'non-scaling-stroke',
    });
  };
  const prev = path(previous, 'var(--ink-3)', 2, .5);
  if (prev) svg.appendChild(prev);
  const cur = path(current, 'var(--s1)', 2);
  if (cur) svg.appendChild(cur);

  if (current.length) {
    svg.appendChild(el('circle', { cx: x(current.length - 1), cy: y(current.at(-1)), r: 2.4, fill: 'var(--s1)' }));
  }

  for (let i = 0; i < n; i++) {
    const hit = el('rect', { class: 'hit', x: x(i) - W / n / 2, y: 0, width: W / n, height: H, tabindex: 0 });
    const c = current[i], p = previous[i];
    bindTip(hit, `<div class="k">יום ${i + 1}</div>` +
      (c !== undefined ? `<b>${fmt(c)}</b>` : '') +
      (p !== undefined ? `<div class="k">חודש קודם ${fmt(p)}</div>` : ''));
    svg.appendChild(hit);
  }
  wrap.appendChild(svg);
  return wrap;
}

/* ==================== מקרא ==================== */

export function legend(keys) {
  const box = document.createElement('div');
  box.className = 'legend';
  box.innerHTML = keys.map(k =>
    `<span><i class="swatch" style="background:${k.color}"></i>${k.label}</span>`).join('');
  return box;
}


/* ==================== קו ערך — תומך בשלילי ==================== */

/**
 * קו יחיד עם ציר אפס. cumulativeLine מנרמל 0..max ולכן שובר על ערכים
 * שליליים — כאן הנרמול הוא min..max אמיתי, עם קו אפס כשצריך.
 * points: [{label, value}]
 */
export function line(points, { height = 120, fmt = String } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chartwrap';
  if (points.length < 2) return wrap;
  const vals = points.map(p => p.value);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  const span = (max - min) || 1;
  const W = 100, H = height, padT = 8, padB = 6;
  const plot = H - padT - padB;
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => padT + plot * (1 - (v - min) / span);

  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', style: `height:${H}px`, role: 'img' });
  if (min < 0 && max > 0) {
    svg.appendChild(el('line', { class: 'grid', x1: 0, x2: W, y1: y(0), y2: y(0), vectorEffect: 'non-scaling-stroke' }));
  }
  svg.appendChild(el('polyline', {
    points: points.map((p, i) => `${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' '),
    fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', vectorEffect: 'non-scaling-stroke',
  }));
  const last = points.at(-1);
  svg.appendChild(el('circle', { cx: x(points.length - 1), cy: y(last.value), r: 2.4, fill: 'var(--s1)' }));
  points.forEach((p, i) => {
    const hit = el('rect', { class: 'hit', x: x(i) - W / points.length / 2, y: 0, width: W / points.length, height: H, tabindex: 0 });
    bindTip(hit, `<div class="k">${p.label}</div><b>${fmt(p.value)}</b>`);
    svg.appendChild(hit);
  });
  wrap.appendChild(svg);
  return wrap;
}

/* ==================== לוח חודש ==================== */

/**
 * לוח חודשי עם סכום על כל יום — ללוח החיובים הקרובים.
 * byDay: Map מספר-יום → {total, items:[string]}
 */
export function monthGrid(month, byDay, { fmt = String, today = null } = {}) {
  const [y, mo] = month.split('-').map(Number);
  const dim = new Date(y, mo, 0).getDate();
  const firstDow = new Date(y, mo - 1, 1).getDay();       // 0=ראשון
  const wrap = document.createElement('div');
  wrap.className = 'calgrid';
  wrap.setAttribute('dir', 'rtl');
  for (const h of ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']) {
    const c = document.createElement('div');
    c.className = 'calhead'; c.textContent = h;
    wrap.appendChild(c);
  }
  for (let i = 0; i < firstDow; i++) {
    const c = document.createElement('div');
    c.className = 'calcell empty';
    wrap.appendChild(c);
  }
  for (let d = 1; d <= dim; d++) {
    const c = document.createElement('div');
    const e = byDay.get(d);
    c.className = 'calcell' + (e ? ' has' : '') + (today === d ? ' today' : '');
    c.innerHTML = `<span class="d">${d}</span>` + (e ? `<span class="v">${fmt(e.total)}</span>` : '');
    if (e) c.title = e.items.join('\n');
    wrap.appendChild(c);
  }
  return wrap;
}
