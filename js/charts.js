// Charts built from plain HTML + CSS (no library): grouped columns over time, and ranked horizontal bars.
// Every chart: legend when there are 2+ series, hover + keyboard tooltip, and a table view of the same numbers.
import { h, icon, ledger } from './ui.js';
import { money } from './fmt.js';

/* ---------- number words for axis ticks ---------- */
export function compact(n) {
  const a = Math.abs(n);
  const trim = (x) => String(Math.round(x * 10) / 10);
  if (a >= 1e9) return `${trim(n / 1e9)} ملیار`;
  if (a >= 1e6) return `${trim(n / 1e6)} ملیۆن`;
  if (a >= 1e3) return `${trim(n / 1e3)} هەزار`;
  return String(Math.round(n));
}

/** a round step so that [0..max] needs at most `maxTicks` intervals */
function niceStep(range, maxTicks = 4) {
  if (!(range > 0)) return 1;
  const raw = range / maxTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

/* ---------- tooltip ---------- */
function makeTip(host) {
  const tip = h('div', { class: 'tip', role: 'status', hidden: true });
  host.append(tip);
  return {
    el: tip,
    show(title, rows, anchor) {
      tip.replaceChildren(
        h('div', { class: 'tip__title' }, title),
        ...rows.map(([color, label, value]) => h('div', { class: 'tip__row' },
          color ? h('i', { class: 'tip__sw', style: { background: color } }) : h('i', { class: 'tip__sw tip__sw--none' }),
          h('span', { class: 'tip__label' }, label),
          h('span', { class: 'num tip__val' }, value))));
      tip.hidden = false;
      const hostBox = host.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h2 = tip.offsetHeight;
      const cx = anchor.x - hostBox.left;
      let left = cx < hostBox.width / 2 ? cx + 14 : cx - w - 14;
      left = Math.max(4, Math.min(left, hostBox.width - w - 4));
      let top = anchor.y - hostBox.top - h2 / 2;
      top = Math.max(4, Math.min(top, hostBox.height - h2 - 4));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function chartFrame({ title, subtitle, legend, canTable = true }) {
  const view = h('div', { class: 'chart__view' });
  let showTable = false;
  let renderPlot = () => {};
  let renderTable = () => {};
  const toggle = h('button', { class: 'btn btn--quiet btn--sm chart__toggle', type: 'button', 'aria-pressed': 'false', onclick: () => {
    showTable = !showTable;
    toggle.setAttribute('aria-pressed', String(showTable));
    toggle.replaceChildren(icon(showTable ? 'report' : 'receipt', 16), h('span', null, showTable ? 'هێڵکاری' : 'خشتە'));
    paint();
  } }, icon('receipt', 16), h('span', null, 'خشتە'));
  const legendEl = h('ul', { class: 'legend' });
  const el = h('figure', { class: 'chart' },
    h('figcaption', { class: 'chart__head' },
      h('div', { class: 'chart__titles' }, h('h3', { class: 'chart__title' }, title), subtitle ? h('p', { class: 'chart__sub' }, subtitle) : null),
      h('div', { class: 'chart__tools' }, legendEl, canTable ? toggle : null)),
    view);
  function setLegend(items) {
    legendEl.replaceChildren(...(items.length > 1 ? items.map((s) => h('li', { class: 'legend__item' }, h('i', { class: 'legend__sw', style: { background: s.color } }), s.label)) : []));
    legendEl.hidden = items.length < 2;
  }
  function paint() {
    if (view._ro) {
      view._ro.disconnect();
      view._ro = null;
    }
    view.replaceChildren();
    (showTable ? renderTable : renderPlot)(view);
  }
  return {
    el,
    view,
    setLegend,
    paint,
    setRenderers(plot, table) {
      renderPlot = plot;
      renderTable = table;
    },
    stale(on) {
      view.classList.toggle('is-stale', !!on);
    },
    setTitle(t, s) {
      el.querySelector('.chart__title').textContent = t;
      const sub = el.querySelector('.chart__sub');
      if (sub) sub.textContent = s || '';
    },
  };
}

/* ======================================================================
   Columns over time (1–2 series, may include negative values)
   ====================================================================== */
export function columnChart({ title, subtitle, empty = 'هیچ داتایەک نییە لەم ماوەیەدا', unit = 'دینار', height = 240 }) {
  let cats = [];
  let series = [];
  const frame = chartFrame({ title, subtitle });

  function plot(view) {
    const hasData = series.some((s) => s.values.some((v) => v !== 0));
    if (!cats.length || !hasData) {
      view.append(h('div', { class: 'chart__empty', style: { minHeight: `${height}px` } }, empty));
      return;
    }
    const all = series.flatMap((s) => s.values);
    const maxPos = Math.max(0, ...all);
    const maxNeg = Math.max(0, ...all.map((v) => -v));
    const step = niceStep(maxPos + maxNeg, 4);
    const top = Math.ceil(maxPos / step) * step;
    const bottom = Math.ceil(maxNeg / step) * step;
    const total = top + bottom || step;
    const posShare = (top / total) * 100;
    const negShare = (bottom / total) * 100;

    const ticks = [];
    for (let v = -bottom; v <= top + 1e-9; v += step) ticks.push(v);
    const pctOf = (v) => ((v + bottom) / total) * 100;

    const yaxis = h('div', { class: 'plot__y' }, ticks.map((v) => h('span', { style: { bottom: `${pctOf(v)}%` } }, compact(v))));
    const grid = h('div', { class: 'plot__grid' }, ticks.map((v) => h('i', { class: v === 0 ? 'is-zero' : '', style: { bottom: `${pctOf(v)}%` } })));
    const tip = makeTip(view);

    const cols = h('div', { class: 'plot__cols' });
    cats.forEach((c, i) => {
      const pos = series.map((s) => {
        const v = s.values[i];
        return h('b', { class: 'bar', style: { '--c': s.color, height: v > 0 ? `max(2px, ${(v / top) * 100}%)` : '0' } });
      });
      const neg = bottom > 0 ? series.map((s) => {
        const v = s.values[i];
        return h('b', { class: 'bar bar--neg', style: { '--c': s.color, height: v < 0 ? `max(2px, ${(-v / bottom) * 100}%)` : '0' } });
      }) : [];
      const label = `${c.long || c.label}: ${series.map((s) => `${s.label} ${money(s.values[i])}`).join('، ')}`;
      const g = h('div', { class: 'grp', tabindex: '0', role: 'img', 'aria-label': label },
        h('div', { class: 'grp__pos', style: { height: `${posShare}%` } }, pos),
        bottom > 0 ? h('div', { class: 'grp__neg', style: { height: `${negShare}%` } }, neg) : null);
      const showTip = (x, y) => tip.show(c.long || c.label, series.map((s) => [s.color, s.label, `${money(s.values[i])} ${unit}`]), { x, y });
      g.addEventListener('pointerenter', (e) => showTip(e.clientX, e.clientY));
      g.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY));
      g.addEventListener('pointerleave', () => tip.hide());
      g.addEventListener('focus', () => {
        const r = g.getBoundingClientRect();
        showTip(r.left + r.width / 2, r.top + 24);
      });
      g.addEventListener('blur', () => tip.hide());
      cols.append(g);
    });

    const xaxis = h('div', { class: 'plot__x' }, cats.map((c) => h('span', null, c.label)));
    const body = h('div', { class: 'plot__body' }, grid, cols);
    const root = h('div', { class: 'plot', dir: 'ltr', style: { '--plot-h': `${height}px` } }, yaxis, body, xaxis);
    view.prepend(root);

    // show only as many x labels as fit
    const thin = () => {
      const w = body.clientWidth || 600;
      const every = Math.max(1, Math.ceil(cats.length / Math.max(2, Math.floor(w / 62))));
      [...xaxis.children].forEach((s, i) => s.classList.toggle('is-off', i % every !== 0));
    };
    thin();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(thin);
      ro.observe(body);
      view._ro = ro;
    }
  }

  function table(view) {
    const t = ledger({
      dense: true,
      rowKey: (r) => r.i,
      columns: [
        { key: 'label', label: 'ڕۆژ', render: (r) => r.label },
        ...series.map((s, k) => ({ key: `v${k}`, label: s.label, num: true, value: (r) => r.values[k] })),
      ],
      empty,
    });
    t.update(cats.map((c, i) => ({ i, label: c.long || c.label, values: series.map((s) => s.values[i]) })));
    view.append(h('div', { class: 'chart__table' }, t.el));
  }

  frame.setRenderers(plot, table);
  return {
    el: frame.el,
    update(next) {
      cats = next.categories;
      series = next.series;
      if (next.title) frame.setTitle(next.title, next.subtitle);
      frame.setLegend(series);
      frame.paint();
    },
    stale: frame.stale,
  };
}

/* ======================================================================
   Ranked horizontal bars (one series). rows: [{ label, value, tip: [[label, value], ...] }]
   ====================================================================== */
export function rankChart({ title, subtitle, color, empty = 'هیچ داتایەک نییە لەم ماوەیەدا', unit = 'دینار', valueLabel = 'بڕ' }) {
  let rows = [];
  const frame = chartFrame({ title, subtitle });

  function plot(view) {
    if (!rows.length) {
      view.append(h('div', { class: 'chart__empty' }, empty));
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    const tip = makeTip(view);
    const list = h('ol', { class: 'rank' }, rows.map((r) => {
      const li = h('li', { class: 'rank__row', tabindex: '0', 'aria-label': `${r.label}: ${money(r.value)} ${unit}` },
        h('span', { class: 'rank__label', title: r.label }, r.label),
        h('span', { class: 'rank__track' }, h('i', { class: 'rank__bar', style: { width: `${Math.max(r.value > 0 ? 1.5 : 0, (Math.max(r.value, 0) / max) * 100)}%`, '--c': color } })),
        h('span', { class: 'num rank__val' }, money(r.value)));
      const show = (x, y) => tip.show(r.label, [[color, valueLabel, `${money(r.value)} ${unit}`], ...(r.tip || []).map(([l, v]) => [null, l, v])], { x, y });
      li.addEventListener('pointerenter', (e) => show(e.clientX, e.clientY));
      li.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      li.addEventListener('pointerleave', () => tip.hide());
      li.addEventListener('focus', () => {
        const b = li.getBoundingClientRect();
        show(b.left + b.width / 2, b.top + b.height / 2);
      });
      li.addEventListener('blur', () => tip.hide());
      return li;
    }));
    view.prepend(list);
  }

  function table(view) {
    const extra = [...new Set(rows.flatMap((r) => (r.tip || []).map(([l]) => l)))];
    const t = ledger({
      dense: true,
      rowKey: (r) => r.label,
      columns: [
        { key: 'label', label: 'کاڵا', render: (r) => r.label },
        { key: 'value', label: valueLabel, num: true },
        ...extra.map((l) => ({ key: l, label: l, num: true, value: (r) => { const f = (r.tip || []).find(([x]) => x === l); return f ? f[1] : null; }, render: (r) => { const f = (r.tip || []).find(([x]) => x === l); return f ? f[1] : '—'; } })),
      ],
      empty,
    });
    t.update(rows);
    view.append(h('div', { class: 'chart__table' }, t.el));
  }

  frame.setRenderers(plot, table);
  return {
    el: frame.el,
    update(next) {
      rows = next.rows;
      if (next.title) frame.setTitle(next.title, next.subtitle);
      if (next.color) color = next.color;
      frame.setLegend([]);
      frame.paint();
    },
    stale: frame.stale,
  };
}
