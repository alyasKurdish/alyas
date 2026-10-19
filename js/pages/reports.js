// Reports: what sold, what did NOT sell, day by day, by cashier, and returns.
import * as api from '../api.js';
import { h, button, toast, ledger, badge, loading, mount, checkbox } from '../ui.js';
import { money, pct, margin, fmtDateNum, fmtTime, weekdayOf, relativeDay, daysSince, downloadCSV } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, latest } from '../pagekit.js';
import { rangeControl } from '../range.js';
import { openSaleDialog } from '../receipt.js';

const TABS = [
  { id: 'sold', label: 'فرۆشراو' },
  { id: 'unsold', label: 'نەفرۆشراو' },
  { id: 'daily', label: 'ڕۆژانە' },
  { id: 'services', label: 'خزمەتگوزاری' },
  { id: 'cashiers', label: 'کاشێرەکان' },
  { id: 'returns', label: 'گەڕاوەکان' },
];

export default async function reports(root, ctx) {
  const guard = latest();
  let tab = TABS.some((t) => t.id === (ctx.sub && ctx.sub[0])) ? ctx.sub[0] : 'sold';
  let onlyInStock = true;
  let data = null; // last loaded data of the current tab, for CSV

  const range = rangeControl({ initial: 'month', onChange: () => load() });
  const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map((t) => h('button', { class: `tabs__btn${t.id === tab ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(t.id === tab), dataset: { tab: t.id }, onclick: () => setTab(t.id) }, t.label)));
  const body = h('div', { class: 'stack' }, loading());
  const csvBtn = button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: () => exportCSV() });

  function setTab(id) {
    tab = id;
    tabs.querySelectorAll('.tabs__btn').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    history.replaceState(null, '', `#/reports/${id}`);
    load();
  }

  const marginCell = (profit, revenue) => {
    const m = margin(profit, revenue);
    return m === null ? '—' : pct(m, 1);
  };
  const profitCell = (p) => h('strong', { class: `num ${p < 0 ? 'num--neg' : 'num--good'}` }, money(p));

  /* ---------------- one builder per tab ---------------- */
  const builders = {
    async sold(r) {
      const [sum, rows] = await Promise.all([
        api.rpc('report_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('report_products', { p_from: r.from, p_to: r.to }),
      ]);
      const t = ledger({
        cards: true,
        rowKey: (p) => p.id,
        defaultSort: { key: 'revenue', dir: 'desc' },
        empty: 'هیچ کاڵایەک نەفرۆشراوە لەم ماوەیەدا.',
        columns: [
          { key: 'name', label: 'کاڵا', sort: true, render: (p) => h('div', { class: 'pname' }, h('strong', { class: 'pname__n' }, p.name), h('span', { class: 'sub' }, p.category || ' ')) },
          { key: 'qty_sold', label: 'دانەی فرۆشراو', num: true, sort: true },
          { key: 'qty_returned', label: 'گەڕاو', num: true, sort: true, className: 'col-opt', render: (p) => (p.qty_returned ? h('span', { class: 'num num--neg' }, `−${money(p.qty_returned)}`) : '—') },
          { key: 'revenue', label: 'فرۆشتنی خاڵیص', num: true, sort: true },
          { key: 'cost', label: 'تێچوو', num: true, sort: true, className: 'col-opt' },
          { key: 'profit', label: 'قازانج', num: true, sort: true, render: (p) => profitCell(p.profit) },
          { key: 'margin', label: 'ڕێژە', num: true, sort: true, value: (p) => margin(p.profit, p.revenue), render: (p) => marginCell(p.profit, p.revenue), className: 'col-opt' },
          { key: 'stock', label: 'ماوە لە کۆگا', num: true, sort: true, className: 'col-opt' },
        ],
        footer: (d) => ({ name: `${money(d.length)} کاڵا`, qty_sold: sum_(d, 'qty_sold'), revenue: sum_(d, 'revenue'), cost: sum_(d, 'cost'), profit: sum_(d, 'profit'), margin: marginCell(sum_(d, 'profit'), sum_(d, 'revenue')) }),
      });
      t.update(rows);
      data = {
        name: `sold_${r.from}_${r.to}`,
        headers: ['کاڵا', 'پۆل', 'دانەی فرۆشراو', 'گەڕاو', 'فرۆشتنی خاڵیص', 'تێچوو', 'قازانج', 'ڕێژەی قازانج %', 'ماوە لە کۆگا'],
        rows: rows.map((p) => [p.name, p.category || '', p.qty_sold, p.qty_returned, p.revenue, p.cost, p.profit, margin(p.profit, p.revenue) === null ? '' : margin(p.profit, p.revenue).toFixed(1), p.stock]),
      };
      return [
        kpiBand([
          { label: 'فرۆشتنی خاڵیص', value: sum.revenue, unit: 'دینار', sub: 'دوای داشکان و گەڕاندنەوە' },
          { label: 'تێچووی کاڵای فرۆشراو', value: sum.cost, unit: 'دینار' },
          { label: 'قازانج', value: sum.profit, unit: 'دینار', tone: sum.profit < 0 ? 'bad' : 'good', sub: `ڕێژە ${marginCell(sum.profit, sum.revenue)}` },
          { label: 'وەسڵ', value: sum.receipts, sub: `${money(sum.items)} دانە` },
        ]),
        t.el,
      ];
    },

    async unsold(r) {
      const rows = await api.rpc('report_unsold', { p_from: r.from, p_to: r.to });
      const shown = onlyInStock ? rows.filter((p) => p.stock > 0) : rows;
      const stuck = rows.filter((p) => p.stock > 0);
      const capital = stuck.reduce((a, p) => a + p.stock_value, 0);
      const sinceOf = (p) => daysSince(p.last_sold_at || p.created_at);
      const t = ledger({
        cards: true,
        rowKey: (p) => p.id,
        defaultSort: { key: 'stock_value', dir: 'desc' },
        empty: 'هەموو کاڵاکان لەم ماوەیەدا فرۆشراون.',
        columns: [
          { key: 'name', label: 'کاڵا', sort: true, render: (p) => h('div', { class: 'pname' }, h('strong', { class: 'pname__n' }, p.name), h('span', { class: 'sub' }, p.category || ' ')) },
          { key: 'stock', label: 'ماوە', num: true, sort: true, render: (p) => (p.stock === 0 ? badge('نەماوە', 'neutral') : h('span', { class: 'num' }, money(p.stock))) },
          { key: 'stock_value', label: 'سەرمایەی گیراو', num: true, sort: true },
          { key: 'price', label: 'نرخی فرۆشتن', num: true, sort: true, className: 'col-opt' },
          { key: 'last_sold_at', label: 'دوایین فرۆشتن', sort: true, value: (p) => (p.last_sold_at ? Date.parse(p.last_sold_at) : 0), render: (p) => (p.last_sold_at ? relativeDay(p.last_sold_at) : h('span', { class: 'muted' }, 'هەرگیز')) },
          { key: 'last_purchase_at', label: 'دوایین هاتن', sort: true, className: 'col-opt', value: (p) => (p.last_purchase_at ? Date.parse(p.last_purchase_at) : 0), render: (p) => (p.last_purchase_at ? relativeDay(p.last_purchase_at) : '—') },
          { key: 'since', label: 'ماوەی نەفرۆشین', num: true, sort: true, value: sinceOf, render: (p) => h('span', { class: 'num' }, `${money(sinceOf(p))} ڕۆژ`) },
        ],
        footer: (d) => ({ name: `${money(d.length)} کاڵا`, stock: sum_(d, 'stock'), stock_value: sum_(d, 'stock_value') }),
      });
      t.update(shown);
      data = {
        name: `unsold_${r.from}_${r.to}`,
        headers: ['کاڵا', 'پۆل', 'ماوە', 'سەرمایەی گیراو', 'نرخی فرۆشتن', 'دوایین فرۆشتن', 'دوایین هاتن', 'ماوەی نەفرۆشین (ڕۆژ)'],
        rows: shown.map((p) => [p.name, p.category || '', p.stock, p.stock_value, p.price, p.last_sold_at ? fmtDateNum(p.last_sold_at) : 'هەرگیز', p.last_purchase_at ? fmtDateNum(p.last_purchase_at) : '', sinceOf(p)]),
      };
      const only = checkbox({ label: 'تەنها ئەو کاڵایانەی لە کۆگا ماون', checked: onlyInStock, onChange: (v) => { onlyInStock = v; load(); } });
      return [
        kpiBand([
          { label: 'کاڵای نەفرۆشراوی ماو', value: stuck.length, tone: stuck.length ? 'warn' : undefined, sub: 'کاڵایەک لە کۆگایە و لەم ماوەیەدا نەفرۆشراوە' },
          { label: 'سەرمایەی گیراو', value: capital, unit: 'دینار', tone: capital ? 'warn' : undefined, sub: 'بە نرخی کڕین' },
        ]),
        h('div', { class: 'toolbar' }, only),
        t.el,
      ];
    },

    async services(r) {
      const [sum, sv, rows] = await Promise.all([
        api.rpc('report_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('service_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('report_daily', { p_from: r.from, p_to: r.to }),
      ]);
      const svDay = new Map((sv.daily || []).map((x) => [x.day, x]));
      const list = rows.map((d) => ({ day: d.day, goods: d.profit, repair: svDay.get(d.day)?.repair || 0, card: svDay.get(d.day)?.card || 0 }))
        .map((d) => ({ ...d, total: d.goods + d.repair + d.card }));
      const t = ledger({
        cards: true,
        rowKey: (d) => d.day,
        defaultSort: { key: 'day', dir: 'desc' },
        empty: 'هیچ داتایەک نییە.',
        columns: [
          { key: 'day', label: 'ڕۆژ', sort: true, render: (d) => h('span', null, fmtDateNum(d.day), h('span', { class: 'sub' }, weekdayOf(d.day))) },
          { key: 'goods', label: 'قازانجی کاڵا', num: true, sort: true },
          { key: 'repair', label: 'چاکردنەوە', num: true, sort: true },
          { key: 'card', label: 'کارت', num: true, sort: true },
          { key: 'total', label: 'کۆی گشتی', num: true, sort: true, render: (d) => profitCell(d.total) },
        ],
        footer: (d) => ({ day: `${money(d.length)} ڕۆژ`, goods: sum_(d, 'goods'), repair: sum_(d, 'repair'), card: sum_(d, 'card'), total: sum_(d, 'total') }),
      });
      t.update(list);
      data = {
        name: `profit_split_${r.from}_${r.to}`,
        headers: ['ڕۆژ', 'قازانجی کاڵا', 'قازانجی چاکردنەوە', 'قازانجی کارت', 'کۆی گشتی'],
        rows: list.map((d) => [d.day, d.goods, d.repair, d.card, d.total]),
      };
      return [
        kpiBand([
          { label: 'قازانجی کاڵا', value: sum.profit, unit: 'دینار' },
          { label: 'قازانجی چاکردنەوە', value: sv.repair_profit, unit: 'دینار', sub: `${money(sv.repair_count)} جار` },
          { label: 'قازانجی کارت', value: sv.card_profit, unit: 'دینار', sub: `${money(sv.card_count)} کارت` },
          { label: 'کۆی گشتی قازانج', value: sum.profit + sv.profit, unit: 'دینار', tone: 'good' },
        ]),
        t.el,
      ];
    },

    async daily(r) {
      const [sum, rows] = await Promise.all([
        api.rpc('report_summary', { p_from: r.from, p_to: r.to }),
        api.rpc('report_daily', { p_from: r.from, p_to: r.to }),
      ]);
      const t = ledger({
        cards: true,
        rowKey: (d) => d.day,
        defaultSort: { key: 'day', dir: 'desc' },
        empty: 'هیچ داتایەک نییە.',
        columns: [
          { key: 'day', label: 'ڕۆژ', sort: true, render: (d) => h('span', null, fmtDateNum(d.day), h('span', { class: 'sub' }, weekdayOf(d.day))) },
          { key: 'receipts', label: 'وەسڵ', num: true, sort: true },
          { key: 'items', label: 'دانە', num: true, sort: true, className: 'col-opt' },
          { key: 'sales_net', label: 'فرۆشتن', num: true, sort: true },
          { key: 'refunds', label: 'گەڕاوە', num: true, sort: true, className: 'col-opt', render: (d) => (d.refunds ? h('span', { class: 'num num--neg' }, `−${money(d.refunds)}`) : '—') },
          { key: 'revenue', label: 'خاڵیص', num: true, sort: true },
          { key: 'cost', label: 'تێچوو', num: true, sort: true, className: 'col-opt' },
          { key: 'profit', label: 'قازانج', num: true, sort: true, render: (d) => profitCell(d.profit) },
        ],
        footer: (d) => ({ day: `${money(d.length)} ڕۆژ`, receipts: sum_(d, 'receipts'), items: sum_(d, 'items'), sales_net: sum_(d, 'sales_net'), refunds: sum_(d, 'refunds') ? `−${money(sum_(d, 'refunds'))}` : '—', revenue: sum_(d, 'revenue'), cost: sum_(d, 'cost'), profit: sum_(d, 'profit') }),
      });
      t.update(rows);
      data = {
        name: `daily_${r.from}_${r.to}`,
        headers: ['ڕۆژ', 'وەسڵ', 'دانە', 'فرۆشتن', 'گەڕاوە', 'فرۆشتنی خاڵیص', 'تێچوو', 'قازانج'],
        rows: rows.map((d) => [d.day, d.receipts, d.items, d.sales_net, d.refunds, d.revenue, d.cost, d.profit]),
      };
      const best = [...rows].sort((a, b) => b.profit - a.profit)[0];
      return [
        kpiBand([
          { label: 'فرۆشتنی خاڵیص', value: sum.revenue, unit: 'دینار' },
          { label: 'قازانج', value: sum.profit, unit: 'دینار', tone: sum.profit < 0 ? 'bad' : 'good' },
          { label: 'تێکڕای ڕۆژانە', value: rows.length ? Math.round(sum.revenue / rows.length) : 0, unit: 'دینار', sub: 'فرۆشتن بۆ هەر ڕۆژێک' },
          best && best.profit > 0 ? { label: 'باشترین ڕۆژ', value: fmtDateNum(best.day), sub: `قازانج ${money(best.profit)} دینار` } : null,
        ]),
        t.el,
      ];
    },

    async cashiers(r) {
      const rows = await api.rpc('report_cashiers', { p_from: r.from, p_to: r.to });
      const t = ledger({
        cards: true,
        rowKey: (c) => c.id,
        defaultSort: { key: 'sales_net', dir: 'desc' },
        empty: 'هیچ کاشێرێک فرۆشتنی نەبووە لەم ماوەیەدا.',
        columns: [
          { key: 'name', label: 'کەس', sort: true, render: (c) => h('span', null, h('strong', null, c.name), ' ', badge(c.role === 'admin' ? 'ئادمین' : 'کاشێر', c.role === 'admin' ? 'dark' : 'neutral')) },
          { key: 'receipts', label: 'وەسڵ', num: true, sort: true },
          { key: 'sales_net', label: 'کۆی فرۆشتن', num: true, sort: true },
          { key: 'avg', label: 'تێکڕای وەسڵ', num: true, sort: true, className: 'col-opt', value: (c) => (c.receipts ? Math.round(c.sales_net / c.receipts) : 0) },
          { key: 'discount', label: 'داشکان', num: true, sort: true },
          { key: 'returns', label: 'جاری گەڕاندنەوە', num: true, sort: true, className: 'col-opt' },
          { key: 'refunds', label: 'بڕی گەڕاوە', num: true, sort: true, render: (c) => (c.refunds ? h('span', { class: 'num num--neg' }, `−${money(c.refunds)}`) : '—') },
        ],
        footer: (d) => ({ name: 'کۆ', receipts: sum_(d, 'receipts'), sales_net: sum_(d, 'sales_net'), discount: sum_(d, 'discount'), returns: sum_(d, 'returns'), refunds: sum_(d, 'refunds') ? `−${money(sum_(d, 'refunds'))}` : '—' }),
      });
      t.update(rows);
      data = {
        name: `cashiers_${r.from}_${r.to}`,
        headers: ['کەس', 'ڕۆڵ', 'وەسڵ', 'کۆی فرۆشتن', 'داشکان', 'جاری گەڕاندنەوە', 'بڕی گەڕاوە'],
        rows: rows.map((c) => [c.name, c.role, c.receipts, c.sales_net, c.discount, c.returns, c.refunds]),
      };
      return [h('p', { class: 'muted' }, 'داشکانی زۆر یان گەڕاندنەوەی زۆر لای یەک کەس شایەنی پشکنینە.'), t.el];
    },

    async returns(r) {
      const rows = await api.rpc('list_returns', { p_from: r.from, p_to: r.to });
      const t = ledger({
        cards: true,
        rowKey: (x) => x.id,
        defaultSort: { key: 'created_at', dir: 'desc' },
        onRowClick: (x) => openSaleDialog({ saleId: x.sale_id, settings: ctx.state.settings, role: 'admin', onChange: () => load() }),
        empty: 'هیچ گەڕاندنەوەیەک نییە لەم ماوەیەدا.',
        columns: [
          { key: 'created_at', label: 'کات', sort: true, value: (x) => Date.parse(x.created_at), render: (x) => h('span', null, fmtDateNum(x.created_at), h('span', { class: 'sub' }, fmtTime(x.created_at))) },
          { key: 'sale_id', label: 'وەسڵ', num: true, render: (x) => h('strong', { class: 'num' }, `#${x.sale_id}`) },
          { key: 'product_name', label: 'کاڵا', sort: true, render: (x) => h('strong', null, x.product_name) },
          { key: 'qty', label: 'دانە', num: true, sort: true },
          { key: 'refund', label: 'بڕی گەڕاوە', num: true, sort: true, render: (x) => h('span', { class: 'num num--neg' }, `−${money(x.refund)}`) },
          { key: 'restocked', label: 'کۆگا', render: (x) => (x.restocked ? badge('گەڕایەوە کۆگا', 'ok') : badge('زیان', 'bad')) },
          { key: 'reason', label: 'هۆکار', render: (x) => h('span', { class: 'muted' }, x.reason) },
          { key: 'by', label: 'کەس', className: 'col-opt' },
        ],
        footer: (d) => ({ product_name: `${money(d.length)} گەڕاندنەوە`, qty: sum_(d, 'qty'), refund: `−${money(sum_(d, 'refund'))}` }),
      });
      t.update(rows);
      const loss = rows.filter((x) => !x.restocked).reduce((a, x) => a + x.refund, 0);
      data = {
        name: `returns_${r.from}_${r.to}`,
        headers: ['بەروار', 'کات', 'ژمارەی وەسڵ', 'کاڵا', 'دانە', 'بڕی گەڕاوە', 'گەڕایەوە کۆگا', 'هۆکار', 'کەس'],
        rows: rows.map((x) => [fmtDateNum(x.created_at), fmtTime(x.created_at), x.sale_id, x.product_name, x.qty, x.refund, x.restocked ? 'بەڵێ' : 'نەخێر', x.reason, x.by]),
      };
      return [
        kpiBand([
          { label: 'جاری گەڕاندنەوە', value: rows.length },
          { label: 'کۆی گەڕاو بۆ کڕیار', value: rows.reduce((a, x) => a + x.refund, 0), unit: 'دینار', tone: rows.length ? 'warn' : undefined },
          { label: 'کاڵای نەگەڕاوە کۆگا (زیان)', value: loss, unit: 'دینار', tone: loss ? 'bad' : undefined, sub: 'تێکچوو یان ناگەڕێتەوە' },
        ]),
        t.el,
      ];
    },
  };
  const sum_ = (d, k) => d.reduce((a, x) => a + (x[k] || 0), 0);

  async function load() {
    const k = guard.next();
    body.classList.add('is-stale');
    const r = range.get();
    try {
      const nodes = await builders[tab](r);
      if (!guard.isCurrent(k)) return;
      body.replaceChildren(...nodes);
    } catch (e) {
      if (!guard.isCurrent(k)) return;
      toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) body.classList.remove('is-stale');
    }
  }
  function exportCSV() {
    if (!data) return;
    downloadCSV(`${data.name}.csv`, data.headers, data.rows);
  }

  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'ڕاپۆرتەکان', sub: 'بزانە چی فرۆشراوە، چی نەفرۆشراوە و قازانج لە کوێیە', actions: [csvBtn] }),
    h('div', { class: 'toolbar' }, range.el),
    tabs,
    body));
  await load();
}
