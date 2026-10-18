// Dialogs for one product: create/edit, goods arrival, stock correction, history.
import * as api from './api.js';
import { h, icon, button, withBusy, openModal, toast, field, textInput, numberInput, selectBox, textArea, checkbox, badge, ledger, loading, errorState, confirmDialog } from './ui.js';
import { money, pct, margin, uuid, fmtDateNum, fmtTime, todayKey, addDays } from './fmt.js';
import { errText, MOVEMENT } from './i18n.js';

const unitOf = (total, qty) => (qty > 0 && total !== null && total !== undefined ? Math.round(total / qty) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** one retry with the same client id when the connection drops */
async function rpcRetry(name, args) {
  try {
    return await api.rpc(name, args);
  } catch (e) {
    if (!e.isNetwork) throw e;
    await sleep(1200);
    return api.rpc(name, args);
  }
}

function infoLine(label, value, tone) {
  return h('div', { class: `calc__row${tone ? ` calc__row--${tone}` : ''}` }, h('span', null, label), h('strong', { class: 'num' }, value));
}

/* ======================================================================= product form */
export function openProductForm({ product, categories = [], onSaved }) {
  const editing = !!product;
  const listId = `cats${Math.random().toString(36).slice(2, 7)}`;
  const name = textInput({ value: product ? product.name : '', maxlength: 200, placeholder: 'بۆ نموونە: کەیسی ئایفۆن 15' });
  const code = textInput({ value: product && product.code ? product.code : '', dir: 'ltr', maxlength: 64, placeholder: 'بارکۆد بخوێنەوە یان بینووسە' });
  const category = textInput({ value: product && product.category ? product.category : '', maxlength: 80, placeholder: 'بۆ نموونە: کەیس، شارژەر، مۆبایل' });
  category.setAttribute('list', listId);
  const price = numberInput({ value: product ? product.price : null, placeholder: '0', onInput: () => refresh() });
  const minStock = numberInput({ value: product ? product.min_stock : 0, grouped: false });
  const qty = numberInput({ value: null, grouped: false, placeholder: '0', onInput: () => refresh() });
  const cost = numberInput({ value: null, placeholder: '0', onInput: () => refresh() });
  const activeBox = editing ? checkbox({ label: 'لە شاشەی فرۆشتن پیشان بدرێت', checked: product.active, hint: 'ئەگەر ڕایبگریت، کاشێر نایبینێت بەڵام مێژووەکەی دەمێنێتەوە.' }) : null;

  const fName = field('ناوی کاڵا', name, { required: true });
  const fCode = field('بارکۆد', code, { hint: 'ئارەزوومەندانە — بۆ ئەوەی کاشێر بە سکانەر بیفرۆشێت.' });
  const fCat = field('پۆل', category, { hint: 'بۆ ڕێکخستنی کاڵاکان لە شاشەی فرۆشتن.' });
  const fPrice = field('نرخی فرۆشتن (بۆ یەک دانە)', price, { required: true, hint: 'بە دینار، بێ پارچە.' });
  const fMin = field('ئاگادارکردنەوەی کەمبوون', minStock, { hint: 'کاتێک ژمارەی ماوە دەگاتە ئەم ژمارەیە یان کەمتر، وەک «کەمە» پیشان دەدرێت. 0 = ئاگاداری نەبێت.' });
  const fQty = field('ژمارەی ئێستا لە کۆگا', qty, { hint: 'ئەگەر کاڵاکە ئێستا هەیە، ژمارەکەی بنووسە.' });
  const fCost = field('کۆی نرخی کڕینی هەموویان', cost, { hint: 'کۆی ئەو پارەیەی بۆ ئەم بڕە داوتە — نەک نرخی یەک دانە.' });
  const calc = h('div', { class: 'calc' });
  const formErr = h('div', { class: 'note note--bad', role: 'alert', hidden: true });

  function refresh() {
    if (editing) {
      const avg = product.avg_cost;
      const p = price.getValue();
      calc.replaceChildren(...(avg !== null && avg !== undefined && p !== null ? [
        infoLine('نرخی کڕینی تێکڕا (یەک دانە)', money(avg)),
        infoLine('قازانج بۆ هەر دانەیەک', `${money(p - avg)} (${pct(margin(p - avg, p), 0)})`, p - avg < 0 ? 'bad' : 'good'),
      ] : []));
      return;
    }
    const q = qty.getValue();
    const c = cost.getValue();
    const p = price.getValue();
    const u = unitOf(c, q);
    const rows = [];
    if (q > 0 && c !== null) {
      rows.push(infoLine('نرخی کڕینی یەک دانە', money(u)));
      if (p !== null) rows.push(infoLine('قازانج بۆ هەر دانەیەک', `${money(p - u)} (${pct(margin(p - u, p), 0)})`, p - u < 0 ? 'bad' : 'good'));
    }
    calc.replaceChildren(...rows);
  }

  const save = button(editing ? 'پاشەکەوتکردن' : 'زیادکردنی کاڵا', { icon: 'check', onClick: () => withBusy(save, run) });
  const form = h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } },
    formErr,
    fName,
    h('div', { class: 'field-row' }, fCode, fCat),
    h('div', { class: 'field-row' }, fPrice, fMin),
    editing ? calc : null,
    editing ? activeBox : null,
    editing ? null : h('fieldset', { class: 'fieldset' },
      h('legend', null, 'کۆگای سەرەتا'),
      h('div', { class: 'field-row' }, fQty, fCost),
      calc),
    h('input', { type: 'submit', hidden: true }),
    h('datalist', { id: listId }, categories.map((c) => h('option', { value: c }))));
  // a barcode scanner ends with Enter: go to the next field instead of submitting
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      category.focus();
    }
  });

  const m = openModal({
    title: editing ? 'دەستکاریکردنی کاڵا' : 'کاڵای نوێ',
    size: 'md',
    content: form,
    footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
  });
  refresh();

  async function run() {
    [fName, fCode, fPrice, fMin, fQty, fCost].forEach((f) => f.setError(''));
    formErr.hidden = true;
    let bad = false;
    if (!name.value.trim()) { fName.setError('ناوی کاڵا بنووسە.'); bad = true; }
    const p = price.getValue();
    if (p === null) { fPrice.setError('نرخی فرۆشتن بنووسە.'); bad = true; }
    const q = editing ? 0 : qty.getValue() || 0;
    const c = editing ? null : cost.getValue();
    if (!editing && q > 0 && c === null) { fCost.setError('کۆی نرخی کڕین بنووسە (دەتوانێت 0 بێت).'); bad = true; }
    if (bad) return;
    const payload = {
      id: editing ? product.id : null,
      name: name.value.trim(),
      code: code.value.trim() || null,
      category: category.value.trim() || null,
      price: p,
      min_stock: minStock.getValue() || 0,
    };
    if (editing) payload.active = activeBox.input.checked;
    else if (q > 0) { payload.opening_qty = q; payload.opening_cost = c; }
    try {
      const saved = await api.rpc('save_product', { p: payload });
      toast(editing ? `«${saved.name}» نوێکرایەوە.` : `«${saved.name}» زیادکرا.`);
      m.close();
      onSaved && onSaved(saved, !editing);
    } catch (e) {
      const msg = errText(e);
      if (e.key === 'CODE_TAKEN') fCode.setError(msg);
      else if (e.key === 'NAME_REQUIRED') fName.setError(msg);
      else if (e.key === 'PRICE_INVALID') fPrice.setError(msg);
      else if (e.key === 'COST_REQUIRED' || e.key === 'COST_INVALID') fCost.setError(msg);
      else {
        formErr.replaceChildren(icon('alert', 18), h('span', null, msg));
        formErr.hidden = false;
      }
    }
  }
  return m;
}

