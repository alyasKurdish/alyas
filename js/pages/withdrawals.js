// Cash withdrawals (admin only): take money out of the till, with a reason, and see how much left in any period.
import * as api from '../api.js';
import { h, button, withBusy, toast, numberInput, textInput, ledger, badge, openModal, textArea, loading, mount } from '../ui.js';
import { money, fmtDateNum, fmtTime, uuid, downloadCSV } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, kpiBand, panel, latest } from '../pagekit.js';
import { rangeControl } from '../range.js';

const REASONS = ['پارەی خۆم', 'کرێی دووکان', 'کڕینی کاڵا', 'مووچە', 'شتی تر'];

export default async function withdrawals(root) {
  const guard = latest();
  let rows = [];
  let totals = null;
  let reason = REASONS[0];
  let pendingId = uuid(); // one id per entry: a retry after a network error never records it twice

  const range = rangeControl({ initial: 'month', onChange: () => reload() });

  /* ---------- form ---------- */
  const amount = numberInput({ placeholder: '0' });
  amount.setAttribute('aria-label', 'بڕی پارە');
  const note = textInput({ maxlength: 200 });
  note.setAttribute('aria-label', 'تێبینی');
  note.placeholder = 'تێبینی (ئارەزوومەندانە)';
  const chips = REASONS.map((r) => h('button', { type: 'button', class: 'wdf__chip', onclick: () => setReason(r) }, r));
  function setReason(r) {
    reason = r;
    chips.forEach((b) => {
      const on = b.textContent === r;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  setReason(reason);
  const save = button('ڕاکێشانی پارە', { className: 'svcf__save', onClick: () => submit() });

  async function submit() {
    const n = amount.getValue();
    if (!n || n < 1) { toast('بڕی پارەکە بنووسە.', 'info'); amount.focus(); return; }
    await withBusy(save, async () => {
      try {
        await api.rpc('add_withdrawal', { p_amount: n, p_reason: reason, p_note: note.value || null, p_client_id: pendingId });
        pendingId = uuid();
        toast(`${money(n)} دینار ڕاکێشرا (${reason}).`);
        amount.setValue(null);
        note.value = '';
        await reload();
        amount.focus();
      } catch (e) { toast(errText(e), 'err'); }
    });
  }
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const form = h('section', { class: 'panel wd-form' },
    h('div', { class: 'svcf' },
      h('div', { class: 'svcf__row' },
        h('label', { class: 'svcf__field svcf__field--amount' }, h('span', null, 'بڕی پارە (دینار)'), amount),
        h('label', { class: 'svcf__field' }, h('span', null, 'تێبینی'), note)),
      h('div', { class: 'svcf__field' }, h('span', null, 'هۆکار'), h('div', { class: 'wdf__chips', role: 'group', 'aria-label': 'هۆکار' }, chips)),
      h('p', { class: 'svcf__hint' }, 'تەنها ئەدمین ئەم بەشە دەبینێت و دەتوانێت پارە ڕابکێشێت. ڕاکێشان لە قازانجی فرۆشتن لانابرێت، بەڵکو لە «ماوە» لە ڕاپۆرتی هەفتانە دەردەچێت.'),
      save));

  /* ---------- list ---------- */
  const cols = [
    { key: 'created_at', label: 'کات', sort: true, render: (r) => h('span', null, fmtDateNum(r.created_at), h('span', { class: 'sub' }, fmtTime(r.created_at))) },
    { key: 'reason', label: 'هۆکار', sort: true, render: (r) => r.reason || '—' },
    { key: 'note', label: 'تێبینی', render: (r) => r.note || '—', className: 'col-opt' },
    { key: 'by', label: 'کێ ڕایکێشا', sort: true, className: 'col-opt' },
    { key: 'amount', label: 'بڕ', num: true, sort: true, render: (r) => h('strong', { class: `num${r.voided ? ' num--void' : ' num--neg'}` }, money(r.amount)) },
    { key: 'st', label: '', render: (r) => (r.voided ? badge('هەڵوەشێنراوە', 'bad') : button('', { variant: 'quiet', size: 'sm', icon: 'trash', title: 'هەڵوەشاندنەوە', onClick: () => voidIt(r) })) },
  ];
  const table = ledger({
    columns: cols, cards: true, rowKey: (r) => r.id,
    defaultSort: { key: 'created_at', dir: 'desc' },
    empty: 'هیچ ڕاکێشانێک نییە لەم ماوەیەدا.',
  });
  const summary = h('div', { class: 'sales-summary' });

  async function voidIt(r) {
    const why = textArea({ rows: 2, placeholder: 'هۆکار (ئارەزوومەندانە)' });
    const ok = await new Promise((resolve) => {
      let a = false;
      const m = openModal({
        title: 'هەڵوەشاندنەوەی ڕاکێشان', size: 'sm',
        content: h('div', null, h('p', { class: 'modal__text' }, `ڕاکێشانی ${money(r.amount)} دینار (${r.reason || 'بێ هۆکار'}) هەڵبوەشێنرێتەوە؟ لە کۆی ڕاکێشراو دەرەچێت.`), why),
        footer: [h('button', { class: 'btn btn--danger', type: 'button', onclick: () => { a = true; m.close(); } }, 'هەڵیبوەشێنەرەوە'), h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => m.close() }, 'نەخێر')],
        onClose: () => resolve(a),
      });
    });
    if (!ok) return;
    try {
      await api.rpc('void_withdrawal', { p_id: r.id, p_reason: why.value.trim() || null });
      toast('هەڵوەشێنرایەوە.');
      await reload();
    } catch (e) { toast(errText(e), 'err'); }
  }

  const wrap = h('div', { class: 'stack' }, loading());
  async function reload(limit = 500) {
    const k = guard.next();
    wrap.classList.add('is-stale');
    try {
      const r = range.get();
      const res = await api.rpc('list_withdrawals', { p_from: r.from, p_to: r.to, p_limit: limit, p_offset: 0 });
      if (!guard.isCurrent(k)) return;
      rows = res.rows;
      totals = res;
      paint(r);
    } catch (e) {
      if (guard.isCurrent(k)) toast(errText(e), 'err');
    } finally {
      if (guard.isCurrent(k)) wrap.classList.remove('is-stale');
    }
  }
  function paint(r) {
    table.update(rows);
    const t = totals;
    mount(summary, kpiBand([
      { label: `کۆی ڕاکێشراو — ${r.label}`, value: t.total, unit: 'دینار', tone: 'bad', sub: `${money(t.count)} جار ڕاکێشراوە` },
      { label: 'ڕاکێشانی ئەمڕۆ', value: t.today_total, unit: 'دینار', sub: `${money(t.today_count)} جار` },
      { label: 'ڕاکێشانی ئەم مانگە', value: t.month_total, unit: 'دینار', sub: `${money(t.month_count)} جار` },
    ], { className: 'kpi--compact kpi--wd' }));
  }

  const exportBtn = button('ئێکسپۆرتی CSV', { variant: 'ghost', icon: 'download', onClick: (e) => withBusy(e.currentTarget, async () => {
    try {
      const r = range.get();
      const res = await api.rpc('list_withdrawals', { p_from: r.from, p_to: r.to, p_limit: 1000, p_offset: 0 });
      downloadCSV(`withdrawals_${r.from}_${r.to}.csv`, ['بەروار', 'کات', 'هۆکار', 'تێبینی', 'کێ ڕایکێشا', 'بڕ', 'دۆخ'],
        res.rows.map((x) => [fmtDateNum(x.created_at), fmtTime(x.created_at), x.reason || '', x.note || '', x.by || '', x.amount, x.voided ? 'هەڵوەشێنراوە' : '']));
      toast(`${money(res.rows.length)} تۆمار ئێکسپۆرت کرا.`);
    } catch (e2) { toast(errText(e2), 'err'); }
  }) });

  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'پارە ڕاکێشان', sub: 'ڕاکێشانی پارە لە حیساب — تەنها ئەدمین', actions: [exportBtn] }),
    form,
    h('div', { class: 'toolbar' }, range.el),
    summary,
    panel({ title: 'تۆمارەکانی ڕاکێشان', body: wrap })));
  await reload();
  wrap.replaceChildren(table.el);
}
