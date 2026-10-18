// Stock: every movement (arrivals, sales, returns, corrections) and a quick way to enter new goods.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, selectBox, ledger, badge, loading, mount, openModal, searchBox, emptyState } from '../ui.js';
import { money, fold, fmtDateNum, fmtTime, downloadCSV } from '../fmt.js';
import { errText, MOVEMENT } from '../i18n.js';
import { pageHead, kpiBand, latest } from '../pagekit.js';
import { rangeControl } from '../range.js';
import { openAddStock, chg, movementTone } from '../productdialogs.js';

const PAGE = 200;

export default async function inventory(root) {
  const guard = latest();
  let rows = [];
  let count = 0;
  let kind = '';
  let productId = '';
  let products = null; // loaded once, used by the filter and by the arrival picker

  const range = rangeControl({ initial: 'month', onChange: () => reload() });
  const kindSel = selectBox({
    options: [{ value: '', label: 'هەموو جۆرەکان' }, ...Object.entries(MOVEMENT).map(([value, label]) => ({ value, label }))],
    value: '',
    onChange: (v) => { kind = v; reload(); },
  });
  kindSel.setAttribute('aria-label', 'جۆری جووڵە');
  const prodSel = selectBox({ options: [{ value: '', label: 'هەموو کاڵاکان' }], value: '', onChange: (v) => { productId = v; reload(); } });
  prodSel.setAttribute('aria-label', 'کاڵا');
  const band = h('div');

  const table = ledger({
    cards: true,
    rowKey: (r) => r.id,
    defaultSort: { key: 'created_at', dir: 'desc' },
    empty: 'هیچ جووڵەیەک نەدۆزرایەوە لەم ماوەیەدا.',
    columns: [
      { key: 'created_at', label: 'کات', sort: true, value: (r) => Date.parse(r.created_at), render: (r) => h('span', null, fmtDateNum(r.created_at), h('span', { class: 'sub' }, fmtTime(r.created_at))) },
      { key: 'product_name', label: 'کاڵا', sort: true, render: (r) => h('strong', { class: 'strong' }, r.product_name) },
      { key: 'kind', label: 'جۆر', render: (r) => badge(MOVEMENT[r.kind] || r.kind, movementTone(r.kind)) },
      { key: 'qty_change', label: 'ژمارە', num: true, sort: true, render: (r) => chg(r.qty_change) },
      { key: 'value_change', label: 'بەها', num: true, sort: true, className: 'col-opt', render: (r) => chg(r.value_change) },
      { key: 'stock_after', label: 'ماوە دوای ئەمە', num: true, className: 'col-opt' },
      { key: 'by', label: 'کەس', className: 'col-opt' },
      { key: 'note', label: 'تێبینی', render: (r) => h('span', { class: 'muted' }, [r.supplier, r.note, r.purchase_voided ? 'هەڵوەشێنراوەتەوە' : ''].filter(Boolean).join(' · ') || '—') },
    ],
  });
  const moreBtn = button('پیشاندانی زیاتر', { variant: 'ghost', icon: 'chevron', onClick: () => loadMore() });
  const moreRow = h('div', { class: 'more-row' }, moreBtn, h('span', { class: 'muted more-row__info' }));
  moreRow.hidden = true;
  const wrap = h('div', { class: 'stack' }, loading());

  const params = (offset) => {
    const r = range.get();
    return { p_from: r.from, p_to: r.to, p_product_id: productId ? Number(productId) : null, p_kind: kind || null, p_limit: PAGE, p_offset: offset };
  };

  async function reload() {
    const k = guard.next();
    wrap.classList.add('is-stale');
    try {
      const r = range.get();
      const [res, sum] = await Promise.all([
        api.rpc('list_movements', params(0)),
        api.rpc('report_summary', { p_from: r.from, p_to: r.to }),
      ]);
      if (!guard.isCurrent(k)) return;
      rows = res.rows;
      count = res.count;
      paintBand(sum);
      paint();
    } catch (e) {
      if (guard.isCurrent(k)) toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) wrap.classList.remove('is-stale');
    }
  }
  async function loadMore() {
    const k = guard.next();
    await withBusy(moreBtn, async () => {
      try {
        const res = await api.rpc('list_movements', params(rows.length));
        if (!guard.isCurrent(k)) return;
        rows = rows.concat(res.rows);
        count = res.count;
        paint();
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
  }
  function paintBand(s) {
    mount(band, kpiBand([
      { label: 'کڕینی کاڵا لەم ماوەیەدا', value: s.purchases_spent, unit: 'دینار', sub: 'کۆی نرخی هاتنەکان' },
      { label: 'سەرمایەی ئێستا لە کۆگا', value: s.stock_value, unit: 'دینار', sub: `${money(s.stock_units)} دانە` },
      { label: 'کاڵای نەماوە', value: s.out_of_stock, tone: s.out_of_stock ? 'bad' : undefined },
      { label: 'کاڵای کەم', value: s.low_stock, tone: s.low_stock ? 'warn' : undefined },
    ]));
  }
  function paint() {
    table.update(rows);
    moreRow.hidden = rows.length >= count;
    moreRow.querySelector('.more-row__info').textContent = `${money(rows.length)} لە ${money(count)} جووڵە`;
  }

  async function ensureProducts() {
    if (products) return products;
    products = await api.rpc('admin_products');
    products.forEach((p) => { p._hay = fold(`${p.name} ${p.code || ''} ${p.category || ''}`); });
    const cur = prodSel.value;
    prodSel.replaceChildren(...[{ value: '', label: 'هەموو کاڵاکان' }, ...[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: String(p.id), label: p.name }))]
      .map((o) => h('option', { value: o.value, selected: o.value === cur }, o.label)));
    return products;
  }

  /* ---------- goods arrival: pick a product, enter qty and total cost, repeat ---------- */
  async function openArrival() {
    let list;
    try {
      products = null;
      list = await ensureProducts();
    } catch (e) {
      toast(errText(e), 'err');
      return;
    }
    const results = h('ul', { class: 'picklist' });
    const search = searchBox({ placeholder: 'ناو یان بارکۆدی کاڵا...', autofocus: true, delay: 80, onInput: () => show() });
    const input = search.input;
    const picked = [];
    function show() {
      const q = fold(input.value);
      const found = list.filter((p) => p.active && (!q || p._hay.includes(q))).slice(0, 30);
      results.replaceChildren(...(found.length ? found.map((p) => h('li', null, h('button', { class: 'pick', type: 'button', onclick: () => choose(p) },
        h('span', { class: 'pick__name' }, h('strong', null, p.name), h('span', { class: 'sub' }, [p.category, p.code].filter(Boolean).join(' · ') || ' ')),
        h('span', { class: 'pick__meta' }, h('span', { class: 'num' }, money(p.stock)), h('span', { class: 'sub' }, 'ماوە'))))) : [h('li', { class: 'picklist__none' }, 'هیچ کاڵایەک نەدۆزرایەوە.')]));
    }
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = input.value.trim().toLowerCase();
      const exact = list.find((p) => p.code && p.code.toLowerCase() === q);
      const only = list.filter((p) => p.active && fold(input.value) && p._hay.includes(fold(input.value)));
      const hit = exact || (only.length === 1 ? only[0] : null);
      if (hit) choose(hit);
    });
    function choose(p) {
      openAddStock({ product: p, onSaved: (fresh) => {
        Object.assign(p, fresh);
        picked.push(p.name);
        input.value = '';
        show();
        input.focus();
        reload();
      } });
    }
    const m = openModal({
      title: 'هاتنی کاڵا',
      size: 'md',
      content: [
        h('p', { class: 'muted' }, 'کاڵایەک هەڵبژێرە، ژمارەی هاتوو و کۆی نرخی کڕین بنووسە. دەتوانیت دوای هەر کاڵایەک کاڵایەکی تر هەڵبژێریت.'),
        search,
        results,
      ],
      footer: [button('تەواو', { variant: 'primary', onClick: () => m.close() })],
    });
    show();
  }

  const exportBtn = button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: (e) => withBusy(e.currentTarget, async () => {
    try {
      let all = [];
      for (let off = 0; off < 20000; off += 1000) {
        const res = await api.rpc('list_movements', { ...params(off), p_limit: 1000, p_offset: off });
        all = all.concat(res.rows);
        if (all.length >= res.count || !res.rows.length) break;
      }
      const r = range.get();
      downloadCSV(`stock_${r.from}_${r.to}.csv`, ['بەروار', 'کات', 'کاڵا', 'جۆر', 'ژمارە', 'بەها', 'ماوە دوای ئەمە', 'کەس', 'دابینکەر', 'تێبینی'],
        all.map((x) => [fmtDateNum(x.created_at), fmtTime(x.created_at), x.product_name, MOVEMENT[x.kind] || x.kind, x.qty_change, x.value_change, x.stock_after, x.by || '', x.supplier || '', x.note || '']));
      toast(`${money(all.length)} جووڵە ئێکسپۆرت کرا.`);
    } catch (err) {
      toast(errText(err), 'err');
    }
  }) });
  const arriveBtn = button('هاتنی کاڵا', { icon: 'arrivals', onClick: openArrival });

  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'کۆگا', sub: 'هەموو جووڵەکانی کۆگا: هاتن، فرۆشتن، گەڕاندنەوە و ڕاستکردنەوە', actions: [exportBtn, arriveBtn] }),
    band,
    h('div', { class: 'toolbar' }, range.el, h('div', { class: 'toolbar__spacer' }), prodSel, kindSel),
    wrap));
  ensureProducts().catch(() => {});
  await reload();
  wrap.replaceChildren(table.el, moreRow);
}