/* ======================================================================= goods arrival */
export function openAddStock({ product, onSaved }) {
  const clientId = uuid();
  const qty = numberInput({ value: null, grouped: false, placeholder: '0', onInput: () => refresh() });
  const total = numberInput({ value: null, placeholder: '0', onInput: () => refresh() });
  const supplier = textInput({ maxlength: 120, placeholder: 'ناوی دابینکەر (ئارەزوومەندانە)' });
  const note = textInput({ maxlength: 300, placeholder: 'تێبینی (ئارەزوومەندانە)' });
  const fQty = field('ژمارەی ئەو دانانەی هاتوون', qty, { required: true });
  const fTotal = field('کۆی نرخی کڕینی ئەم هاتنە', total, { required: true, hint: 'کۆی ئەو پارەیەی بۆ هەموو ئەم بڕە داوتە — نەک نرخی یەک دانە. ئەگەر دیارییە، 0 بنووسە.' });
  const calc = h('div', { class: 'calc' });
  const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });

  const avgNow = product.stock > 0 ? Math.round(product.stock_value / product.stock) : null;
  function refresh() {
    const q = qty.getValue();
    const t = total.getValue();
    const rows = [];
    if (q > 0 && t !== null) {
      const u = unitOf(t, q);
      rows.push(infoLine('نرخی کڕینی یەک دانە لەم هاتنەدا', money(u)));
      const newStock = product.stock + q;
      const newAvg = Math.round((product.stock_value + t) / newStock);
      rows.push(infoLine('ژمارەی نوێ لە کۆگا', money(newStock)));
      rows.push(infoLine('نرخی کڕینی تێکڕا دوای ئەم هاتنە', `${money(newAvg)}${avgNow !== null ? `  (پێشتر ${money(avgNow)})` : ''}`));
      rows.push(infoLine('قازانج بۆ هەر دانەیەک بە نرخی ئێستا', `${money(product.price - newAvg)} (${pct(margin(product.price - newAvg, product.price), 0)})`, product.price - newAvg < 0 ? 'bad' : 'good'));
    }
    calc.replaceChildren(...rows);
  }

  const save = button('تۆمارکردنی هاتن', { icon: 'arrivals', onClick: () => withBusy(save, run) });
  const m = openModal({
    title: 'هاتنی کاڵا',
    size: 'md',
    content: h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } },
      h('div', { class: 'return__item' }, h('strong', null, product.name), h('div', { class: 'return__facts' },
        h('span', null, 'ماوە لە کۆگا: ', h('b', { class: 'num' }, money(product.stock))),
        h('span', null, 'نرخی کڕینی تێکڕا: ', h('b', { class: 'num' }, avgNow === null ? '—' : money(avgNow))),
        h('span', null, 'نرخی فرۆشتن: ', h('b', { class: 'num' }, money(product.price))))),
      err,
      h('div', { class: 'field-row' }, fQty, fTotal),
      calc,
      h('div', { class: 'field-row' }, field('دابینکەر', supplier), field('تێبینی', note)),
      h('input', { type: 'submit', hidden: true })),
    footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
  });

  async function run() {
    fQty.setError('');
    fTotal.setError('');
    err.hidden = true;
    const q = qty.getValue();
    const t = total.getValue();
    let bad = false;
    if (!q || q < 1) { fQty.setError('ژمارەکە دەبێت لانی کەم 1 بێت.'); bad = true; }
    if (t === null) { fTotal.setError('کۆی نرخی کڕین بنووسە (دەتوانێت 0 بێت).'); bad = true; }
    if (bad) return;
    try {
      const res = await rpcRetry('add_stock', { p_product_id: product.id, p_qty: q, p_total_cost: t, p_supplier: supplier.value.trim() || null, p_note: note.value.trim() || null, p_client_id: clientId });
      if (res.duplicate) toast('ئەم هاتنە پێشتر تۆمار کرابوو — دووبارە نەنووسرایەوە.', 'info', 6000);
      else toast(`${money(q)} دانە هاتنی «${product.name}» تۆمار کرا.`);
      m.close();
      onSaved && onSaved(res.product);
    } catch (e) {
      err.replaceChildren(icon('alert', 18), h('span', null, e.isNetwork ? `${errText(e)} پێش دووبارە هەوڵدان لە «مێژوو»ی کاڵاکە بپشکنە.` : errText(e)));
      err.hidden = false;
    }
  }
  return m;
}

