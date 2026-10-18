// Shop details, what cashiers may do, and this computer's printing habit.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, field, textInput, textArea, numberInput, checkbox, mount, loading } from '../ui.js';
import { money } from '../fmt.js';
import { errText } from '../i18n.js';
import { pageHead, panel } from '../pagekit.js';
import { receiptNode, autoPrintOn, setAutoPrint } from '../receipt.js';

export default async function settings(root, ctx) {
  const { state } = ctx;
  const cur = await api.rpc('get_settings');

  const shop = textInput({ value: cur.shop_name, maxlength: 80 });
  const phone = textInput({ value: cur.shop_phone, maxlength: 40, dir: 'ltr' });
  const address = textInput({ value: cur.shop_address, maxlength: 160 });
  const footer = textArea({ value: cur.receipt_footer, rows: 2, maxlength: 200 });
  const pctIn = numberInput({ value: cur.cashier_max_discount_pct, grouped: false, max: 100 });
  const canReturn = checkbox({ label: 'کاشێر دەتوانێت کاڵا بگەڕێنێتەوە', checked: cur.cashier_can_return, hint: 'ئەگەر لایبەیت، تەنها ئادمین دەتوانێت گەڕاندنەوە تۆمار بکات.' });
  const days = numberInput({ value: cur.return_window_days, grouped: false });
  const auto = checkbox({ label: 'دوای هەر فرۆشتنێک وەسڵ خۆکار چاپ بکە', checked: autoPrintOn(), hint: 'تەنها لەم کۆمپیوتەرە/براوزەرە جێبەجێ دەبێت.', onChange: (v) => { setAutoPrint(v); toast(v ? 'چاپی خۆکار چالاک کرا.' : 'چاپی خۆکار ڕاگیرا.', 'info'); } });

  const fShop = field('ناوی فرۆشگا', shop, { required: true, hint: 'لە سەرەوەی وەسڵ و لە لاپەڕەکان پیشان دەدرێت.' });
  const fPct = field('زۆرترین داشکانی کاشێر (%)', pctIn, { hint: '0 = کاشێر نابێت داشکان بکات. ئادمین هەمیشە دەتوانێت.' });
  const fDays = field('ماوەی گەڕاندنەوە (ڕۆژ)', days, { hint: 'کاشێر تەنها وەسڵی ئەم چەند ڕۆژەی دواییە دەتوانێت بگەڕێنێتەوە. ئادمین سنووری نییە.' });
  const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
  const preview = h('div', { class: 'paper-wrap settings__preview' });

  const sample = () => ({
    id: 1024, created_at: new Date().toISOString(), cashier_name: state.profile.full_name || state.profile.username,
    subtotal: 26000, discount: 1000, total: 25000, refunded: 0, note: null,
    items: [
      { id: 1, name: 'کەیسی ئایفۆن 15', qty: 2, unit_price: 8000, line_total: 16000, returned_qty: 0, refunded: 0 },
      { id: 2, name: 'گلاسی پارێزەر', qty: 2, unit_price: 5000, line_total: 10000, returned_qty: 0, refunded: 0 },
    ],
  });
  function drawPreview() {
    mount(preview, receiptNode(sample(), { shop_name: shop.value.trim() || 'ZERO PHONE', shop_phone: phone.value.trim(), shop_address: address.value.trim(), receipt_footer: footer.value.trim() }));
  }
  [shop, phone, address, footer].forEach((el) => el.addEventListener('input', drawPreview));
  drawPreview();

  const save = button('پاشەکەوتکردنی ڕێکخستنەکان', { icon: 'check', onClick: () => withBusy(save, run) });
  async function run() {
    [fShop, fPct, fDays].forEach((f) => f.setError(''));
    err.hidden = true;
    let bad = false;
    if (!shop.value.trim()) { fShop.setError('ناوی فرۆشگا بنووسە.'); bad = true; }
    const p = pctIn.getValue();
    if (p === null || p < 0 || p > 100) { fPct.setError('ژمارەیەک لە 0 تا 100 بنووسە.'); bad = true; }
    const d = days.getValue();
    if (d === null || d < 0 || d > 3650) { fDays.setError('ژمارەیەک لە 0 تا 3650 بنووسە.'); bad = true; }
    if (bad) return;
    try {
      await api.rpc('save_settings', { p: {
        shop_name: shop.value.trim(),
        shop_phone: phone.value.trim(),
        shop_address: address.value.trim(),
        receipt_footer: footer.value.trim(),
        cashier_max_discount_pct: p,
        cashier_can_return: canReturn.input.checked,
        return_window_days: d,
      } });
      await ctx.refreshSettings();
      toast('ڕێکخستنەکان پاشەکەوت کران.');
    } catch (e) {
      err.replaceChildren(icon('alert', 18), h('span', null, errText(e)));
      err.hidden = false;
    }
  }

  mount(root, h('div', { class: 'page page--narrow' },
    pageHead({ title: 'ڕێکخستنەکان', sub: 'زانیاری فرۆشگا و ئەوەی کاشێر دەتوانێت بیکات', actions: [save] }),
    err,
    h('div', { class: 'settings' },
      h('div', { class: 'stack' },
        panel({ title: 'زانیاری فرۆشگا', body: h('div', { class: 'panel__body stack', style: { gap: '14px' } },
          fShop,
          h('div', { class: 'field-row' }, field('ژمارەی تەلەفۆن', phone), field('ناونیشان', address)),
          field('نووسینی کۆتایی وەسڵ', footer, { hint: 'بۆ نموونە: سوپاس بۆ سەردانتان — کاڵای گەڕاو تا 14 ڕۆژ.' })) }),
        panel({ title: 'دەسەڵاتی کاشێر', body: h('div', { class: 'panel__body stack', style: { gap: '14px' } },
          h('div', { class: 'field-row' }, fPct, fDays), canReturn,
          h('p', { class: 'muted' }, 'کاشێر هەرگیز تێچوو و قازانج نابینێت و ناتوانێت نرخ یان کاڵا دەستکاری بکات.')) }),
        panel({ title: 'ئەم کۆمپیوتەرە', body: h('div', { class: 'panel__body' }, auto) }),
        panel({ title: 'پاراستنی داتا', body: h('div', { class: 'panel__body stack', style: { gap: '8px' } },
          h('p', null, 'هەموو داتاکانت لە Supabase هەڵگیراون و لە هەموو ئامێرێکەوە هەمان داتا دەبینرێت.'),
          h('p', { class: 'muted' }, 'پلانی خۆڕایی Supabase پاشەکەوتی خۆکاری دابەزێنراو نییە. بۆیە جارجار لە لاپەڕەی «کاڵاکان» و «ڕاپۆرتەکان» و «وەسڵەکان» دوگمەی «ئێکسپۆرتی CSV» بەکاربهێنە و فایلەکان لە شوێنێکی تر هەڵبگرە.')) })),
      h('aside', { class: 'settings__side' }, h('h2', { class: 'panel__title' }, 'پێشبینینی وەسڵ'), preview))));
}
