// People who can sign in: cashiers and admins.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, field, textInput, selectBox, checkbox, ledger, badge, loading, mount, openModal, openMenu, confirmDialog, emptyState } from '../ui.js';
import { money, relativeDay } from '../fmt.js';
import { errText, ROLE } from '../i18n.js';
import { pageHead } from '../pagekit.js';

const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function randomPassword(n = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export default async function users(root, ctx) {
  const me = ctx.state.profile;
  let list = [];

  const isPending = (u) => !u.active && !u.approved_at;
  const statusBadge = (u) => (u.active ? badge('چالاک', 'ok') : isPending(u) ? badge('چاوەڕێی پەسەندکردن', 'warn') : badge('ناچالاک', 'neutral'));

  const notice = h('div');
  const table = ledger({
    cards: true,
    rowKey: (u) => u.id,
    defaultSort: { key: 'created_at', dir: 'asc' },
    empty: 'هیچ بەکارهێنەرێک نییە.',
    onRowClick: (u) => edit(u),
    columns: [
      { key: 'full_name', label: 'کەس', sort: true, value: (u) => u.full_name || u.username, render: (u) => h('div', { class: 'pname' }, h('strong', { class: 'pname__n' }, u.full_name || u.username, u.id === me.id ? h('span', { class: 'muted' }, ' (تۆ)') : null), h('span', { class: 'sub code-sub' }, u.username)) },
      { key: 'role', label: 'ڕۆڵ', sort: true, render: (u) => badge(ROLE[u.role], u.role === 'admin' ? 'dark' : 'neutral') },
      { key: 'active', label: 'دۆخ', render: (u) => statusBadge(u) },
      { key: 'last_sign_in_at', label: 'دوایین چوونەژوورەوە', sort: true, className: 'col-opt', value: (u) => (u.last_sign_in_at ? Date.parse(u.last_sign_in_at) : 0), render: (u) => (u.last_sign_in_at ? relativeDay(u.last_sign_in_at) : h('span', { class: 'muted' }, 'هەرگیز')) },
      { key: 'sales_count', label: 'ژمارەی وەسڵ', num: true, sort: true, className: 'col-opt' },
      { key: 'act', label: '', className: 'col-act', render: (u) => actions(u) },
    ],
  });

  function actions(u) {
    const more = h('button', { class: 'icon-btn', type: 'button', 'aria-label': `زیاتر بۆ ${u.full_name || u.username}`, 'aria-haspopup': 'menu', onclick: (e) => {
      e.stopPropagation();
      openMenu(more, [
        { label: 'دەستکاریکردن', icon: 'edit', onClick: () => edit(u) },
        { label: 'گۆڕینی وشەی نهێنی', icon: 'key', onClick: () => resetPassword(u) },
        ...(u.id === me.id ? [] : ['sep', { label: 'سڕینەوە', icon: 'trash', danger: true, onClick: () => remove(u) }]),
      ]);
    } }, icon('more', 20));
    return h('span', { class: 'row-actions' },
      isPending(u) ? button('پەسەندکردن', { size: 'sm', variant: 'primary', icon: 'check', onClick: (e) => { e.stopPropagation(); approve(u); } }) : null,
      more);
  }

  async function load() {
    list = await api.rpc('list_staff');
    paint();
  }
  function paint() {
    const pending = list.filter(isPending);
    mount(notice, pending.length ? h('div', { class: 'note note--warn' }, icon('alert', 18), h('span', null, `${money(pending.length)} هەژمار چاوەڕێی پەسەندکردنن (${pending.map((u) => u.full_name || u.username).join('، ')}). ئەگەر نایانناسیت، بیانسڕەوە.`)) : '');
    table.update(list);
  }

  async function approve(u) {
    try {
      await api.rpc('update_staff', { p_id: u.id, p_full_name: u.full_name, p_role: 'cashier', p_active: true });
      toast(`«${u.full_name || u.username}» پەسەند کرا و دەتوانێت بفرۆشێت.`);
      await load();
    } catch (e) {
      toast(errText(e), 'err');
    }
  }

  /* ---------- add ---------- */
  function addUser() {
    const name = textInput({ maxlength: 80, placeholder: 'بۆ نموونە: سارا ئەحمەد' });
    const login = textInput({ dir: 'ltr', maxlength: 40, placeholder: 'sara', autocomplete: 'off' });
    login.setAttribute('autocapitalize', 'none');
    const pass = textInput({ dir: 'ltr', maxlength: 72, value: randomPassword(), autocomplete: 'new-password' });
    const role = selectBox({ options: [{ value: 'cashier', label: 'کاشێر — تەنها دەفرۆشێت' }, { value: 'admin', label: 'ئادمین — هەموو دەسەڵاتێک' }], value: 'cashier' });
    const fName = field('ناوی کەسەکە', name, { required: true });
    const fLogin = field('ناوی بەکارهێنەر', login, { required: true, hint: 'پیتی ئینگلیزی و ژمارە، بۆ نموونە sara. بۆ چوونەژوورەوە بەکاردێت.' });
    const fPass = field('وشەی نهێنی', pass, { required: true, hint: 'لانی کەم 6 پیت. دەتوانیت ئەمەی خۆکار دروستکراو بەکاربهێنیت.' });
    const fRole = field('دەسەڵات', role);
    const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
    const regen = button('نوێ', { size: 'sm', variant: 'quiet', icon: 'refresh', onClick: () => { pass.value = randomPassword(); } });
    const save = button('دروستکردن', { icon: 'plus', onClick: () => withBusy(save, run) });
    const m = openModal({
      title: 'بەکارهێنەری نوێ',
      size: 'md',
      content: h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } },
        err, fName, fLogin, h('div', { class: 'passrow' }, fPass, regen), fRole, h('input', { type: 'submit', hidden: true })),
      footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
    });
    async function run() {
      [fName, fLogin, fPass].forEach((f) => f.setError(''));
      err.hidden = true;
      const full = name.value.trim();
      const lg = login.value.trim().toLowerCase();
      let bad = false;
      if (!full) { fName.setError('ناوەکە بنووسە.'); bad = true; }
      if (!LOGIN_RE.test(lg) && !EMAIL_RE.test(lg)) { fLogin.setError('تەنها پیتی ئینگلیزی و ژمارە (لانی کەم 3).'); bad = true; }
      if (pass.value.length < 6) { fPass.setError('وشەی نهێنی دەبێت لانی کەم 6 پیت بێت.'); bad = true; }
      if (bad) return;
      let created;
      try {
        created = await api.signUp(lg, pass.value, { full_name: full });
      } catch (e) {
        if (e.key === 'USER_ALREADY_EXISTS' || e.key === 'EMAIL_EXISTS') fLogin.setError(errText(e));
        else { err.replaceChildren(icon('alert', 18), h('span', null, errText(e))); err.hidden = false; }
        return;
      }
      try {
        if (!created.id) throw Object.assign(new Error('NO_ID'), { key: 'UNEXPECTED_FAILURE' });
        await api.rpc('update_staff', { p_id: created.id, p_full_name: full, p_role: role.value, p_active: true });
      } catch (e) {
        err.replaceChildren(icon('alert', 18), h('span', null, `هەژمارەکە دروست کرا بەڵام چالاک نەکرا: ${errText(e)} — لە لیستەکە «پەسەندکردن» بکە.`));
        err.hidden = false;
        await load().catch(() => {});
        return;
      }
      m.close();
      await load().catch(() => {});
      showCredentials({ name: full, login: lg, password: pass.value, confirmOff: !!created.session });
    }
  }

  function showCredentials({ name, login, password, confirmOff }) {
    const row = (k, v) => h('div', { class: 'cred__row' }, h('span', null, k), h('strong', { class: 'code' }, v));
    const text = `ناوی بەکارهێنەر: ${login}\nوشەی نهێنی: ${password}`;
    const m = openModal({
      title: 'هەژمارەکە دروست کرا',
      size: 'sm',
      content: [
        h('p', { class: 'modal__text' }, `«${name}» ئێستا دەتوانێت بچێتە ژوورەوە. ئەم زانیارییانە بدە بە خۆی؛ وشەی نهێنی دواتر نابینرێتەوە.`),
        h('div', { class: 'cred' }, row('ناوی بەکارهێنەر', login), row('وشەی نهێنی', password)),
        confirmOff ? null : h('div', { class: 'note note--warn' }, icon('alert', 18), h('span', null, 'Supabase داوای پشتڕاستکردنەوەی ئیمەیڵ دەکات، بۆیە ئەم کەسە ناتوانێت بچێتە ژوورەوە. لە Authentication ← Sign In / Providers ← Email دەبێت "Confirm email" بکوژێنیتەوە.')),
      ],
      footer: [
        button('کۆپیکردن', { icon: 'receipt', variant: 'primary', onClick: async () => toast((await copyText(text)) ? 'کۆپی کرا.' : 'کۆپی نەکرا — بە دەست بینووسە.', 'info') }),
        button('داخستن', { variant: 'ghost', onClick: () => m.close() }),
      ],
    });
  }

  /* ---------- edit ---------- */
  function edit(u) {
    const self = u.id === me.id;
    const name = textInput({ value: u.full_name || '', maxlength: 80 });
    const role = selectBox({ options: [{ value: 'cashier', label: 'کاشێر — تەنها دەفرۆشێت' }, { value: 'admin', label: 'ئادمین — هەموو دەسەڵاتێک' }], value: u.role });
    role.disabled = self;
    const active = checkbox({ label: 'دەتوانێت بچێتە ژوورەوە', checked: u.active, hint: self ? 'ناتوانیت هەژماری خۆت ناچالاک بکەیت.' : 'ئەگەر لایبەیت، ئیتر ناتوانێت بچێتە ژوورەوە بەڵام فرۆشتنەکانی دەمێنن.' });
    active.input.disabled = self;
    const fName = field('ناو', name, { required: true });
    const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
    const save = button('پاشەکەوتکردن', { icon: 'check', onClick: () => withBusy(save, run) });
    const m = openModal({
      title: 'دەستکاریکردنی بەکارهێنەر',
      size: 'sm',
      content: h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } },
        h('div', { class: 'kv' }, h('div', null, h('span', { class: 'kv__k' }, 'ناوی بەکارهێنەر'), h('strong', { class: 'code' }, u.username))),
        err, fName, field('دەسەڵات', role), active, h('input', { type: 'submit', hidden: true })),
      footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
    });
    async function run() {
      fName.setError('');
      err.hidden = true;
      if (!name.value.trim()) { fName.setError('ناوەکە بنووسە.'); return; }
      try {
        await api.rpc('update_staff', { p_id: u.id, p_full_name: name.value.trim(), p_role: role.value, p_active: active.input.checked });
        toast('پاشەکەوت کرا.');
        m.close();
        await load();
      } catch (e) {
        err.replaceChildren(icon('alert', 18), h('span', null, errText(e)));
        err.hidden = false;
      }
    }
  }

  /* ---------- password ---------- */
  function resetPassword(u) {
    const pass = textInput({ dir: 'ltr', maxlength: 72, value: randomPassword(), autocomplete: 'new-password' });
    const fPass = field('وشەی نهێنی نوێ', pass, { required: true, hint: 'لانی کەم 6 پیت.' });
    const regen = button('نوێ', { size: 'sm', variant: 'quiet', icon: 'refresh', onClick: () => { pass.value = randomPassword(); } });
    const err = h('div', { class: 'note note--bad', role: 'alert', hidden: true });
    const save = button('گۆڕین', { icon: 'key', onClick: () => withBusy(save, run) });
    const m = openModal({
      title: `وشەی نهێنی «${u.full_name || u.username}»`,
      size: 'sm',
      content: h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } }, err, h('div', { class: 'passrow' }, fPass, regen), h('input', { type: 'submit', hidden: true })),
      footer: [save, button('پاشگەزبوونەوە', { variant: 'ghost', onClick: () => m.close() })],
    });
    async function run() {
      fPass.setError('');
      err.hidden = true;
      if (pass.value.length < 6) { fPass.setError('وشەی نهێنی دەبێت لانی کەم 6 پیت بێت.'); return; }
      try {
        await api.rpc('admin_set_password', { p_id: u.id, p_password: pass.value });
        m.close();
        showCredentials({ name: u.full_name || u.username, login: u.username, password: pass.value, confirmOff: true });
      } catch (e) {
        err.replaceChildren(icon('alert', 18), h('span', null, errText(e)));
        err.hidden = false;
      }
    }
  }

  async function remove(u) {
    const ok = await confirmDialog({ title: 'سڕینەوەی بەکارهێنەر', message: `هەژماری «${u.full_name || u.username}» دەسڕدرێتەوە. ئەگەر فرۆشتنی تۆمارکراوی هەبێت ناسڕدرێتەوە و دەبێت ناچالاکی بکەیت.`, confirmText: 'بەڵێ، بیسڕەوە', danger: true });
    if (!ok) return;
    try {
      await api.rpc('delete_staff', { p_id: u.id });
      toast('سڕایەوە.');
      await load();
    } catch (e) {
      toast(errText(e), 'err', 7000);
    }
  }

  const addBtn = button('بەکارهێنەری نوێ', { icon: 'plus', onClick: addUser });
  const wrap = h('div', { class: 'stack' }, loading());
  mount(root, h('div', { class: 'page' },
    pageHead({ title: 'بەکارهێنەران', sub: 'ئەو کەسانەی دەتوانن بچنە ژوورەوە — کاشێر تەنها دەفرۆشێت، ئادمین هەموو شتێک دەکات', actions: [addBtn] }),
    notice,
    wrap));
  try {
    await load();
    wrap.replaceChildren(table.el);
  } catch (e) {
    wrap.replaceChildren(emptyState({ icon: 'alert', title: errText(e), action: button('دووبارە هەوڵبدەرەوە', { icon: 'refresh', onClick: () => ctx.go('users') }) }));
  }
}
