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

/* ==================== מקרא ==================== */

export function legend(keys) {
  const box = document.createElement('div');
  box.className = 'legend';
  box.innerHTML = keys.map(k =>
    `<span><i class="swatch" style="background:${k.color}"></i>${k.label}</span>`).join('');
  return box;
}
