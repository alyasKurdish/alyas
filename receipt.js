// Receipt paper, the "receipt details" dialog, and the return (گەڕاندنەوە) dialog.
import * as api from './api.js';
import { h, icon, button, withBusy, openModal, toast, badge, field, numberInput, selectBox, textArea, checkbox, printNode, loading, errorState } from './ui.js';
import { money, fmtDateTime, fmtDateNum, fmtTime, uuid, dayKey, todayKey, daysBetween, pct, margin } from './fmt.js';
import { errText, RETURN_REASONS } from './i18n.js';

const AUTOPRINT = 'zp.autoprint';
export const autoPrintOn = () => {
  try { return localStorage.getItem(AUTOPRINT) === '1'; } catch { return false; }
};
export const setAutoPrint = (on) => {
  try { localStorage.setItem(AUTOPRINT, on ? '1' : '0'); } catch { /* ignore */ }
};

/* ---------------------------------------------------------------- receipt paper */
export function receiptNode(sale, settings) {
  const s = settings || {};
  const refunded = sale.refunded || 0;
  const lines = sale.items.map((it) => h('li', { class: 'rc__item' },
    h('div', { class: 'rc__name' }, it.name),
    h('div', { class: 'rc__calc' },
      h('span', { class: 'num rc__qty' }, `${money(it.qty)} × ${money(it.unit_price)}`),
      h('span', { class: 'num rc__sum' }, money(it.line_total))),
    it.returned_qty > 0 ? h('div', { class: 'rc__ret' }, h('span', null, `گەڕاوە: ${money(it.returned_qty)} دانە`), h('span', { class: 'num' }, `−${money(it.refunded)}`)) : null));

  const row = (label, value, cls = '') => h('div', { class: `rc__row ${cls}` }, h('span', null, label), h('span', { class: 'num' }, value));
  const net = sale.total - refunded;

  return h('article', { class: 'receipt', dir: 'rtl' },
    h('header', { class: 'rc__head' },
      h('div', { class: 'rc__shop' }, s.shop_name || 'ZERO PHONE'),
      s.shop_phone ? h('div', { class: 'rc__meta num' }, s.shop_phone) : null,
      s.shop_address ? h('div', { class: 'rc__meta' }, s.shop_address) : null),
    h('div', { class: 'rc__info' },
      h('div', null, h('span', null, 'وەسڵ'), h('strong', { class: 'num' }, `#${sale.id}`)),
      h('div', null, h('span', null, 'کات'), h('span', null, fmtDateTime(sale.created_at))),
      h('div', null, h('span', null, 'کاشێر'), h('span', null, sale.cashier_name))),
    h('ul', { class: 'rc__items' }, lines),
    h('div', { class: 'rc__totals' },
      row('کۆ', money(sale.subtotal)),
      sale.discount > 0 ? row('داشکان', `−${money(sale.discount)}`) : null,
      row(refunded > 0 ? 'کۆی وەسڵ' : 'کۆی گشتی', `${money(sale.total)} دینار`, refunded > 0 ? '' : 'rc__row--grand'),
      refunded > 0 ? row('گەڕاوە بۆ کڕیار', `−${money(refunded)}`) : null,
      refunded > 0 ? row('ماوە بەسەر کڕیار', `${money(net)} دینار`, 'rc__row--grand') : null),
    sale.note ? h('p', { class: 'rc__note' }, sale.note) : null,
    s.receipt_footer ? h('footer', { class: 'rc__foot' }, s.receipt_footer) : null);
}

export function printReceipt(sale, settings) {
  const wrap = h('div', { class: 'print-sheet' }, receiptNode(sale, settings));
  printNode(wrap);
}

