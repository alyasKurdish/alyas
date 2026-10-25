// Admin home: today at a glance, then the chosen period — profit, trend, best sellers, what is not selling.
import * as api from '../api.js';
import { h, icon, button, toast, segmented, loading, mount, emptyState, badge } from '../ui.js';
import { money, pct, margin, fmtLongDate, fmtDay, fmtDayShort, todayKey, MONTHS, relativeDay } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, panel, latest, delta } from '../pagekit.js';
import { rangeControl, previousRange, rangeDays, rangeLabel } from '../range.js';
import { columnChart, rankChart } from '../charts.js';
import { openAddStock } from '../productdialogs.js';

const REVENUE = '#12805F';
const PROFIT = '#C98500';
const REPAIR = '#3B6FB6';
const CARD = '#8A4FB0';

function bucketize(daily, days) {
  if (days <= 45) {
    return { gran: 'بە ڕۆژ', cats: daily.map((d) => ({ label: fmtDayShort(d.day), long: fmtLongDate(d.day) })), revenue: daily.map((d) => d.revenue), profit: daily.map((d) => d.profit), repair: daily.map((d) => d.repair || 0), card: daily.map((d) => d.card || 0) };
  }
  const groups = [];
  if (days <= 200) {
    for (let i = 0; i < daily.length; i += 7) groups.push(daily.slice(i, i + 7));
    return {
      gran: 'بە هەفتە',
      cats: groups.map((g) => ({ label: fmtDayShort(g[0].day), long: `${fmtDay(g[0].day)} — ${fmtDay(g[g.length - 1].day)}` })),
      revenue: groups.map((g) => g.reduce((a, d) => a + d.revenue, 0)),
      profit: groups.map((g) => g.reduce((a, d) => a + d.profit, 0)),
      repair: groups.map((g) => g.reduce((a, d) => a + (d.repair || 0), 0)),
      card: groups.map((g) => g.reduce((a, d) => a + (d.card || 0), 0)),
    };
  }
  const map = new Map();
  daily.forEach((d) => {
    const k = d.day.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(d);
  });
  const ks = [...map.keys()];
  return {
    gran: 'بە مانگ',
    cats: ks.map((k) => ({ label: MONTHS[Number(k.slice(5)) - 1], long: `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}` })),
    revenue: ks.map((k) => map.get(k).reduce((a, d) => a + d.revenue, 0)),
    profit: ks.map((k) => map.get(k).reduce((a, d) => a + d.profit, 0)),
    repair: ks.map((k) => map.get(k).reduce((a, d) => a + (d.repair || 0), 0)),
    card: ks.map((k) => map.get(k).reduce((a, d) => a + (d.card || 0), 0)),
  };
}

