// Boot, shell, router.
import * as api from './api.js';
import { h, mount, icon, toast, openModal, confirmDialog, field, textInput, withBusy, button, loading, errorState } from './ui.js';
import { errText, ROLE } from './i18n.js';
import { showLogin } from './pages/login.js';

const app = document.getElementById('app');
export const state = { profile: null, settings: null };

/* name, label, icon, who may open it, loader */
const ROUTES = [
  { id: 'dashboard', title: 'داشبۆرد', icon: 'dashboard', roles: ['admin'], load: () => import('./pages/dashboard.js') },
  { id: 'pos', title: 'فرۆشتن', icon: 'sale', roles: ['admin', 'cashier'], load: () => import('./pages/pos.js') },
  { id: 'sales', title: 'وەسڵەکان', cashierTitle: 'وەسڵەکانم', icon: 'receipt', roles: ['admin', 'cashier'], load: () => import('./pages/sales.js') },
  { id: 'products', title: 'کاڵاکان', icon: 'box', roles: ['admin'], load: () => import('./pages/products.js') },
  { id: 'inventory', title: 'کۆگا', icon: 'stock', roles: ['admin'], load: () => import('./pages/inventory.js') },
  { id: 'reports', title: 'ڕاپۆرتەکان', icon: 'report', roles: ['admin'], load: () => import('./pages/reports.js') },
  { sep: true, roles: ['admin'] },
  { id: 'users', title: 'بەکارهێنەران', icon: 'users', roles: ['admin'], load: () => import('./pages/users.js') },
  { id: 'settings', title: 'ڕێکخستنەکان', icon: 'settings', roles: ['admin'], load: () => import('./pages/settings.js') },
];
const defaultRoute = () => (state.profile && state.profile.role === 'admin' ? 'dashboard' : 'pos');
const routeTitle = (r) => (state.profile.role === 'cashier' && r.cashierTitle ? r.cashierTitle : r.title);

let shell = null; // { root, view, nav, ... }
let cleanup = null;
let routeToken = 0;

/* ================= boot ================= */
async function boot() {
  if (!api.configured()) return showSetupHelp();
  if (!api.isSignedIn()) return showLoggedOut();
  try {
    await loadSession();
    startApp();
  } catch (e) {
    if (e.key === 'SESSION_EXPIRED') return showLoggedOut(errText(e));
    if (e.isNetwork) return showOffline(e);
    showFatal(e);
  }
}

async function loadSession() {
  const profile = await api.rpc('my_profile');
  if (!profile) throw Object.assign(new Error('NO_PROFILE'), { key: 'NO_PROFILE' });
  state.profile = profile;
  if (profile.active) await refreshSettings();
}
export async function refreshSettings() {
  state.settings = await api.rpc('get_settings');
  try {
    localStorage.setItem('zp.shop', state.settings.shop_name);
  } catch { /* ignore */ }
  const brand = document.getElementById('brandName');
  if (brand) brand.textContent = state.settings.shop_name;
  return state.settings;
}