/* ---------------------------------------------------------------- after a sale */
export function showSaleDone(sale, settings, { onClose } = {}) {
  const autoBox = checkbox({ label: 'دوای هەر فرۆشتنێک خۆکار چاپ بکە', checked: autoPrintOn(), onChange: setAutoPrint });
  const m = openModal({
    title: 'فرۆشتن تەواو بوو',
    size: 'sm',
    className: 'modal--receipt',
    content: [
      h('div', { class: 'done-banner' }, h('span', { class: 'done-banner__tick' }, icon('check', 22)), h('div', null, h('strong', null, `وەسڵی #${sale.id}`), h('div', { class: 'done-banner__sum' }, h('span', { class: 'num' }, money(sale.total)), ' دینار'))),
      h('div', { class: 'paper-wrap' }, receiptNode(sale, settings)),
      autoBox,
    ],
    footer: [
      button('چاپکردن', { icon: 'print', variant: 'ghost', onClick: () => printReceipt(sale, settings) }),
      button('فرۆشتنی نوێ', { variant: 'cta', onClick: () => m.close() }),
    ],
    onClose,
  });
  return m;
}

/* ---------------------------------------------------------------- return dialog */
const prorate = (total, k, n) => (k >= n ? total : Math.floor((total * k) / n));

/** returns true when the cashier/admin may take this item back (the server checks again) */
export function canReturn(sale, item, role, settings) {
  if (item.qty - item.returned_qty <= 0) return false;
  if (role === 'admin') return true;
  if (!settings || !settings.cashier_can_return) return false;
  const age = daysBetween(dayKey(sale.created_at), todayKey());
  return age <= (settings.return_window_days ?? 0);
}

