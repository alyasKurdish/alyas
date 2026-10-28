// Weekly report (admin only): the whole week day by day (Saturday..Friday), and the details of any day you pick:
// total sales, profit, withdrawals, what sold and what did not.
import * as api from '../api.js';
import { h, button, ledger, segmented, loading, mount, toast, badge } from '../ui.js';
import { money, todayKey, addDays, weekdayOf, fmtDay, fmtLongDate, fmtDayShort, fmtDateNum, fmtTime } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, panel, latest } from '../pagekit.js';
import { columnChart } from '../charts.js';

const REVENUE = '#12805F';
const PROFIT = '#C98500';
const UNSOLD_LIMIT = 40;

/** the Saturday that starts the week containing `key` */
function weekStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday .. 6 = Saturday
  return addDays(key, -((dow + 1) % 7));
}

export default async function weekly(root) {
  const weekGuard = latest();
  const dayGuard = latest();
  const today = todayKey();
  let day = today;
  let start = weekStart(today);
  let week = [];

  /* ---------- week navigation ---------- */
  const label = h('strong', { class: 'wk__label' });
  const picker = h('input', { class: 'input input--date', type: 'date', max: today, value: day, 'aria-label': 'دیاریکردنی ڕۆژ' });
  picker.addEventListener('change', () => { if (picker.value) pickDay(picker.value > today ? today : picker.value); });
  const prev = button('هەفتەی پێشوو', { variant: 'ghost', size: 'sm', onClick: () => shiftWeek(-7) });
  const next = button('هەفتەی داهاتوو', { variant: 'ghost', size: 'sm', onClick: () => shiftWeek(7) });
  const nowBtn = button('ئەمڕۆ', { size: 'sm', onClick: () => pickDay(today) });
  const nav = h('div', { class: 'toolbar wk__nav' }, prev, label, next, h('span', { class: 'wk__spacer' }), h('label', { class: 'wk__pick' }, h('span', null, 'ڕۆژێک هەڵبژێرە'), picker), nowBtn);

  const weekBand = h('div');
  const chart = columnChart({ title: 'فرۆشتن و قازانجی ڕۆژانە', subtitle: 'شەممە تا هەینی', unit: 'دینار', empty: 'هیچ فرۆشتنێک نییە لەم هەفتەیەدا.' });
  const segHolder = h('div', { class: 'wk__days' });

  const dayCols = [
    { key: 'day', label: 'ڕۆژ', sort: false, render: (r) => h('span', null, h('strong', null, weekdayOf(r.day)), h('span', { class: 'sub' }, fmtDateNum(r.day))) },
    { key: 'total_sales', label: 'کۆی فرۆشتن', num: true, render: (r) => money(r.total_sales) },
    { key: 'profit', label: 'قازانج', num: true, render: (r) => h('strong', { class: 'num num--good' }, money(r.profit)) },
    { key: 'withdrawn', label: 'ڕاکێشان', num: true, render: (r) => (r.withdrawn ? h('span', { class: 'num num--neg' }, money(r.withdrawn)) : '—') },
    { key: 'left', label: 'ماوە', num: true, render: (r) => money(r.left) },
  ];
  const weekTable = ledger({
    columns: dayCols, cards: true, rowKey: (r) => r.day, onRowClick: (r) => pickDay(r.day),
    empty: 'هیچ داتایەک نییە.',
    footer: (rows) => ({
      total_sales: rows.reduce((a, r) => a + r.total_sales, 0),
      profit: rows.reduce((a, r) => a + r.profit, 0),
      withdrawn: rows.reduce((a, r) => a + r.withdrawn, 0),
      left: rows.reduce((a, r) => a + r.left, 0),
      day: 'کۆی هەفتە',
    }),
  });

  /* ---------- the picked day ---------- */
  const dayTitle = h('h2', { class: 'wk__daytitle' });
  const dayBand = h('div');
  const dayBand2 = h('div');
  const soldTable = ledger({
    columns: [
      { key: 'name', label: 'کاڵا', sort: true },
      { key: 'net_qty', label: 'دانە', num: true, sort: true },
      { key: 'revenue', label: 'فرۆشتن', num: true, sort: true },
      { key: 'profit', label: 'قازانج', num: true, sort: true, render: (r) => h('strong', { class: `num${r.profit < 0 ? ' num--neg' : ' num--good'}` }, money(r.profit)) },
    ],
    cards: true, rowKey: (r) => r.id, defaultSort: { key: 'revenue', dir: 'desc' }, dense: true,
    empty: 'هیچ کاڵایەک نەفرۆشراوە لەم ڕۆژەدا.',
  });
  const unsoldTable = ledger({
    columns: [
      { key: 'name', label: 'کاڵا', sort: true },
      { key: 'stock', label: 'ماوە', num: true, sort: true },
      { key: 'last_sold_at', label: 'کۆتا فرۆشتن', sort: true, render: (r) => (r.last_sold_at ? fmtDateNum(r.last_sold_at) : 'هەرگیز') },
    ],
    cards: true, rowKey: (r) => r.id, defaultSort: { key: 'stock', dir: 'desc' }, dense: true,
    empty: 'هەموو کاڵاکان فرۆشراون.',
  });
  const soldPanel = h('div');
  const unsoldPanel = h('div');
  const svcPanel = h('div');
  const wdPanel = h('div');

  async function loadWeek() {
    const k = weekGuard.next();
    root.classList.add('is-stale');
    try {
      const rows = await api.rpc('week_report', { p_from: start, p_to: addDays(start, 6) });
      if (!weekGuard.isCurrent(k)) return;
      week = rows;
      paintWeek();
    } catch (e) {
      if (weekGuard.isCurrent(k)) toast(errText(e), 'err');
    } finally {
      if (weekGuard.isCurrent(k)) root.classList.remove('is-stale');
    }
  }
  function paintWeek() {
    label.textContent = `${fmtDay(start)} — ${fmtDay(addDays(start, 6))}`;
    next.disabled = addDays(start, 7) > today;
    const sum = (k) => week.reduce((a, r) => a + r[k], 0);
    const best = week.reduce((a, r) => (!a || r.total_sales > a.total_sales ? r : a), null);
    mount(weekBand, kpiBand([
      { label: 'کۆی فرۆشتنی هەفتە (کاڵا + خزمەتگوزاری)', value: sum('total_sales'), unit: 'دینار', sub: `کاڵا ${money(sum('goods_revenue'))} + خزمەتگوزاری ${money(sum('service_profit'))}` },
      { label: 'قازانجی هەفتە', value: sum('profit'), unit: 'دینار', tone: 'good', sub: `کاڵا ${money(sum('goods_profit'))} + خزمەتگوزاری ${money(sum('service_profit'))}` },
      { label: 'پارەی ڕاکێشراو', value: sum('withdrawn'), unit: 'دینار', tone: sum('withdrawn') ? 'bad' : undefined, sub: `${money(sum('withdrawn_count'))} جار` },
      { label: 'ماوە (فرۆشتن − ڕاکێشان)', value: sum('left'), unit: 'دینار' },
      { label: 'ژمارەی وەسڵ', value: sum('receipts'), sub: `${money(sum('items'))} دانە` },
      best && best.total_sales > 0 ? { label: 'باشترین ڕۆژ', value: weekdayOf(best.day), sub: `${money(best.total_sales)} دینار` } : { label: 'باشترین ڕۆژ', value: '—' },
    ], { className: 'kpi--today' }));
    chart.update({
      title: 'فرۆشتن و قازانجی ڕۆژانە', subtitle: 'شەممە تا هەینی',
      categories: week.map((d) => ({ label: `${weekdayOf(d.day)} ${fmtDayShort(d.day)}`, long: fmtLongDate(d.day) })),
      series: [{ key: 'sales', label: 'کۆی فرۆشتن', color: REVENUE, values: week.map((d) => d.total_sales) }, { key: 'profit', label: 'قازانج', color: PROFIT, values: week.map((d) => d.profit) }],
    });
    weekTable.update(week);
    const opts = week.map((d) => ({ value: d.day, label: weekdayOf(d.day) }));
    const seg = segmented({ label: 'ڕۆژ', value: day, options: opts, onChange: (v) => pickDay(v) });
    segHolder.replaceChildren(seg);
    // days after today have no data
    seg.querySelectorAll('.seg__btn').forEach((b) => { if (b.dataset.value > today) { b.disabled = true; } });
  }

  async function loadDay() {
    const k = dayGuard.next();
    dayTitle.textContent = fmtLongDate(day);
    try {
      const [s, prods, unsold, sv, wd] = await Promise.all([
        api.rpc('report_summary', { p_from: day, p_to: day }),
        api.rpc('report_products', { p_from: day, p_to: day }),
        api.rpc('report_unsold', { p_from: day, p_to: day }),
        api.rpc('list_services', { p_from: day, p_to: day, p_limit: 200, p_offset: 0 }),
        api.rpc('list_withdrawals', { p_from: day, p_to: day, p_limit: 200, p_offset: 0 }),
      ]);
      if (!dayGuard.isCurrent(k)) return;
      const total = s.revenue + sv.profit;
      const profit = s.profit + sv.profit;
      mount(dayBand, kpiBand([
        { label: 'کۆی فرۆشتنی ئەم ڕۆژە (کاڵا + خزمەتگوزاری)', value: total, unit: 'دینار', sub: `کاڵا ${money(s.revenue)} + خزمەتگوزاری ${money(sv.profit)} (خزمەتگوزاری تەنها قازانج تۆمار دەکات)` },
        { label: 'کۆی قازانج', value: profit, unit: 'دینار', tone: profit < 0 ? 'bad' : 'good' },
        { label: 'قازانجی کاڵا', value: s.profit, unit: 'دینار', sub: `ڕێژەی قازانج ${s.revenue > 0 ? Math.round((s.profit / s.revenue) * 100) : 0}%` },
        { label: 'قازانجی خزمەتگوزاری', value: sv.profit, unit: 'دینار', sub: `چاکردنەوە ${money(sv.repair_profit)} · کارت ${money(sv.card_profit)}` },
        { label: 'پارەی ڕاکێشراو', value: wd.total, unit: 'دینار', tone: wd.total ? 'bad' : undefined, sub: `${money(wd.count)} جار` },
        { label: 'ماوە دوای ڕاکێشان', value: total - wd.total, unit: 'دینار' },
      ], { className: 'kpi--today' }));
      mount(dayBand2, kpiBand([
        { label: 'ژمارەی وەسڵ', value: s.receipts },
        { label: 'دانەی فرۆشراو', value: s.items },
        { label: 'داشکاندن', value: s.discount, unit: 'دینار' },
        { label: 'گەڕاوە', value: s.refunds, unit: 'دینار', sub: `${money(s.refund_count)} جار` },
        { label: 'کاڵا بێ فرۆشتن', value: unsold.filter((p) => p.stock > 0).length, sub: 'ئەوانەی لە کۆگادا ماون' },
      ], { className: 'kpi--compact' }));

      const sold = prods.filter((p) => p.net_qty !== 0 || p.revenue !== 0);
      soldTable.update(sold);
      const idle = unsold.filter((p) => p.stock > 0);
      unsoldTable.update(idle.slice(0, UNSOLD_LIMIT));
      mount(soldPanel, panel({ title: 'چی فرۆشرا', sub: `${money(sold.length)} جۆر کاڵا`, body: soldTable.el }));
      mount(unsoldPanel, panel({
        title: 'چی نەفرۆشرا', sub: idle.length > UNSOLD_LIMIT ? `${money(idle.length)} جۆر — زۆرترین ${UNSOLD_LIMIT} پیشان دراوە` : `${money(idle.length)} جۆر کاڵا کە لە کۆگا ماون`,
        body: unsoldTable.el,
      }));

      const svRows = sv.rows.filter((r) => !r.voided);
      if (svRows.length) {
        const t = ledger({ columns: [
          { key: 'created_at', label: 'کات', render: (r) => fmtTime(r.created_at) },
          { key: 'kind', label: 'جۆر', render: (r) => badge(r.kind === 'repair' ? 'چاکردنەوە' : 'کارت', r.kind === 'repair' ? 'warn' : 'neutral') },
          { key: 'title', label: 'تێبینی', render: (r) => r.title || '—', className: 'col-opt' },
          { key: 'profit', label: 'قازانج', num: true },
        ], cards: true, dense: true, rowKey: (r) => r.id });
        t.update(svRows);
        mount(svcPanel, panel({ title: 'خزمەتگوزارییەکانی ئەم ڕۆژە', sub: `${money(svRows.length)} تۆمار`, body: t.el }));
      } else mount(svcPanel, '');

      const wRows = wd.rows.filter((r) => !r.voided);
      if (wRows.length) {
        const t = ledger({ columns: [
          { key: 'created_at', label: 'کات', render: (r) => fmtTime(r.created_at) },
          { key: 'reason', label: 'هۆکار', render: (r) => r.reason || '—' },
          { key: 'note', label: 'تێبینی', render: (r) => r.note || '—', className: 'col-opt' },
          { key: 'amount', label: 'بڕ', num: true, render: (r) => h('span', { class: 'num num--neg' }, money(r.amount)) },
        ], cards: true, dense: true, rowKey: (r) => r.id });
        t.update(wRows);
        mount(wdPanel, panel({ title: 'ڕاکێشانەکانی ئەم ڕۆژە', sub: `${money(wRows.length)} جار`, body: t.el }));
      } else mount(wdPanel, '');
    } catch (e) {
      if (dayGuard.isCurrent(k)) toast(errText(e), 'err');
    }
  }

  function pickDay(key) {
    const s = weekStart(key);
    const changed = s !== start;
    day = key;
    start = s;
    picker.value = key;
    if (changed) {
      loadWeek().then(() => { loadDay(); });
    } else {
      segHolder.querySelector('.seg') && segHolder.firstChild.set && segHolder.firstChild.set(day);
      loadDay();
    }
  }
  function shiftWeek(n) {
    const ns = addDays(start, n);
    if (ns > today) return;
    // keep the same weekday in the new week (or the last day that already happened)
    const idx = Math.round((new Date(`${day}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
    let nd = addDays(ns, idx);
    if (nd > today) nd = today;
    pickDay(nd);
  }

  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'ڕاپۆرتی هەفتانە', sub: 'شەممە تا هەینی — کۆی فرۆشتن، قازانج، ڕاکێشان، چی فرۆشرا و چی نەفرۆشرا' }),
    nav, weekBand,
    h('div', { class: 'stack' },
      panel({ title: 'ڕۆژەکانی هەفتە', sub: 'کلیک لەسەر ڕۆژێک بکە بۆ بینینی وردەکارییەکانی', body: weekTable.el }),
      chart.el,
      h('section', { class: 'wk__day' },
        h('div', { class: 'wk__dayhead' }, dayTitle, segHolder),
        dayBand, dayBand2,
        h('div', { class: 'grid-2' }, soldPanel, unsoldPanel),
        svcPanel, wdPanel))));
  await loadWeek();
  await loadDay();
}