/* ======================================================================= stock correction */
const ADJUST_REASONS = ['ژماردنی کۆگا', 'کاڵا تێکچووە', 'کاڵا ونبووە', 'هەڵەی تۆمارکردن'];
export function openAdjust({ product, onSaved }) {
  const OTHER = '__other';
  const count = numberInput({ value: product.stock, grouped: false });
  const reasonSel = selectBox({ options: [{ value: '', label: 'هۆکارێک هەڵبژێرە...' }, ...ADJUST_REASONS.map((r) => ({ value: r, label: r })), { value: OTHER, label: 'هۆکاری تر...' }], value: '' });
  const reasonText = textInput({ maxlength: 300, placeholder: 'هۆکارەکە بنووسە' });
  reasonText.setAttribute('aria-label', 'هۆکار');
  const fCount = field('ژمارەی ڕاستەقینە لە کۆگا', count, { required: true, hint: 'ئەو ژمارەیەی ئێستا بە دەست دەیژمێریت.' });
  const fReason = field('هۆکار', reasonSel, { required: true });
  const fText = field('', reasonText, { className: 'field--bare' });
  fText.hidden = true;
  reasonSel.addEventListener('change', () => {
    fText.hidden = reasonSel.value !== OTHER;
    fReason.setError('');
    if (!fText.hidden) reasonText.focus();
  });
  const calc = h('div', { class: 'calc' });
  const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
  count.addEventListener('input', refresh);
  function refresh() {
    const v = count.getValue();
    if (v === null || v === product.stock) { calc.replaceChildren(); return; }
    const d = v - product.stock;
    calc.replaceChildren(infoLine('جیاوازی', `${d > 0 ? '+' : '−'}${money(Math.abs(d))} دانە`, d < 0 ? 'bad' : 'good'),
      h('p', { class: 'calc__note' }, 'نرخی کڕینی تێکڕا ناگۆڕێت؛ تەنها ژمارە و بەهای کۆگا ڕاست دەکرێنەوە.'));
  }

  const save = button('ڕاستکردنەوە', { icon: 'check', onClick: () => withBusy(save, run) });
  const m = openModal({
    title: 'ڕاستکردنەوەی ژمارەی کۆگا',
    size: 'sm',
    content: h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } },
      h('div', { class: 'return__item' }, h('strong', null, product.name), h('div', { class: 'return__facts' }, h('span', null, 'ژمارەی تۆمارکراو: ', h('b', { class: 'num' }, money(product.stock))))),
      err, fCount, fReason, fText, calc, h('input', { type: 'submit', hidden: true })),
    footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
  });

  async function run() {
    fCount.setError('');
    fReason.setError('');
    err.hidden = true;
    const v = count.getValue();
    const reason = reasonSel.value === OTHER ? reasonText.value.trim() : reasonSel.value;
    let bad = false;
    if (v === null || v < 0) { fCount.setError('ژمارەیەکی دروست بنووسە.'); bad = true; }
    else if (v === product.stock) { fCount.setError('ئەمە هەمان ژمارەی ئێستایە.'); bad = true; }
    if (!reason) { fReason.setError('هۆکارەکە هەڵبژێرە یان بنووسە.'); bad = true; }
    if (bad) return;
    try {
      const res = await rpcRetry('adjust_stock', { p_product_id: product.id, p_new_stock: v, p_note: reason });
      toast(`ژمارەی «${product.name}» بوو بە ${money(v)}.`);
      m.close();
      onSaved && onSaved(res);
    } catch (e) {
      err.replaceChildren(icon('alert', 18), h('span', null, errText(e)));
      err.hidden = false;
    }
  }
  return m;
}