export function openReturnDialog({ sale, item, role, onDone }) {
  const max = item.qty - item.returned_qty;
  const clientId = uuid();
  let qty = 1;
  let restock = true;

  const qtyInput = numberInput({ value: 1, grouped: false, max, onInput: (v) => { qty = v || 0; refresh(); } });
  qtyInput.classList.add('input--qty');
  const step = (d) => {
    const v = Math.min(max, Math.max(1, (qtyInput.getValue() || 1) + d));
    qtyInput.setValue(v);
    qty = v;
    refresh();
  };
  const stepper = h('div', { class: 'stepper stepper--lg' },
    h('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'کەمکردن', onclick: () => step(-1) }, icon('minus', 18)),
    qtyInput,
    h('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'زیادکردن', onclick: () => step(1) }, icon('plus', 18)));

  const OTHER = '__other';
  const reasonSel = selectBox({ options: [{ value: '', label: 'هۆکارێک هەڵبژێرە...' }, ...RETURN_REASONS.map((r) => ({ value: r, label: r })), { value: OTHER, label: 'هۆکاری تر...' }], value: '' });
  const reasonText = textArea({ rows: 2, placeholder: 'هۆکارەکە بنووسە' });
  reasonText.setAttribute('aria-label', 'هۆکاری گەڕاندنەوە');
  const reasonField = field('هۆکاری گەڕاندنەوە', reasonSel, { required: true });
  const textField = field('', reasonText, { className: 'field--bare' });
  textField.hidden = true;
  reasonSel.addEventListener('change', () => {
    textField.hidden = reasonSel.value !== OTHER;
    reasonField.setError('');
    if (!textField.hidden) reasonText.focus();
  });

  const refundOut = h('span', { class: 'num return__refund-val' });
  const restockBox = checkbox({
    label: 'کاڵاکە دەگەڕێتەوە کۆگا',
    checked: true,
    hint: role === 'admin' ? 'ئەگەر تێکچووە یان ناگەڕێتەوە کۆگا، ئەمە لابدە — تێچووی کاڵاکە وەک زیان دەمێنێتەوە.' : 'ئەگەر کاڵاکە تێکچووە و ناگەڕێتەوە کۆگا، ئەمە لابدە.',
    onChange: (v) => { restock = v; },
  });
  const lineErr = h('div', { class: 'field__error', role: 'alert' });
  lineErr.hidden = true;

  function refundFor(q) {
    return prorate(item.line_net, item.returned_qty + q, item.qty) - prorate(item.line_net, item.returned_qty, item.qty);
  }
  function refresh() {
    const ok = qty >= 1 && qty <= max;
    refundOut.textContent = ok ? money(refundFor(qty)) : '—';
    submit.disabled = !ok;
  }

  const submit = button('گەڕاندنەوە تۆمار بکە', { variant: 'danger', icon: 'return', onClick: () => withBusy(submit, run) });
  const m = openModal({
    title: 'گەڕاندنەوەی کاڵا',
    size: 'md',
    content: [
      h('div', { class: 'return__item' },
        h('strong', null, item.name),
        h('div', { class: 'return__facts' },
          h('span', null, 'فرۆشراو: ', h('b', { class: 'num' }, money(item.qty))),
          h('span', null, 'پێشتر گەڕاوە: ', h('b', { class: 'num' }, money(item.returned_qty))),
          h('span', null, 'ماوە بۆ گەڕاندنەوە: ', h('b', { class: 'num' }, money(max))))),
      field('چەند دانە دەگەڕێتەوە؟', stepper),
      reasonField,
      textField,
      restockBox,
      h('div', { class: 'return__refund' }, h('span', null, 'بڕی گەڕاوە بۆ کڕیار'), h('strong', null, refundOut, ' دینار')),
      lineErr,
    ],
    footer: [submit, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
  });
  refresh();

  async function run() {
    lineErr.hidden = true;
    reasonField.setError('');
    const reason = reasonSel.value === OTHER ? reasonText.value.trim() : reasonSel.value;
    if (!reason) {
      reasonField.setError('هۆکارەکە هەڵبژێرە یان بنووسە.');
      return;
    }
    if (qty < 1 || qty > max) return;
    const args = { p_sale_item_id: item.id, p_qty: qty, p_reason: reason, p_restock: restock, p_client_id: clientId };
    let updated;
    try {
      try {
        updated = await api.rpc('process_return', args);
      } catch (e) {
        if (!e.isNetwork) throw e;
        await new Promise((r) => setTimeout(r, 1200));
        updated = await api.rpc('process_return', args); // same client_id: can never be counted twice
      }
    } catch (e) {
      if (e.isNetwork) {
        // we cannot know whether it was saved: show the receipt as it is now
        try {
          const fresh = await api.rpc('get_sale', { p_sale_id: sale.id });
          m.close();
          toast('پەیوەندی بچڕا. وەسڵەکە نوێکرایەوە — پشکنە ئایا گەڕاندنەوەکە تۆمار کراوە.', 'info', 8000);
          onDone && onDone(fresh);
        } catch {
          lineErr.textContent = errText(e);
          lineErr.hidden = false;
        }
        return;
      }
      lineErr.textContent = errText(e);
      lineErr.hidden = false;
      return;
    }
    m.close();
    const money_back = refundFor(qty);
    toast(`گەڕاندنەوە تۆمار کرا — ${money(money_back)} دینار بدەرەوە بە کڕیار.`, 'ok', 6000);
    onDone && onDone(updated);
  }
  return m;
}

/* ---------------------------------------------------------------- receipt details dialog */
/**
 * openSaleDialog({ saleId | sale, settings, role, onChange })
 * Shows the receipt, every line with its return button, and (admin only) cost and profit.
 */
export function openSaleDialog({ saleId, sale: given, settings, role, onChange }) {
  const body = h('div', { class: 'sale-view' });
  const printBtn = button('چاپکردن', { icon: 'print', variant: 'ghost', onClick: () => current && printReceipt(current, settings) });
  printBtn.disabled = true;
  const m = openModal({
    title: given ? `وەسڵی #${given.id}` : `وەسڵی #${saleId}`,
    size: 'xl',
    className: 'modal--sale',
    content: body,
    footer: [printBtn, button('داخستن', { variant: 'ghost', onClick: () => m.close() })],
  });
  let current = null;

  async function load() {
    body.replaceChildren(loading());
    try {
      const s = await api.rpc('get_sale', { p_sale_id: given ? given.id : saleId });
      paint(s);
    } catch (e) {
      body.replaceChildren(errorState(errText(e), load));
    }
  }

  function paint(s) {
    current = s;
    printBtn.disabled = false;
    m.setTitle(`وەسڵی #${s.id}`);
    const refunded = s.refunded || 0;
    const fullyBack = s.items.every((i) => i.returned_qty >= i.qty);
    const partlyBack = !fullyBack && s.items.some((i) => i.returned_qty > 0);

    const lineRows = s.items.map((it) => {
      const left = it.qty - it.returned_qty;
      const can = canReturn(s, it, role, settings);
      const costNet = it.cost_total !== null && it.cost_total !== undefined ? it.cost_total - (it.cost_returned || 0) : null;
      const profit = costNet === null ? null : it.line_net - it.refunded - costNet;
      return h('li', { class: 'sline' },
        h('div', { class: 'sline__main' },
          h('div', { class: 'sline__name' }, it.name),
          h('div', { class: 'sline__sub' },
            h('span', { class: 'num' }, `${money(it.qty)} × ${money(it.unit_price)}`),
            it.line_discount > 0 ? h('span', null, 'داشکان ', h('span', { class: 'num' }, `−${money(it.line_discount)}`)) : null,
            it.returned_qty > 0 ? badge(`گەڕاوە ${money(it.returned_qty)} دانە`, it.returned_qty >= it.qty ? 'bad' : 'warn') : null)),
        h('div', { class: 'sline__money' },
          h('strong', { class: 'num' }, money(it.line_net)),
          profit !== null ? h('small', { class: `sline__profit${profit < 0 ? ' is-neg' : ''}` }, 'قازانج ', h('span', { class: 'num' }, money(profit))) : null),
        can ? button('گەڕاندنەوە', { size: 'sm', variant: 'ghost', icon: 'return', onClick: () => openReturnDialog({ sale: s, item: it, role, onDone: (fresh) => { paint(fresh); onChange && onChange(fresh); } }) })
          : (left > 0 ? h('span', { class: 'sline__locked', title: 'ماوەی گەڕاندنەوە تەواو بووە' }, icon('lock', 16)) : null));
    });

    const side = [];
    side.push(h('div', { class: 'sale-view__status' },
      fullyBack ? badge('هەموو گەڕاوەتەوە', 'bad') : partlyBack ? badge('بەشێکی گەڕاوەتەوە', 'warn') : badge('تەواو', 'ok'),
      h('span', { class: 'muted' }, `${fmtDateNum(s.created_at)} · ${fmtTime(s.created_at)} · ${s.cashier_name}`)));
    side.push(h('ul', { class: 'slines' }, lineRows));

    if (role === 'admin' && s.cost_total !== null && s.cost_total !== undefined) {
      const cost = s.cost_total - (s.cost_back || 0);
      const revenue = s.total - refunded;
      const profit = revenue - cost;
      side.push(h('div', { class: 'kv-grid' },
        kv('کۆی فرۆشتن (دوای داشکان)', money(s.total)),
        refunded > 0 ? kv('گەڕاوە بۆ کڕیار', `−${money(refunded)}`) : null,
        kv('تێچووی کاڵاکان', money(cost)),
        kv('قازانجی ئەم وەسڵە', money(profit), profit < 0 ? 'neg' : 'strong'),
        kv('ڕێژەی قازانج', pct(margin(profit, revenue), 1))));
    }

    if (s.returns && s.returns.length) {
      side.push(h('div', { class: 'sale-view__returns' },
        h('h4', null, 'گەڕاندنەوەکان'),
        h('ul', { class: 'rlist' }, s.returns.map((r) => {
          const it = s.items.find((x) => x.id === r.sale_item_id);
          return h('li', null,
            h('div', null, h('strong', null, it ? it.name : '—'), ' ', h('span', { class: 'num' }, `×${money(r.qty)}`),
              r.restocked ? null : badge('نەگەڕایەوە کۆگا', 'bad')),
            h('div', { class: 'rlist__sub' }, `${r.reason} · ${r.by} · ${fmtDateNum(r.created_at)} ${fmtTime(r.created_at)}`),
            h('div', { class: 'rlist__amt num' }, `−${money(r.refund)}`));
        }))));
    }
    if (s.note) side.push(h('p', { class: 'note' }, icon('info', 18), h('span', null, s.note)));

    body.replaceChildren(
      h('div', { class: 'sale-view__paper' }, h('div', { class: 'paper-wrap' }, receiptNode(s, settings))),
      h('div', { class: 'sale-view__side' }, side));
  }

  if (given && given.items) paint(given);
  else load();
  return m;
}

function kv(label, value, tone) {
  return h('div', { class: `kv-grid__cell${tone ? ` kv-grid__cell--${tone}` : ''}` }, h('span', null, label), h('strong', { class: 'num' }, value));
}
