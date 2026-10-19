// The add-a-service form (repair / phone card). Only the shop's own profit is typed — always by hand.
import * as api from './api.js';
import { h, icon, button, withBusy, toast, numberInput, textInput } from './ui.js';
import { money, uuid } from './fmt.js';
import { errText } from './i18n.js';

export const KIND = { repair: 'چاکردنەوە', card: 'کارت' };
const HINT = {
  repair: 'تەنها قازانجی دەستی خۆت بنووسە (وەک ٥٬٠٠٠)، نەک نرخی پارچەکە.',
  card: 'تەنها قازانجی کارتەکە بنووسە، نەک نرخی کارتەکە. هەر کڕیارێک تۆمارێکی جیاوازە.',
};

/** serviceForm({ onSaved }) -> { el, focus() } */
export function serviceForm({ onSaved } = {}) {
  let kind = 'repair';
  let pendingId = uuid(); // one id per entry: a retry after a network error never records it twice

  const amount = numberInput({ placeholder: '0' });
  amount.setAttribute('aria-label', 'قازانجی دووکان');
  const note = textInput({ maxlength: 120 });
  note.setAttribute('aria-label', 'تێبینی');
  const hint = h('p', { class: 'svcf__hint' });
  const save = button('تۆمارکردن', { className: 'svcf__save', onClick: () => submit() });

  const kindBtns = Object.keys(KIND).map((k) => h('button', { type: 'button', class: 'svcf__kind', dataset: { kind: k }, onclick: () => setKind(k) },
    KIND[k]));

  function setKind(k) {
    kind = k;
    kindBtns.forEach((b) => {
      const on = b.dataset.kind === k;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    note.placeholder = k === 'repair' ? 'چی چاک کرایەوە؟ (ئارەزوومەندانە)' : 'جۆری کارت (ئارەزوومەندانە)';
    hint.textContent = HINT[k];
  }

  async function submit() {
    const n = amount.getValue();
    if (!n || n < 1) { toast('قازانجەکە بنووسە.', 'info'); amount.focus(); return; }
    await withBusy(save, async () => {
      try {
        await api.rpc('add_service', { p_kind: kind, p_profit: n, p_title: note.value || null, p_client_id: pendingId });
        pendingId = uuid();
        toast(`${KIND[kind]} تۆمار کرا: ${money(n)} دینار`);
        amount.setValue(null);
        note.value = '';
        if (onSaved) await onSaved();
        amount.focus();
      } catch (e) { toast(errText(e), 'err'); }
    });
  }
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const el = h('div', { class: 'svcf' },
    h('div', { class: 'svcf__kinds', role: 'group', 'aria-label': 'جۆر' }, kindBtns),
    h('div', { class: 'svcf__row' },
      h('label', { class: 'svcf__field svcf__field--amount' }, h('span', null, 'قازانج (دینار)'), amount),
      h('label', { class: 'svcf__field' }, h('span', null, 'تێبینی'), note)),
    hint,
    save);
  setKind('repair');
  return { el, focus: () => amount.focus() };
}