/* ======================================================================= history */
export const chg = (n) => h('span', { class: `num ${n > 0 ? 'num--good' : n < 0 ? 'num--neg' : 'muted'}` }, n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : '0');

export function movementTone(kind) {
  return { opening: 'ok', purchase: 'ok', sale: 'neutral', return: 'warn', return_loss: 'bad', adjust: 'warn', void: 'bad' }[kind] || 'neutral';
}

export function openHistory({ product, onChanged }) {
  const body = h('div', { class: 'stack', style: { gap: '14px' } }, loading());
  const m = openModal({ title: `مێژووی «${product.name}»`, size: 'xl', content: body, footer: [button('داخستن', { variant: 'ghost', onClick: () => m.close() })] });

  async function load() {
    body.replaceChildren(loading());
    try {
      const t = todayKey();
      const res = await api.rpc('list_movements', { p_from: addDays(t, -799), p_to: t, p_product_id: product.id, p_kind: null, p_limit: 300, p_offset: 0 });
      paint(res.rows, res.count);
    } catch (e) {
      body.replaceChildren(errorState(errText(e), load));
    }
  }

  function paint(rows, count) {
    const latest = rows[0];
    const canVoid = latest && (latest.kind === 'purchase' || latest.kind === 'opening') && !latest.purchase_voided;
    const table = ledger({
      dense: true,
      cards: true,
      rowKey: (r) => r.id,
      empty: 'هێشتا هیچ جووڵەیەک نییە.',
      columns: [
        { key: 'created_at', label: 'کات', render: (r) => h('span', null, fmtDateNum(r.created_at), h('span', { class: 'sub' }, fmtTime(r.created_at))) },
        { key: 'kind', label: 'جۆر', render: (r) => badge(MOVEMENT[r.kind] || r.kind, movementTone(r.kind)) },
        { key: 'qty_change', label: 'ژمارە', num: true, render: (r) => chg(r.qty_change) },
        { key: 'value_change', label: 'بەها', num: true, render: (r) => chg(r.value_change) },
        { key: 'stock_after', label: 'ماوە دوای ئەمە', num: true },
        { key: 'by', label: 'کەس' },
        { key: 'note', label: 'تێبینی', render: (r) => h('span', { class: 'muted' }, [r.supplier, r.note, r.purchase_voided ? 'هەڵوەشێنراوەتەوە' : ''].filter(Boolean).join(' · ') || '—') },
        { key: 'act', label: '', render: (r) => (canVoid && r.id === latest.id ? button('هەڵوەشاندنەوە', { size: 'sm', variant: 'danger-ghost', onClick: () => voidIt(r) }) : '') },
      ],
    });
    table.update(rows);
    body.replaceChildren(
      h('div', { class: 'kv-grid' },
        kvCell('ماوە لە کۆگا', money(product.stock)),
        kvCell('بەهای ماوە (سەرمایە)', money(product.stock_value)),
        kvCell('نرخی کڕینی تێکڕا', product.avg_cost === null || product.avg_cost === undefined ? '—' : money(product.avg_cost)),
        kvCell('ژمارەی جووڵەکان', money(count))),
      table.el,
      canVoid ? h('p', { class: 'muted' }, 'تەنها دوایین هاتن دەتوانرێت هەڵبوەشێنرێتەوە، ئەویش ئەگەر دوای ئەو هیچ فرۆشتن یان گۆڕانکارییەک نەبووبێت.') : null);
  }

  async function voidIt(row) {
    const ok = await confirmDialog({ title: 'هەڵوەشاندنەوەی هاتن', message: `هاتنی ${money(row.qty_change)} دانە و بەهای ${money(row.value_change)} دینار هەڵدەوەشێتەوە و لە کۆگا کەم دەکرێتەوە. دڵنیایت؟`, confirmText: 'بەڵێ، هەڵیبوەشێنەوە', danger: true });
    if (!ok) return;
    try {
      const fresh = await api.rpc('void_purchase', { p_purchase_id: row.ref_id });
      toast('هاتنەکە هەڵوەشێنرایەوە.');
      Object.assign(product, fresh);
      onChanged && onChanged(fresh);
      load();
    } catch (e) {
      toast(errText(e), 'err', 7000);
    }
  }
  load();
  return m;
}

function kvCell(label, value) {
  return h('div', { class: 'kv-grid__cell' }, h('span', null, label), h('strong', { class: 'num' }, value));
}