export default async function dashboard(root, ctx) {
  const { state } = ctx;
  const guard = latest();
  let metric = 'revenue';
  let topRows = [];

  const range = rangeControl({ initial: 'month', onChange: () => load() });
  const todayBand = h('div');
  const heroBox = h('div');
  const content = h('div', { class: 'stack dash__content' });
  const onboarding = h('div');
  const lowBox = h('div', { class: 'dash__low' });

  const daily = columnChart({ title: 'فرۆشتن و قازانج', subtitle: '', unit: 'دینار', empty: 'هیچ فرۆشتنێک نییە لەم ماوەیەدا.' });
  const splitBox = h('div');
  const splitChart = columnChart({ title: 'قازانج بەپێی جۆر', subtitle: '', unit: 'دینار', empty: 'هیچ قازانجێک نییە لەم ماوەیەدا.' });
  const rank = rankChart({ title: 'باشترین کاڵاکان', color: REVENUE, valueLabel: 'فرۆشتن', empty: 'هیچ فرۆشتنێک نییە لەم ماوەیەدا.' });
  const metricSeg = segmented({ label: 'پێوەر', value: 'revenue', options: [{ value: 'revenue', label: 'بە فرۆشتن' }, { value: 'profit', label: 'بە قازانج' }], onChange: (v) => { metric = v; paintRank(); } });
  const attention = h('div', { class: 'dash__attention' });

  function paintRank() {
    const key = metric;
    const rows = [...topRows].filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 8)
      .map((p) => ({ label: p.name, value: p[key], tip: [['دانە', money(p.net_qty)], ['فرۆشتن', `${money(p.revenue)} دینار`], ['قازانج', `${money(p.profit)} دینار`]] }));
    rank.update({
      rows,
      color: key === 'profit' ? PROFIT : REVENUE,
      title: key === 'profit' ? 'زۆرترین قازانج بەپێی کاڵا' : 'زۆرترین فرۆشتن بەپێی کاڵا',
      subtitle: 'دوای لابردنی گەڕاوەکان',
    });
    rank.el.querySelector('.rank')?.style.setProperty('--c', key === 'profit' ? PROFIT : REVENUE);
  }

  /* ---------- today ---------- */
  async function loadToday() {
    const t = todayKey();
    try {
      const [s, sv] = await Promise.all([api.rpc('report_summary', { p_from: t, p_to: t }), api.rpc('service_summary', { p_from: t, p_to: t })]);
      mount(todayBand, h('section', { class: 'today' },
        h('div', { class: 'today__head' }, h('h2', null, 'ئەمڕۆ'), h('span', { class: 'muted' }, fmtLongDate(t))),
        kpiBand([
          { label: 'فرۆشتنی کاڵای ئەمڕۆ', value: s.revenue, unit: 'دینار', sub: `${money(s.receipts)} وەسڵ · ${money(s.items)} دانە` },
          { label: 'قازانجی کاڵای ئەمڕۆ', value: s.profit, unit: 'دینار', tone: s.profit < 0 ? 'bad' : 'good', sub: s.revenue > 0 ? `ڕێژە ${pct(margin(s.profit, s.revenue), 1)}` : 'هێشتا فرۆشتن نییە' },
          { label: 'قازانجی خزمەتگوزاری ئەمڕۆ', value: sv.profit, unit: 'دینار', sub: `چاکردنەوە ${money(sv.repair_profit)} · کارت ${money(sv.card_profit)}` },
          { label: 'کۆی فرۆشتنی ئەمڕۆ', value: s.revenue + sv.profit, unit: 'دینار', sub: 'کاڵا + قازانجی خزمەتگوزاری' },
          { label: 'کۆی قازانجی ئەمڕۆ', value: s.profit + sv.profit, unit: 'دینار', tone: s.profit + sv.profit < 0 ? 'bad' : 'good', sub: 'کاڵا + خزمەتگوزاری' },
          { label: 'سەرمایەی ماوە لە کۆگا', value: s.stock_value, unit: 'دینار', sub: `${money(s.stock_units)} دانە` },
        ], { className: 'kpi--today' })));
      return s;
    } catch (e) {
      mount(todayBand, '');
      throw e;
    }
  }

  /* ---------- selected period ---------- */
  async function load() {
    const k = guard.next();
    const r = range.get();
    const prev = previousRange(r);
    content.classList.add('is-stale');
    try {
      const [cur, before, days, prods, unsold, all, sv, svBefore] = await Promise.all([
        api.rpc('report_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('report_summary', { p_from: prev.from, p_to: prev.to }),
        api.rpc('report_daily', { p_from: r.from, p_to: r.to }),
        api.rpc('report_products', { p_from: r.from, p_to: r.to }),
        api.rpc('report_unsold', { p_from: r.from, p_to: r.to }),
        api.rpc('admin_products'),
        api.rpc('service_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('service_summary', { p_from: prev.from, p_to: prev.to }),
      ]);
      if (!guard.isCurrent(k)) return;
      paintHero(cur, before, r, prev, sv, svBefore);
      const svDay = new Map((sv.daily || []).map((x) => [x.day, x]));
      const merged = days.map((d) => ({ ...d, repair: svDay.get(d.day)?.repair || 0, card: svDay.get(d.day)?.card || 0 }));
      paintSplit(cur, sv, merged, r);
      const b = bucketize(merged, rangeDays(r));
      daily.update({
        title: 'فرۆشتن و قازانج',
        subtitle: `${b.gran} — دوای لابردنی گەڕاوەکان`,
        categories: b.cats,
        series: [{ key: 'revenue', label: 'فرۆشتن', color: REVENUE, values: b.revenue }, { key: 'profit', label: 'قازانج', color: PROFIT, values: b.profit }],
      });
      topRows = prods;
      paintRank();
      paintAttention(all, unsold);
      onboarding.replaceChildren(...(cur.products_active === 0 ? [startCard()] : []));
    } catch (e) {
      if (!guard.isCurrent(k)) return;
      toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) content.classList.remove('is-stale');
    }
  }

  function paintSplit(cur, sv, merged, r) {
    const total = cur.profit + sv.profit;
    const b = bucketize(merged, rangeDays(r));
    const goods = b.profit;
    mount(splitBox, h('section', { class: 'panel panel--chart svc-split' },
      kpiBand([
        { label: 'قازانجی کاڵا', value: cur.profit, unit: 'دینار', tone: cur.profit < 0 ? 'bad' : undefined },
        { label: 'قازانجی چاکردنەوە', value: sv.repair_profit, unit: 'دینار', sub: `${money(sv.repair_count)} جار` },
        { label: 'قازانجی کارت', value: sv.card_profit, unit: 'دینار', sub: `${money(sv.card_count)} کارت` },
        { label: 'کۆی گشتی قازانج', value: total, unit: 'دینار', tone: total < 0 ? 'bad' : 'good', sub: 'کاڵا + چاکردنەوە + کارت' },
      ], { className: 'kpi--compact' }),
      splitChart.el));
    splitChart.update({
      title: 'قازانج بەپێی جۆر',
      subtitle: `${b.gran} — کاڵا، چاکردنەوە، کارت`,
      categories: b.cats,
      series: [{ key: 'goods', label: 'کاڵا', color: PROFIT, values: goods }, { key: 'repair', label: 'چاکردنەوە', color: REPAIR, values: b.repair }, { key: 'card', label: 'کارت', color: CARD, values: b.card }],
    });
  }

  function paintHero(cur, before, r, prev, sv, svBefore) {
    const total = cur.profit + sv.profit;
    const dProfit = delta(total, before.profit + svBefore.profit);
    const dRev = delta(cur.revenue, before.revenue);
    const avg = cur.receipts > 0 ? Math.round(cur.revenue / cur.receipts) : 0;
    const chip = (d) => (d ? h('span', { class: `chip-delta chip-delta--${d.tone}` }, d.text) : null);
    mount(heroBox, h('section', { class: 'hero' },
      h('div', { class: 'hero__main' },
        h('div', { class: 'hero__label' }, 'کۆی قازانج (کاڵا + خزمەتگوزاری)'),
        h('div', { class: 'hero__range' }, r.label),
        h('div', { class: `hero__value${total < 0 ? ' is-neg' : ''}` }, h('span', { class: 'num' }, money(total)), h('span', { class: 'unit' }, ' دینار')),
        h('div', { class: 'hero__meta' }, chip(dProfit), h('span', { class: 'muted', title: rangeLabel(prev) }, 'بەرامبەر ماوەی پێشوو')),
        h('div', { class: 'hero__sub' }, `کاڵا ${money(cur.profit)} + خزمەتگوزاری ${money(sv.profit)} دینار · ڕێژەی قازانجی کاڵا ${pct(margin(cur.profit, cur.revenue), 1)}`)),
      h('div', { class: 'hero__cells' },
        cell('کۆی فرۆشتن (کاڵا + خزمەتگوزاری)', money(cur.revenue + sv.profit), h('span', { class: 'muted' }, 'خزمەتگوزاری تەنها قازانج تۆمار دەکات')),
        cell('فرۆشتنی کاڵا (خاڵیص)', money(cur.revenue), chip(dRev)),
        cell('قازانجی کاڵا', money(cur.profit), h('span', { class: 'muted' }, `ڕێژە ${pct(margin(cur.profit, cur.revenue), 1)}`)),
        cell('قازانجی خزمەتگوزاری', money(sv.profit), h('span', { class: 'muted' }, `چاکردنەوە ${money(sv.repair_profit)} · کارت ${money(sv.card_profit)}`)),
        cell('تێچووی کاڵای فرۆشراو', money(cur.cost)),
        cell('وەسڵ', money(cur.receipts), h('span', { class: 'muted' }, cur.receipts ? `تێکڕا ${money(avg)} دینار` : '')),
        cell('داشکان', money(cur.discount)),
        cell('گەڕاوە', money(cur.refunds), h('span', { class: 'muted' }, cur.refund_count ? `${money(cur.refund_count)} جار` : '')),
        cell('کڕینی کاڵا', money(cur.purchases_spent), h('span', { class: 'muted' }, 'کۆی نرخی هاتنەکان')))));
  }
  const cell = (label, value, extra) => h('div', { class: 'hero__cell' }, h('div', { class: 'hero__cell-label' }, label), h('div', { class: 'hero__cell-value' }, h('span', { class: 'num' }, value), h('span', { class: 'unit' }, ' دینار')), extra || null);

  function paintAttention(all, unsold) {
    const low = all.filter((p) => p.active && p.stock <= (p.min_stock || 0) && (p.min_stock > 0 || p.stock === 0))
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name)).slice(0, 8);
    const lowPanel = panel({
      title: 'پێویستی بە هاتنە',
      sub: 'کاڵاکانی نەماوە یان کەم ماونەتەوە',
      actions: [h('a', { class: 'btn btn--quiet btn--sm', href: '#/products/low' }, 'هەموو')],
      body: low.length ? h('ul', { class: 'alist' }, low.map((p) => h('li', { class: 'alist__row' },
        h('div', { class: 'alist__main' }, h('strong', null, p.name), h('span', { class: 'sub' }, p.category || '')),
        p.stock === 0 ? badge('نەماوە', 'bad') : badge(`${money(p.stock)} ماوە`, 'warn'),
        button('هاتن', { size: 'sm', variant: 'ghost', icon: 'arrivals', onClick: () => openAddStock({ product: p, onSaved: () => load() }) }))))
        : h('div', { class: 'alist__ok' }, icon('check', 20), 'هیچ کاڵایەک کەم نەماوەتەوە.'),
    });
    const stuck = unsold.filter((p) => p.stock > 0).slice(0, 8);
    const stuckTotal = unsold.filter((p) => p.stock > 0).reduce((a, p) => a + p.stock_value, 0);
    const unsoldPanel = panel({
      title: 'نەفرۆشراو لەم ماوەیەدا',
      sub: stuckTotal > 0 ? `${money(unsold.filter((p) => p.stock > 0).length)} کاڵا — ${money(stuckTotal)} دینار سەرمایە لە کۆگا ماوەتەوە` : 'هەموو کاڵاکان فرۆشراون',
      actions: [h('a', { class: 'btn btn--quiet btn--sm', href: '#/reports/unsold' }, 'هەموو')],
      body: stuck.length ? h('ul', { class: 'alist' }, stuck.map((p) => h('li', { class: 'alist__row' },
        h('div', { class: 'alist__main' }, h('strong', null, p.name), h('span', { class: 'sub' }, p.last_sold_at ? `دوایین فرۆشتن: ${relativeDay(p.last_sold_at)}` : 'هەرگیز نەفرۆشراوە')),
        h('span', { class: 'alist__num' }, h('span', { class: 'num' }, money(p.stock_value)), h('span', { class: 'sub' }, `${money(p.stock)} دانە`)))))
        : h('div', { class: 'alist__ok' }, icon('check', 20), 'هەموو کاڵایەکی ماوە لەم ماوەیەدا فرۆشراوە.'),
    });
    mount(lowBox, low.length ? lowPanel : '');
    mount(attention, unsoldPanel);
  }

  function startCard() {
    return panel({
      className: 'start',
      title: 'بۆ دەستپێکردن',
      body: h('ol', { class: 'start__steps' },
        h('li', null, h('strong', null, 'کاڵاکانت زیاد بکە'), h('span', null, 'ناو، نرخی فرۆشتن، ژمارەی ئێستا و کۆی نرخی کڕین.'), h('a', { class: 'btn btn--primary btn--sm', href: '#/products' }, 'بڕۆ بۆ کاڵاکان')),
        h('li', null, h('strong', null, 'کاشێر زیاد بکە'), h('span', null, 'هەژمارێک بۆ ئەو کەسەی دەفرۆشێت؛ تەنها دەتوانێت بفرۆشێت.'), h('a', { class: 'btn btn--ghost btn--sm', href: '#/users' }, 'بڕۆ بۆ بەکارهێنەران')),
        h('li', null, h('strong', null, 'فرۆشتن دەستپێبکە'), h('span', null, 'لە شاشەی فرۆشتن، وەسڵەکان و قازانج خۆکار دەژمێردرێن.'), h('a', { class: 'btn btn--ghost btn--sm', href: '#/pos' }, 'شاشەی فرۆشتن'))),
    });
  }

  mount(root, h('div', { class: 'page dash' },
    pageHead({ title: 'داشبۆرد', sub: `بەخێربێیت ${state.profile.full_name || ''}` }),
    onboarding,
    todayBand,
    lowBox,
    h('div', { class: 'toolbar toolbar--range' }, h('h2', { class: 'toolbar__title' }, 'ماوەی هەڵبژێردراو'), range.el),
    heroBox,
    splitBox,
    content));
  mount(content, h('div', { class: 'panel panel--chart' }, daily.el),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel panel--chart' }, h('div', { class: 'chart-tools' }, metricSeg), rank.el),
      attention));
  mount(heroBox, loading());
  await Promise.all([loadToday().catch((e) => toast(errText(e), 'err')), load()]);
}
