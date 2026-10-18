// Products: prices, stock, purchase cost, and every action on one product.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, selectBox, searchBox, segmented, ledger, badge, loading, mount, openMenu, confirmDialog, emptyState } from '../ui.js';
import { money, fold, pct, margin, relativeDay, daysSince, downloadCSV, fmtDateNum } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand } from '../pagekit.js';
import { openProductForm, openAddStock, openAdjust, openHistory } from '../productdialogs.js';

const collator = new Intl.Collator(['ckb', 'ar', 'en'], { numeric: true, sensitivity: 'base' });
const STALE_DAYS = 30;

export default async function products(root, ctx = {}) {
  let list = [];
  let query = '';
  let cat = '';
  let status = ['low', 'out', 'stale', 'hidden'].includes(ctx.sub && ctx.sub[0]) ? ctx.sub[0] : 'all';

  const search = searchBox({ placeholder: 'ناو، بارکۆد یان پۆل...', onInput: (v) => { query = v; paint(); } });
  const catSelect = selectBox({ options: [{ value: '', label: 'هەموو پۆلەکان' }], value: '', onChange: (v) => { cat = v; paint(); } });
  catSelect.setAttribute('aria-label', 'پۆل');
  const statusSeg = segmented({
    label: 'دۆخ',
    value: status,
    options: [
      { value: 'all', label: 'هەمووی' },
      { value: 'low', label: 'کەمە' },
      { value: 'out', label: 'نەماوە' },
      { value: 'stale', label: `نەفرۆشراو (${STALE_DAYS} ڕۆژ)` },
      { value: 'hidden', label: 'شاراوە' },
    ],
    onChange: (v) => { status = v; paint(); },
  });
  const band = h('div');

  const isLow = (p) => p.stock > 0 && p.stock <= p.min_stock;
  const isStale = (p) => p.stock > 0 && p.active && (!p.last_sold_at || daysSince(p.last_sold_at) >= STALE_DAYS);
  const matches = (p) => {
    if (status === 'hidden') { if (p.active) return false; } else if (!p.active) return false;
    if (status === 'low' && !isLow(p)) return false;
    if (status === 'out' && p.stock > 0) return false;
    if (status === 'stale' && !isStale(p)) return false;
    if (cat && p.category !== cat) return false;
    const q = fold(query);
    return !q || p._hay.includes(q);
  };

  const table = ledger({
    cards: true,
    rowKey: (p) => p.id,
    defaultSort: { key: 'name', dir: 'asc' },
    empty: 'هیچ کاڵایەک نەدۆزرایەوە.',
    onRowClick: (p) => edit(p),
    columns: [
      { key: 'name', label: 'کاڵا', sort: true, render: (p) => h('div', { class: 'pname' }, h('strong', { class: 'pname__n' }, p.name), h('span', { class: 'sub' }, [p.category, p.code].filter(Boolean).join(' · ') || ' '), !p.active ? badge('شاراوە', 'neutral') : null) },
      { key: 'price', label: 'نرخی فرۆشتن', num: true, sort: true },
      { key: 'stock', label: 'ماوە', num: true, sort: true, render: (p) => stockCell(p) },
      { key: 'avg_cost', label: 'نرخی کڕین', num: true, sort: true, value: (p) => p.avg_cost, render: (p) => (p.avg_cost === null || p.avg_cost === undefined ? '—' : money(p.avg_cost)) },
      { key: 'margin', label: 'قازانج/دانە', num: true, sort: true, className: 'col-opt', value: (p) => (p.avg_cost === null || p.avg_cost === undefined ? null : p.price - p.avg_cost), render: (p) => {
        if (p.avg_cost === null || p.avg_cost === undefined) return '—';
        const u = p.price - p.avg_cost;
        return h('span', { class: `num ${u < 0 ? 'num--neg' : ''}` }, money(u), h('span', { class: 'sub' }, pct(margin(u, p.price), 0)));
      } },
      { key: 'stock_value', label: 'سەرمایەی ماوە', num: true, sort: true },
      { key: 'last_sold_at', label: 'دوایین فرۆشتن', sort: true, className: 'col-opt', value: (p) => (p.last_sold_at ? Date.parse(p.last_sold_at) : 0), render: (p) => {
        const d = p.last_sold_at ? daysSince(p.last_sold_at) : null;
        return h('span', { class: d === null || d >= STALE_DAYS ? 'muted' : '' }, p.last_sold_at ? relativeDay(p.last_sold_at) : 'هەرگیز نەفرۆشراوە');
      } },
      { key: 'act', label: '', className: 'col-act', render: (p) => rowActions(p) },
    ],
    footer: (data) => ({ name: `${money(data.length)} کاڵا`, stock: data.reduce((a, p) => a + p.stock, 0), stock_value: data.reduce((a, p) => a + p.stock_value, 0) }),
  });

  function stockCell(p) {
    const low = isLow(p);
    return h('span', { class: 'stockcell' }, h('span', { class: 'num' }, money(p.stock)),
      p.stock === 0 ? badge('نەماوە', 'bad') : low ? badge('کەمە', 'warn') : null);
  }

  function rowActions(p) {
    const more = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `زیاتر بۆ ${p.name}`, 'aria-haspopup': 'menu', onclick: (e) => {
      e.stopPropagation();
      openMenu(more, [
        { label: 'دەستکاریکردن', icon: 'edit', onClick: () => edit(p) },
        { label: 'ڕاستکردنەوەی ژمارە', icon: 'stock', onClick: () => openAdjust({ product: p, onSaved: afterChange(p) }) },
        { label: 'مێژوو', icon: 'history', onClick: () => openHistory({ product: p, onChanged: () => paint() }) },
        'sep',
        { label: p.active ? 'شاردنەوە لە فرۆشتن' : 'پیشاندان لە فرۆشتن', icon: p.active ? 'archive' : 'eye', onClick: () => toggleActive(p) },
        { label: 'سڕینەوە', icon: 'trash', danger: true, onClick: () => remove(p) },
      ]);
    } }, icon('more', 20));
    return h('span', { class: 'row-actions' },
      button('هاتن', { size: 'sm', variant: 'ghost', icon: 'arrivals', title: 'هاتنی کاڵای نوێ', onClick: (e) => { e.stopPropagation(); openAddStock({ product: p, onSaved: afterChange(p) }); } }),
      more);
  }

  const afterChange = (p) => (fresh) => {
    if (fresh) Object.assign(p, fresh);
    index(p);
    paint();
  };
  const index = (p) => { p._hay = fold(`${p.name} ${p.code || ''} ${p.category || ''}`); return p; };

  function edit(p) {
    openProductForm({ product: p, categories: categories(), onSaved: (saved) => { Object.assign(p, saved); index(p); refreshCats(); paint(); } });
  }
  async function toggleActive(p) {
    try {
      const fresh = await api.rpc('set_product_active', { p_id: p.id, p_active: !p.active });
      Object.assign(p, fresh);
      toast(p.active ? `«${p.name}» دووبارە لە فرۆشتن پیشان دەدرێت.` : `«${p.name}» لە شاشەی فرۆشتن شاردرایەوە.`);
      paint();
    } catch (e) {
      toast(errText(e), 'err');
    }
  }
  async function remove(p) {
    const ok = await confirmDialog({ title: 'سڕینەوەی کاڵا', message: `«${p.name}» بە یەکجاری دەسڕدرێتەوە. ئەمە تەنها بۆ کاڵایەکە کە هەرگیز نەفرۆشراوە؛ ئەگەر فرۆشراوە، بیشارەوە.`, confirmText: 'بەڵێ، بیسڕەوە', danger: true });
    if (!ok) return;
    try {
      await api.rpc('delete_product', { p_id: p.id });
      list = list.filter((x) => x.id !== p.id);
      toast(`«${p.name}» سڕایەوە.`);
      refreshCats();
      paint();
    } catch (e) {
      toast(errText(e), 'err', 7000);
    }
  }
  const categories = () => [...new Set(list.map((p) => p.category).filter(Boolean))].sort(collator.compare);
  function refreshCats() {
    const cur = cat;
    const cs = categories();
    if (cur && !cs.includes(cur)) cat = '';
    catSelect.replaceChildren(...[{ value: '', label: 'هەموو پۆلەکان' }, ...cs.map((c) => ({ value: c, label: c }))].map((o) => h('option', { value: o.value, selected: o.value === cat }, o.label)));
  }

  function paint() {
    const active = list.filter((p) => p.active);
    const units = active.reduce((a, p) => a + p.stock, 0);
    const capital = active.reduce((a, p) => a + p.stock_value, 0);
    const retail = active.reduce((a, p) => a + p.price * p.stock, 0);
    mount(band, list.length ? kpiBand([
      { label: 'کاڵای چالاک', value: active.length, sub: `${money(active.filter((p) => p.stock === 0).length)} نەماوە · ${money(active.filter(isLow).length)} کەمە` },
      { label: 'دانەی ماوە', value: units },
      { label: 'سەرمایەی ماوە لە کۆگا', value: capital, unit: 'دینار', sub: 'بە نرخی کڕین' },
      { label: 'نرخی فرۆشتنی ئەوەی ماوە', value: retail, unit: 'دینار' },
      { label: 'قازانجی چاوەڕوان', value: retail - capital, unit: 'دینار', tone: retail - capital < 0 ? 'bad' : 'good', sub: 'ئەگەر هەموو بفرۆشرێن' },
    ]) : '');
    if (!list.length) {
      body.replaceChildren(emptyState({
        icon: 'box',
        title: 'هێشتا هیچ کاڵایەکت زیاد نەکردووە',
        text: 'کاڵا زیاد بکە و ژمارەی ئێستای کۆگا لەگەڵ کۆی نرخی کڕینی بنووسە؛ پاشان لە شاشەی فرۆشتن دەردەکەوێت.',
        action: button('زیادکردنی یەکەم کاڵا', { icon: 'plus', onClick: () => addBtn.click() }),
      }));
      return;
    }
    if (!body.contains(table.el)) body.replaceChildren(table.el);
    table.update(list.filter(matches));
  }

  const exportBtn = button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: () => {
    downloadCSV(`products_${new Date().toISOString().slice(0, 10)}.csv`,
      ['ناو', 'بارکۆد', 'پۆل', 'نرخی فرۆشتن', 'ماوە', 'کەمترین ژمارە', 'نرخی کڕینی تێکڕا', 'سەرمایەی ماوە', 'دوایین فرۆشتن', 'دۆخ'],
      list.map((p) => [p.name, p.code || '', p.category || '', p.price, p.stock, p.min_stock, p.avg_cost === null ? '' : p.avg_cost, p.stock_value, p.last_sold_at ? fmtDateNum(p.last_sold_at) : '', p.active ? 'چالاک' : 'شاراوە']));
  } });
  const addBtn = button('کاڵای نوێ', { icon: 'plus', onClick: () => openProductForm({ categories: categories(), onSaved: (saved) => { list.unshift(index(saved)); refreshCats(); paint(); } }) });

  const body = h('div', { class: 'stack' }, loading());
  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'کاڵاکان', sub: 'نرخی فرۆشتن، ژمارەی ماوە و نرخی کڕینی هەر کاڵایەک', actions: [exportBtn, addBtn] }),
    band,
    h('div', { class: 'toolbar' }, h('div', { class: 'toolbar__grow' }, search), catSelect, statusSeg),
    body));

  try {
    list = (await api.rpc('admin_products')).map(index);
  } catch (e) {
    body.replaceChildren(emptyState({ icon: 'alert', title: errText(e), action: button('دووبارە هەوڵبدەرەوە', { icon: 'refresh', onClick: () => location.reload() }) }));
    return;
  }
  refreshCats();
  paint();
}