function showSetupHelp() {
  const missing = api.configIssues();
  mount(app, h('div', { class: 'boot' }, h('div', { class: 'boot__card' },
    h('h1', { class: 'login__title' }, 'پەیوەندی بە Supabase ڕێکنەخراوە'),
    h('p', null, 'فایلی ', h('span', { class: 'code' }, 'config.js'), ' بکەرەوە و ئەم ڕێکخستنانە بنووسە:'),
    h('ul', { class: 'boot__list' }, missing.map((k) => h('li', null, h('span', { class: 'code' }, k)))),
    h('p', { class: 'muted' }, 'هەنگاوەکان لە فایلی ', h('span', { class: 'code' }, 'README.md'), ' ڕوونکراونەتەوە.'))));
}
function showOffline(e) {
  mount(app, h('div', { class: 'boot' }, h('div', { class: 'boot__card' },
    h('h1', { class: 'login__title' }, 'پەیوەندی نییە'),
    h('p', null, errText(e)),
    button('دووبارە هەوڵبدەرەوە', { icon: 'refresh', onClick: () => boot() }))));
}
function showFatal(e) {
  const noProfile = e.key === 'NO_PROFILE';
  mount(app, h('div', { class: 'boot' }, h('div', { class: 'boot__card' },
    h('h1', { class: 'login__title' }, noProfile ? 'هەژمارەکەت ئامادە نییە' : 'هەڵەیەک ڕوویدا'),
    h('p', null, noProfile ? 'ئەم هەژمارە لە سیستەمدا تۆمار نەکراوە. داوا لە ئادمین بکە.' : errText(e)),
    h('div', { style: { display: 'flex', gap: '10px' } },
      button('دووبارە هەوڵبدەرەوە', { icon: 'refresh', onClick: () => boot() }),
      button('چوونەدەرەوە', { variant: 'ghost', icon: 'logout', onClick: () => logout() })))));
}
function showInactive() {
  mount(app, h('div', { class: 'boot' }, h('div', { class: 'boot__card' },
    h('h1', { class: 'login__title' }, 'هەژمارەکەت چالاک نییە'),
    h('p', null, 'یان ئادمین هێشتا پەسەندی نەکردووە، یان هەژمارەکەی ڕاگرتووە. پەیوەندی بە ئادمین بکە، پاشان «دووبارە پشکنین» بکە.'),
    h('div', { style: { display: 'flex', gap: '10px' } },
      button('دووبارە پشکنین', { icon: 'refresh', onClick: () => boot() }),
      button('چوونەدەرەوە', { variant: 'ghost', icon: 'logout', onClick: () => logout() })))));
}
async function showLoggedOut(notice) {
  state.profile = null;
  state.settings = null;
  shell = null;
  document.title = 'ZERO PHONE — فرۆشتن و کۆگا';
  showLogin(app, {
    notice,
    onSignedIn: () => boot(),
  });
}

/* ================= shell ================= */
function startApp() {
  if (!state.profile.active) return showInactive();
  buildShell();
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
}

function buildShell() {
  const role = state.profile.role;
  const shop = state.settings?.shop_name || 'ZERO PHONE';
  const navItems = ROUTES.filter((r) => r.roles.includes(role));
  const nav = h('nav', { class: 'side__nav', 'aria-label': 'ڕێڕەوەکان' }, navItems.map((r) => (r.sep
    ? h('div', { class: 'nav-sep' })
    : h('a', { class: 'nav-item', href: `#/${r.id}`, dataset: { route: r.id }, onclick: closeNav }, icon(r.icon, 21), h('span', null, routeTitle(r))))));
  const initial = (state.profile.full_name || state.profile.username || '?').trim().charAt(0).toUpperCase();
  const side = h('aside', { class: 'side' },
    h('div', { class: 'side__brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '0'), h('div', { class: 'brand-name' }, h('strong', { id: 'brandName' }, shop), h('small', null, 'سیستەمی فرۆشتن و کۆگا'))),
    nav,
    h('div', { class: 'side__foot' },
      h('button', { class: 'user-chip', type: 'button', onclick: openAccount, title: 'هەژمارەکەم' }, h('span', { class: 'avatar' }, initial), h('span', { class: 'user-chip__text' }, h('strong', null, state.profile.full_name || state.profile.username), h('small', null, ROLE[role]))),
      h('button', { class: 'nav-item nav-item--out', type: 'button', onclick: () => logout() }, icon('logout', 21), h('span', null, 'چوونەدەرەوە'))));
  const topTitle = h('div', { class: 'topbar__title' }, shop);
  const topbar = h('header', { class: 'topbar' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'مێنیو', onclick: () => shellEl.classList.toggle('nav-open') }, icon('menu', 24)), topTitle);
  const view = h('main', { class: 'view', id: 'view', tabindex: '-1' });
  const offline = h('div', { class: 'offline-bar', role: 'status', hidden: navigator.onLine !== false ? true : null }, icon('alert', 18), 'پەیوەندی بە ئینتەرنێت نەماوە — کارەکانت پاشەکەوت ناکرێن تا پەیوەندی دەگەڕێتەوە');
  const shellEl = h('div', { class: 'shell', dataset: { mode: role === 'admin' ? 'full' : 'rail' } },
    side, h('div', { class: 'main' }, topbar, offline, view), h('div', { class: 'side-scrim', onclick: closeNav }));
  mount(app, shellEl);
  window.addEventListener('online', () => (offline.hidden = true));
  window.addEventListener('offline', () => (offline.hidden = false));
  shell = { root: shellEl, view, nav, topTitle };
}
function closeNav() {
  if (shell) shell.root.classList.remove('nav-open');
}

/* ================= router ================= */
export function go(path) {
  if (location.hash === `#/${path}`) route();
  else location.hash = `#/${path}`;
}

async function route() {
  if (!shell || !state.profile) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [id, ...rest] = raw.split('/');
  const wanted = ROUTES.find((r) => r.id === id);
  const allowed = wanted && wanted.roles.includes(state.profile.role);
  if (!allowed) {
    location.replace(`#/${defaultRoute()}`);
    return;
  }
  const token = ++routeToken;
  if (cleanup) {
    try { cleanup(); } catch { /* page cleanup must never block navigation */ }
    cleanup = null;
  }
  shell.nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('is-on', a.dataset.route === id));
  shell.topTitle.textContent = routeTitle(wanted);
  document.title = `${routeTitle(wanted)} — ${state.settings?.shop_name || 'ZERO PHONE'}`;
  closeNav();
  mount(shell.view, loading());
  try {
    const mod = await wanted.load();
    if (token !== routeToken) return;
    const holder = h('div', { class: 'page-holder' });
    mount(shell.view, holder);
    const out = await mod.default(holder, { state, go, sub: rest, title: routeTitle(wanted), refreshSettings });
    if (token !== routeToken) {
      if (typeof out === 'function') out();
      return;
    }
    cleanup = typeof out === 'function' ? out : null;
    window.scrollTo({ top: 0 });
  } catch (e) {
    if (token !== routeToken) return;
    if (e.key === 'SESSION_EXPIRED') return showLoggedOut(errText(e));
    console.error(e);
    mount(shell.view, h('div', { class: 'page' }, errorState(errText(e), () => route())));
  }
}

