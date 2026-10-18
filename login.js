// Login, and the one-time "create the first admin" screen.
import * as api from '../api.js';
import { h, mount, icon, field, textInput, button, withBusy, toast } from '../ui.js';
import { errText } from '../i18n.js';

const LAST_USER = 'zp.lastuser';
const remembered = () => {
  try { return localStorage.getItem(LAST_USER) || ''; } catch { return ''; }
};
const shopName = () => {
  try { return localStorage.getItem('zp.shop') || 'ZERO PHONE'; } catch { return 'ZERO PHONE'; }
};

export async function showLogin(root, { notice, onSignedIn }) {
  let setup = false;
  try {
    setup = (await api.rpcPublic('needs_setup')) === true;
  } catch (e) {
    notice = notice || errText(e);
  }
  mount(root, h('div', { class: 'login' }, brandPanel(setup), h('div', { class: 'login__form-wrap' }, setup ? setupForm(onSignedIn) : loginForm({ notice, onSignedIn }))));
  const first = root.querySelector('input:not([type=hidden])');
  if (first) first.focus();
}

function brandPanel(setup) {
  return h('section', { class: 'login__brand' },
    h('span', { class: 'login__ring', 'aria-hidden': 'true' }),
    h('span', { class: 'brand-mark login__mark', 'aria-hidden': 'true' }, '0'),
    h('h1', { class: 'login__shop' }, setup ? 'ZERO PHONE' : shopName()),
    h('p', { class: 'login__tag' }, 'فرۆشتن، کۆگا و قازانج لە یەک شوێن — بۆ فرۆشگای تۆ.'));
}

function passwordField(label, input, opts) {
  const toggle = h('button', { type: 'button', class: 'icon-btn pw__toggle', 'aria-label': 'پیشاندانی وشەی نهێنی', onclick: () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.replaceChildren(icon(show ? 'eyeoff' : 'eye', 20));
  } }, icon('eye', 20));
  return field(label, h('span', { class: 'pw' }, input, toggle), opts);
}

function loginForm({ notice, onSignedIn }) {
  const user = textInput({ value: remembered(), autocomplete: 'username', dir: 'ltr', name: 'username', placeholder: 'ali' });
  user.setAttribute('autocapitalize', 'none');
  const pass = textInput({ type: 'password', autocomplete: 'current-password', dir: 'ltr', name: 'password' });
  const errBox = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
  const showErr = (m) => {
    errBox.replaceChildren(icon('alert', 18), h('span', null, m));
    errBox.hidden = false;
  };
  const submit = button('چوونەژوورەوە', { type: 'submit', size: 'lg', className: 'btn--block' });
  const form = h('form', { class: 'login__form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    errBox.hidden = true;
    if (!user.value.trim() || !pass.value) return showErr('ناوی بەکارهێنەر و وشەی نهێنی بنووسە.');
    withBusy(submit, async () => {
      try {
        await api.signIn(user.value, pass.value);
        try { localStorage.setItem(LAST_USER, user.value.trim()); } catch { /* ignore */ }
        onSignedIn();
      } catch (err) {
        showErr(errText(err));
        pass.select();
      }
    });
  } },
    h('div', null, h('h2', { class: 'login__title' }, 'چوونەژوورەوە'), h('p', { class: 'login__sub' }, 'ناوی بەکارهێنەر و وشەی نهێنی بنووسە')),
    notice ? h('div', { class: 'note note--warn' }, icon('info', 18), h('span', null, notice)) : null,
    errBox,
    field('ناوی بەکارهێنەر', user),
    passwordField('وشەی نهێنی', pass),
    submit);
  return form;
}

function setupForm(onSignedIn) {
  const shop = textInput({ value: 'ZERO PHONE 2' });
  const name = textInput({ placeholder: 'ناوی تەواوی تۆ' });
  const user = textInput({ dir: 'ltr', placeholder: 'admin', autocomplete: 'username' });
  user.setAttribute('autocapitalize', 'none');
  const p1 = textInput({ type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const p2 = textInput({ type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const fShop = field('ناوی فرۆشگا', shop, { required: true });
  const fName = field('ناوی تۆ', name, { required: true });
  const fUser = field('ناوی بەکارهێنەر (ئینگلیزی)', user, { required: true, hint: 'پیتی ئینگلیزی و ژمارە، بۆ نموونە admin' });
  const fP1 = passwordField('وشەی نهێنی', p1, { required: true, hint: 'لانی کەم 6 پیت یان ژمارە' });
  const fP2 = passwordField('دووبارەی وشەی نهێنی', p2, { required: true });
  const errBox = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
  const submit = button('دروستکردنی هەژماری ئادمین', { type: 'submit', size: 'lg', className: 'btn--block' });
  const form = h('form', { class: 'login__form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    errBox.hidden = true;
    [fShop, fName, fUser, fP1, fP2].forEach((f) => f.setError(''));
    const login = user.value.trim().toLowerCase();
    let bad = false;
    if (!shop.value.trim()) { fShop.setError('ناوی فرۆشگا بنووسە.'); bad = true; }
    if (!name.value.trim()) { fName.setError('ناوەکەت بنووسە.'); bad = true; }
    if (!/^[a-z0-9._-]{3,30}$/.test(login) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) { fUser.setError('تەنها پیتی ئینگلیزی و ژمارە (لانی کەم 3).'); bad = true; }
    if (p1.value.length < 6) { fP1.setError('وشەی نهێنی دەبێت لانی کەم 6 پیت بێت.'); bad = true; }
    else if (p1.value !== p2.value) { fP2.setError('دوو وشەی نهێنییەکە وەک یەک نین.'); bad = true; }
    if (bad) return;
    withBusy(submit, async () => {
      try {
        const res = await api.signUp(login, p1.value, { full_name: name.value.trim() });
        if (res.session) api.adoptSession(res.session);
        else await api.signIn(login, p1.value);
        try { await api.rpc('save_settings', { p: { shop_name: shop.value.trim() } }); } catch { /* the name can be changed later in Settings */ }
        toast('هەژماری ئادمین دروست کرا. بەخێربێیت!');
        onSignedIn();
      } catch (err) {
        const hint = err.key === 'INVALID_CREDENTIALS' || err.key === 'EMAIL_NOT_CONFIRMED'
          ? 'هەژمارەکە دروست کرا، بەڵام Supabase داوای پشتڕاستکردنەوەی ئیمەیڵ دەکات. لە Authentication ← Sign In / Providers ← Email دەبێت "Confirm email" بکوژێنیتەوە، پاشان بچۆ ژوورەوە.'
          : errText(err);
        errBox.replaceChildren(icon('alert', 18), h('span', null, hint));
        errBox.hidden = false;
      }
    });
  } },
    h('div', null, h('h2', { class: 'login__title' }, 'دامەزراندنی یەکەمجار'), h('p', { class: 'login__sub' }, 'یەکەم هەژمار دەبێتە ئادمین (خاوەنی فرۆشگا).')),
    errBox, fShop, fName, fUser, fP1, fP2, submit,
    h('p', { class: 'login__alt' }, 'کاشێرەکان دواتر لە بەشی «بەکارهێنەران» زیاد دەکرێن.'));
  return form;
}
