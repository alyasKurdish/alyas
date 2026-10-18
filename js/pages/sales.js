// Receipts. Admin: any period, with cost and profit. Cashier: only his own receipts of today.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, selectBox, searchBox, ledger, badge, numberInput, loading, mount } from '../ui.js';
import { money, fmtDateNum, fmtTime, fmtDay, todayKey, downloadCSV, parseInteger, margin, pct } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, latest } from '../pagekit.js';
import { rangeControl } from '../range.js';
import { openSaleDialog } from '../receipt.js';

const PAGE = 100;

export default async function sales(root, ctx) {
  const { state } = ctx;
  const role = state.profile.role;
  const isAdmin = role === 'admin';
  const guard = latest();

  let rows = [];
  let count = 0;
  let query = '';
  let cashier = '';
  let loadingMore = false;

  const range = isAdmin ? rangeControl({ initial: 'today', onChange: () => reload() }) : null;
  const search = searchBox({ placeholder: 'ژمارەی وەسڵ یان ناوی کاڵا...', onInput: (v) => { query = v.trim(); reload(); } });

  let staffSelect = null;
  if (isAdmin) {
    let staff = [];
    try { staff = await api.rpc('list_staff'); } catch { /* the filter is optional */ }
    staffSelect = selectBox({
      options: [{ value: '', label: 'هەموو کاشێرەکان' }, ...staff.map((s) => ({ value: s.id, label: s.full_name || s.username }))],
      value: '',
      onChange: (v) => { cashier = v; reload(); },
    });
    staffSelect.setAttribute('aria-label', 'کاشێر');
  }

  const costOf = (r) => (r.cost_total === null || r.cost_total === undefined ? null : r.cost_total - (r.cost_back || 0));
  const netOf = (r) => r.total - (r.refunded || 0);
  const profitOf = (r) => (costOf(r) === null ? null : netOf(r) - costOf(r));

  const cols = [
    { key: 'id', label: '#', sort: true, num: true, width: '86px', render: (r) => h('strong', { class: 'num' }, `#${r.id}`) },
    { key: 'created_at', label: 'کات', sort: true, render: (r) => h('span', null, isAdmin ? fmtDateNum(r.created_at) : '', isAdmin ? h('span', { class: 'sub' }, fmtTime(r.created_at)) : fmtTime(r.created_at)) },
    isAdmin ? { key: 'cashier_name', label: 'کاشێر', sort: true } : null,
    { key: 'qty', label: 'دانە', num: true, sort: true, className: 'col-nocard' },
    { key: 'subtotal', label: 'کۆ', num: true, sort: true, className: 'col-opt col-nocard', value: (r) => r.subtotal },
    { key: 'discount', label: 'داشکان', num: true, sort: true, className: 'col-opt col-nocard', render: (r) => (r.discount > 0 ? `−${money(r.discount)}` : '—') },
    { key: 'total', label: 'کۆی وەسڵ', num: true, sort: true, render: (r) => h('strong', { class: 'num' }, money(r.total)) },
    { key: 'refunded', label: 'گەڕاوە', num: true, sort: true, render: (r) => (r.refunded > 0 ? h('span', { class: 'num num--neg' }, `−${money(r.refunded)}`) : '—') },
    isAdmin ? { key: 'cost', label: 'تێچوو', num: true, sort: true, value: costOf, className: 'col-opt col-nocard' } : null,
    isAdmin ? { key: 'profit', label: 'قازانج', num: true, sort: true, value: profitOf, render: (r) => { const p = profitOf(r); return h('strong', { class: `num${p < 0 ? ' num--neg' : ' num--good'}` }, money(p)); } } : null,
    { key: 'status', label: '', render: (r) => (r.refunded > 0 ? badge(r.refunded >= r.total && r.total > 0 ? 'هەموو گەڕاوە' : 'گەڕاوەی هەیە', r.refunded >= r.total && r.total > 0 ? 'bad' : 'warn') : r.note ? h('span', { class: 'muted', title: r.note }, icon('info', 16)) : '') },
  ].filter(Boolean);

  const table = ledger({
    columns: cols,
    cards: true,
    rowKey: (r) => r.id,
    defaultSort: { key: 'created_at', dir: 'desc' },
    empty: isAdmin ? 'هیچ وەسڵێک نەدۆزرایەوە لەم ماوەیەدا.' : 'ئەمڕۆ هێشتا هیچ وەسڵێکت نییە.',
    onRowClick: (r) => open(r.id),
    footer: (data) => {
      if (!isAdmin || rows.length < count) return null;
      const sum = (f) => data.reduce((a, r) => a + (f(r) || 0), 0);
      return { id: `${money(data.length)} وەسڵ`, qty: sum((r) => r.qty), subtotal: sum((r) => r.subtotal), discount: sum((r) => r.discount) ? `−${money(sum((r) => r.discount))}` : '—', total: sum((r) => r.total), refunded: sum((r) => r.refunded) ? `−${money(sum((r) => r.refunded))}` : '—', cost: sum(costOf), profit: sum(profitOf) };
    },
  });
  const moreBtn = button('پیشاندانی زیاتر', { variant: 'ghost', icon: 'chevron', onClick: () => loadMore() });
  const moreRow = h('div', { class: 'more-row' }, moreBtn, h('span', { class: 'muted more-row__info' }));
  moreRow.hidden = true;
  const summary = h('div', { class: 'sales-summary' });

  function open(id) {
    openSaleDialog({ saleId: id, settings: state.settings, role, onChange: () => reload(true) });
  }

  function params(offset) {
    const t = todayKey();
    const r = isAdmin ? range.get() : { from: t, to: t };
    return { p_from: r.from, p_to: r.to, p_cashier: isAdmin && cashier ? cashier : null, p_search: query || null, p_limit: PAGE, p_offset: offset };
  }

  async function reload(keepScroll = false) {
    const k = guard.next();
    wrap.classList.add('is-stale');
    try {
      const res = await api.rpc('list_sales', params(0));
      if (!guard.isCurrent(k)) return;
      rows = res.rows;
      count = res.count;
      paint();
    } catch (e) {
      if (!guard.isCurrent(k)) return;
      toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) wrap.classList.remove('is-stale');
    }
  }
  async function loadMore() {
    if (loadingMore) return;
    loadingMore = true;
    const k = guard.next();
    try {
      await withBusy(moreBtn, async () => {
        const res = await api.rpc('list_sales', params(rows.length));
        if (!guard.isCurrent(k)) return;
        rows = rows.concat(res.rows);
        count = res.count;
        paint();
      });
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      loadingMore = false;
    }
  }

  function paint() {
    table.update(rows);
    moreRow.hidden = rows.length >= count;
    moreRow.querySelector('.more-row__info').textContent = `${money(rows.length)} لە ${money(count)} وەسڵ پیشان دراوە`;
    if (isAdmin) {
      const gross = rows.reduce((a, r) => a + netOf(r), 0);
      const profit = rows.reduce((a, r) => a + (profitOf(r) || 0), 0);
      const complete = rows.length >= count;
      mount(summary, count ? kpiBand([
        { label: 'ژمارەی وەسڵ', value: count },
        { label: complete ? 'فرۆشتنی خاڵیص' : 'فرۆشتنی پیشاندراو', value: gross, unit: 'دینار', sub: 'دوای داشکان و گەڕاندنەوە' },
        { label: complete ? 'قازانج' : 'قازانجی پیشاندراو', value: profit, unit: 'دینار', tone: profit < 0 ? 'bad' : 'good', sub: `ڕێژە ${pct(margin(profit, gross), 1)}` },
      ], { className: 'kpi--compact' }) : '');
    } else {
      const t = rows.reduce((a, r) => a + netOf(r), 0);
      mount(summary, count ? kpiBand([{ label: 'وەسڵەکانم ئەمڕۆ', value: count }, { label: 'کۆی فرۆشتنم ئەمڕۆ', value: t, unit: 'دینار' }], { className: 'kpi--compact' }) : '');
    }
  }

  /* cashier: open any receipt by its number (for a return within the allowed days) */
  let finder = null;
  if (!isAdmin) {
    const numIn = numberInput({ grouped: false, placeholder: 'ژمارەی وەسڵ' });
    numIn.setAttribute('aria-label', 'ژمارەی وەسڵ');
    const go = button('کردنەوە', { variant: 'ghost', icon: 'receipt' });
    const doGo = () => withBusy(go, async () => {
      const id = parseInteger(numIn.value);
      if (!id || id < 1) { toast('ژمارەی وەسڵەکە بنووسە.', 'info'); return; }
      try {
        const s = await api.rpc('get_sale', { p_sale_id: id });
        openSaleDialog({ sale: s, settings: state.settings, role, onChange: () => reload(true) });
      } catch (e) {
        toast(errText(e), 'err');
      }
    });
    go.addEventListener('click', doGo);
    numIn.addEventListener('keydown', (e) => e.key === 'Enter' && doGo());
    finder = h('div', { class: 'finder' }, h('span', { class: 'finder__label' }, 'وەسڵی کۆن (بۆ گەڕاندنەوە)'), numIn, go);
  }

  const exportBtn = isAdmin ? button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: (e) => withBusy(e.currentTarget, exportCSV) }) : null;
  async function exportCSV() {
    try {
      let all = [];
      let off = 0;
      for (let i = 0; i < 40; i++) {
        const res = await api.rpc('list_sales', { ...params(off), p_limit: 500, p_offset: off });
        all = all.concat(res.rows);
        off += res.rows.length;
        if (!res.rows.length || all.length >= res.count) break;
      }
      const r = range.get();
      downloadCSV(`sales_${r.from}_${r.to}.csv`, ['ژمارەی وەسڵ', 'بەروار', 'کات', 'کاشێر', 'دانە', 'کۆ', 'داشکان', 'کۆی وەسڵ', 'گەڕاوە', 'تێچوو', 'قازانج', 'تێبینی'],
        all.map((x) => [x.id, fmtDateNum(x.created_at), fmtTime(x.created_at), x.cashier_name, x.qty, x.subtotal, x.discount, x.total, x.refunded, costOf(x), profitOf(x), x.note || '']));
      toast(`${money(all.length)} وەسڵ ئێکسپۆرت کرا.`);
    } catch (e) {
      toast(errText(e), 'err');
    }
  }

  const wrap = h('div', { class: 'stack' }, loading());
  mount(root, h('div', { class: 'page' },
    pageHead({ title: isAdmin ? 'وەسڵەکان' : 'وەسڵەکانم', sub: isAdmin ? 'هەموو فرۆشتنەکان لەگەڵ تێچوو و قازانجی هەر وەسڵێک' : `تەنها وەسڵەکانی ئەمڕۆی خۆت (${fmtDay(todayKey())})`, actions: [exportBtn] }),
    h('div', { class: 'toolbar' },
      isAdmin ? range.el : null,
      h('div', { class: 'toolbar__grow' }, search),
      staffSelect),
    finder,
    summary,
    wrap));
  await reload();
  wrap.replaceChildren(table.el, moreRow);
}
