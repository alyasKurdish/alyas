// Services: phone repairs and phone cards. Only the shop's own profit is recorded (not the part cost / card face value).
// Cashier: add entries, sees his own entries of today. Admin: any period, filters, void, CSV.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, selectBox, segmented, ledger, badge, numberInput, textInput, field, confirmDialog, openModal, textArea, loading, mount } from '../ui.js';
import { money, fmtDateNum, fmtTime, fmtDay, todayKey, downloadCSV, uuid } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, latest } from '../pagekit.js';
import { rangeControl } from '../range.js';

const KIND = { repair: 'چاکردنەوە', card: 'کارت' };
const QUICK = { card: [350, 450], repair: [] };
const PAGE = 200;

export default async function services(root, ctx) {
  const { state } = ctx;
  const isAdmin = state.profile.role === 'admin';
  const guard = latest();

  let kind = 'repair';
  let rows = [];
  let totals = null;
  let kindFilter = '';
  let cashier = '';
  let pendingId = uuid(); // one id per entry, so a retry after a network error never records it twice

  const range = isAdmin ? rangeControl({ initial: 'today', onChange: () => reload() }) : null;

  /* ---------- add form ---------- */
  const amount = numberInput({ placeholder: 'قازانجی دووکان' });
  amount.setAttribute('aria-label', 'قازانجی دووکان');
  const title = textInput({ placeholder: 'تێبینی (ئارەزوومەندانە)', maxlength: 120 });
  title.setAttribute('aria-label', 'تێبینی');
  const quick = h('div', { class: 'svc-quick' });
  const hint = h('div', { class: 'field__hint' });
  const save = button('تۆمارکردن', { icon: 'check', onClick: () => submit(save) });
  const kindSeg = segmented({
    label: 'جۆر', value: kind,
    options: [{ value: 'repair', label: KIND.repair }, { value: 'card', label: KIND.card }],
    onChange: (v) => { kind = v; paintForm(); amount.focus(); },
  });

  function paintForm() {
    quick.replaceChildren(...QUICK[kind].map((n) => button(money(n), { variant: 'ghost', className: 'svc-quick__btn', onClick: () => quickAdd(n) })));
    quick.hidden = !QUICK[kind].length;
    title.placeholder = kind === 'repair' ? 'چی چاک کرایەوە؟ (ئارەزوومەندانە)' : 'جۆری کارت (ئارەزوومەندانە)';
    hint.textContent = kind === 'repair'
      ? 'تەنها قازانجی دەستی خۆت بنووسە (وەک ٥٬٠٠٠)، نەک نرخی پارچەکە.'
      : 'تەنها قازانجی کارتەکە بنووسە (وەک ٣٥٠ یان ٤٥٠)، نەک نرخی کارتەکە. هەر کڕیارێک تۆمارێکی جیاوازە.';
  }

  async function add(k, n, note) {
    const id = pendingId;
    await api.rpc('add_service', { p_kind: k, p_profit: n, p_title: note || null, p_client_id: id });
    pendingId = uuid();
    toast(`${KIND[k]} تۆمار کرا: ${money(n)} دینار`);
    await reload();
  }
  async function submit(btn) {
    const n = amount.getValue();
    if (!n || n < 1) { toast('قازانج بنووسە.', 'info'); amount.focus(); return; }
    await withBusy(btn, async () => {
      try {
        await add(kind, n, title.value);
        amount.setValue(null);
        title.value = '';
        amount.focus();
      } catch (e) { toast(errText(e), 'err'); }
    });
  }
  async function quickAdd(n) {
    try { await add(kind, n, title.value); title.value = ''; } catch (e) { toast(errText(e), 'err'); }
  }
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(save); });

  const form = h('section', { class: 'panel svc-form' },
    h('div', { class: 'svc-form__row' }, kindSeg),
    quick,
    h('div', { class: 'svc-form__row svc-form__row--in' }, field('قازانج (دینار)', amount, { hint: null }), field('تێبینی', title), save),
    hint);

  /* ---------- list ---------- */
  const cols = [
    { key: 'created_at', label: 'کات', sort: true, render: (r) => h('span', null, isAdmin ? fmtDateNum(r.created_at) : fmtTime(r.created_at), isAdmin ? h('span', { class: 'sub' }, fmtTime(r.created_at)) : null) },
    { key: 'kind', label: 'جۆر', sort: true, render: (r) => badge(KIND[r.kind], r.kind === 'repair' ? 'warn' : 'neutral') },
    { key: 'title', label: 'تێبینی', render: (r) => r.title || '—', className: 'col-opt' },
    isAdmin ? { key: 'cashier_name', label: 'کاشێر', sort: true } : null,
    { key: 'profit', label: 'قازانج', num: true, sort: true, render: (r) => h('strong', { class: `num${r.voided ? ' num--void' : ' num--good'}` }, money(r.profit)) },
    { key: 'st', label: '', render: (r) => (r.voided ? badge('هەڵوەشێنراوە', 'bad') : (isAdmin ? button('', { variant: 'quiet', size: 'sm', icon: 'trash', title: 'هەڵوەشاندنەوە', onClick: () => voidIt(r) }) : '')) },
  ].filter(Boolean);
  const table = ledger({
    columns: cols, cards: true, rowKey: (r) => r.id,
    defaultSort: { key: 'created_at', dir: 'desc' },
    empty: isAdmin ? 'هیچ تۆمارێک نەدۆزرایەوە لەم ماوەیەدا.' : 'ئەمڕۆ هێشتا هیچت تۆمار نەکردووە.',
  });
  const summary = h('div', { class: 'sales-summary' });

  async function voidIt(r) {
    const reason = textArea({ rows: 2, placeholder: 'هۆکار (ئارەزوومەندانە)' });
    const ok = await new Promise((resolve) => {
      let a = false;
      const m = openModal({
        title: 'هەڵوەشاندنەوەی تۆمار', size: 'sm',
        content: h('div', null, h('p', { class: 'modal__text' }, `${KIND[r.kind]} — ${money(r.profit)} دینار هەڵبوەشێنرێتەوە؟ لە قازانج دەرەچێت.`), reason),
        footer: [h('button', { class: 'btn btn--danger', type: 'button', onclick: () => { a = true; m.close(); } }, 'هەڵیبوەشێنەرەوە'), h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => m.close() }, 'نەخێر')],
        onClose: () => resolve(a),
      });
    });
    if (!ok) return;
    try {
      await api.rpc('void_service', { p_id: r.id, p_reason: reason.value.trim() || null });
      toast('هەڵوەشێنرایەوە.');
      await reload();
    } catch (e) { toast(errText(e), 'err'); }
  }

  function params(offset = 0, limit = PAGE) {
    const t = todayKey();
    const r = isAdmin ? range.get() : { from: t, to: t };
    return { p_from: r.from, p_to: r.to, p_kind: isAdmin && kindFilter ? kindFilter : null, p_cashier: isAdmin && cashier ? cashier : null, p_limit: limit, p_offset: offset };
  }
  async function reload() {
    const k = guard.next();
    wrap.classList.add('is-stale');
    try {
      const res = await api.rpc('list_services', params());
      if (!guard.isCurrent(k)) return;
      rows = res.rows;
      totals = res;
      paint();
    } catch (e) {
      if (guard.isCurrent(k)) toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) wrap.classList.remove('is-stale');
    }
  }
  function paint() {
    table.update(rows);
    const t = totals;
    mount(summary, t && t.count ? kpiBand([
      { label: isAdmin ? 'ژمارەی تۆمار' : 'تۆمارەکانم ئەمڕۆ', value: t.active_count },
      { label: 'قازانجی چاکردنەوە', value: t.repair_profit, unit: 'دینار', sub: `${money(t.repair_count)} جار` },
      { label: 'قازانجی کارت', value: t.card_profit, unit: 'دینار', sub: `${money(t.card_count)} کارت` },
      { label: 'کۆی قازانجی خزمەتگوزاری', value: t.profit, unit: 'دینار', tone: 'good' },
    ], { className: 'kpi--compact' }) : '');
  }

  /* ---------- admin: filters + CSV ---------- */
  let filters = null;
  let exportBtn = null;
  if (isAdmin) {
    let staff = [];
    try { staff = await api.rpc('list_staff'); } catch { /* optional filter */ }
    const ks = selectBox({ options: [{ value: '', label: 'هەموو جۆرەکان' }, { value: 'repair', label: KIND.repair }, { value: 'card', label: KIND.card }], value: '', onChange: (v) => { kindFilter = v; reload(); } });
    ks.setAttribute('aria-label', 'جۆر');
    const cs = selectBox({ options: [{ value: '', label: 'هەموو کاشێرەکان' }, ...staff.map((s) => ({ value: s.id, label: s.full_name || s.username }))], value: '', onChange: (v) => { cashier = v; reload(); } });
    cs.setAttribute('aria-label', 'کاشێر');
    filters = h('div', { class: 'toolbar' }, range.el, ks, cs);
    exportBtn = button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: (e) => withBusy(e.currentTarget, async () => {
      try {
        const res = await api.rpc('list_services', params(0, 5000));
        const r = range.get();
        downloadCSV(`services_${r.from}_${r.to}.csv`, ['بەروار', 'کات', 'جۆر', 'تێبینی', 'کاشێر', 'قازانج', 'دۆخ', 'هۆکاری هەڵوەشاندنەوە'],
          res.rows.map((x) => [fmtDateNum(x.created_at), fmtTime(x.created_at), KIND[x.kind], x.title || '', x.cashier_name, x.profit, x.voided ? 'هەڵوەشێنراوە' : '', x.void_reason || '']));
        toast(`${money(res.rows.length)} تۆمار ئێکسپۆرت کرا.`);
      } catch (e2) { toast(errText(e2), 'err'); }
    }) });
  }

  const wrap = h('div', { class: 'stack' }, loading());
  paintForm();
  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'خزمەتگوزارییەکان', sub: isAdmin ? 'چاکردنەوە و کارت — تەنها قازانجی دووکان' : `تۆمارەکانی ئەمڕۆی خۆت (${fmtDay(todayKey())})`, actions: [exportBtn] }),
    form, filters, summary, wrap));
  await reload();
  wrap.replaceChildren(table.el);
}