/* ================= account ================= */
async function logout() {
  if (cleanup) {
    try { cleanup(); } catch { /* ignore */ }
    cleanup = null;
  }
  try { sessionStorage.removeItem('zp.cart.v1'); } catch { /* ignore */ }
  await api.signOut();
  showLoggedOut();
}

function openAccount() {
  const p = state.profile;
  const pw1 = textInput({ type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const pw2 = textInput({ type: 'password', autocomplete: 'new-password', dir: 'ltr' });
  const f1 = field('وشەی نهێنی نوێ', pw1, { hint: 'لانی کەم 6 پیت یان ژمارە' });
  const f2 = field('دووبارەی وشەی نهێنی نوێ', pw2);
  const save = button('گۆڕینی وشەی نهێنی', {
    icon: 'key',
    onClick: () => withBusy(save, async () => {
      f1.setError('');
      f2.setError('');
      if (pw1.value.length < 6) return f1.setError('وشەی نهێنی دەبێت لانی کەم 6 پیت بێت.');
      if (pw1.value !== pw2.value) return f2.setError('دوو وشەی نهێنییەکە وەک یەک نین.');
      try {
        await api.changePassword(pw1.value);
        toast('وشەی نهێنی گۆڕدرا.');
        m.close();
      } catch (e) {
        f1.setError(errText(e));
      }
    }),
  });
  const m = openModal({
    title: 'هەژمارەکەم',
    size: 'sm',
    content: [
      h('div', { class: 'kv' },
        h('div', null, h('span', { class: 'kv__k' }, 'ناو'), h('strong', null, p.full_name || p.username)),
        h('div', null, h('span', { class: 'kv__k' }, 'ناوی بەکارهێنەر'), h('strong', { class: 'code' }, p.username)),
        h('div', null, h('span', { class: 'kv__k' }, 'ڕۆڵ'), h('strong', null, ROLE[p.role]))),
      h('form', { class: 'stack', style: { gap: '14px' }, onsubmit: (e) => { e.preventDefault(); save.click(); } }, f1, f2, h('input', { type: 'submit', hidden: true })),
    ],
    footer: [save, button('داخستن', { variant: 'ghost', onClick: () => m.close() })],
  });
}

/* a session ended in another tab (or expired): go back to the login screen */
api.onSession((s, reason) => {
  if (!s && state.profile && (reason === 'storage' || reason === 'expired')) {
    showLoggedOut(reason === 'expired' ? 'کاتی چوونەژوورەوەکەت تەواو بوو. تکایە دووبارە بچۆ ژوورەوە.' : undefined);
  }
});

boot();
