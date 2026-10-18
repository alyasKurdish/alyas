// Small UI toolkit: element builder, icons, dialogs, toasts, form controls, ledger tables.
// Data is always inserted with textContent (never innerHTML), so a product called "<b>x</b>" is just text.
import { toLatinDigits, parseInteger, money, debounce } from './fmt.js';

/* ================= element builder ================= */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || sv === undefined) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, sv); // CSS custom properties need setProperty
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function mount(el, ...kids) {
  el.replaceChildren();
  return append(el, kids);
}

/* ================= icons ================= */
const SVGNS = 'http://www.w3.org/2000/svg';
const ICONS = {
  sale: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 7H6"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  stock: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12 9.5 5 9.5-5"/><path d="m2.5 16 9.5 5 9.5-5"/>',
  report: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M9 7V4h6v3"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.7C3.8 8.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  barcode: '<path d="M4 5v14M7.5 5v14M11 5v14M14 5v10M17 5v14M20 5v14"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  arrivals: '<path d="M12 3v11m0 0 4-4m-4 4-4-4"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
};
export function icon(name, size = 20) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ic');
  s.innerHTML = ICONS[name] || ''; // static strings above, never data
  return s;
}
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

/* ================= toasts ================= */
export function toast(message, type = 'ok', ms) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast toast--${type}`, role: type === 'err' ? 'alert' : 'status' },
    icon(type === 'err' ? 'alert' : type === 'info' ? 'info' : 'check', 18),
    h('span', { class: 'toast__text' }, message));
  box.append(t);
  const life = ms ?? (type === 'err' ? 7000 : 3500);
  const gone = () => {
    t.classList.add('is-leaving');
    setTimeout(() => t.remove(), 250);
  };
  const timer = setTimeout(gone, life);
  t.addEventListener('click', () => {
    clearTimeout(timer);
    gone();
  });
  while (box.children.length > 4) box.firstChild.remove();
}

/* ================= dialogs ================= */
const stack = [];
export function openModal({ title, content, footer, size = 'md', dismissible = true, onClose, className = '' }) {
  const restore = document.activeElement;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const titleId = `m${Math.random().toString(36).slice(2, 8)}`;
  const titleEl = h('h2', { class: 'modal__title', id: titleId }, title);
  const closeBtn = dismissible ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'داخستن', onclick: () => api.close() }, icon('x', 20)) : null;
  const body = h('div', { class: 'modal__body' }, content);
  const foot = footer ? h('footer', { class: 'modal__foot' }, footer) : null;
  const dlg = h('div', { class: `modal modal--${size} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', { class: 'modal__head' }, titleEl, closeBtn), body, foot);
  backdrop.append(dlg);
  let closed = false;
  const api = {
    el: dlg,
    body,
    footer: foot,
    setTitle: (t) => (titleEl.textContent = t),
    close(result) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      backdrop.remove();
      if (!stack.length) document.documentElement.classList.remove('has-modal');
      document.removeEventListener('keydown', onKey, true);
      if (restore && restore.focus && document.contains(restore)) restore.focus();
      if (onClose) onClose(result);
    },
  };
  function onKey(e) {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      api.close();
    } else if (e.key === 'Tab') {
      const f = focusable(dlg);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissible) api.close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  document.documentElement.classList.add('has-modal');
  stack.push(api);
  requestAnimationFrame(() => {
    const target = dlg.querySelector('[autofocus]') || dlg.querySelector('input:not([type=hidden]), select, textarea') || dlg.querySelector('.btn--primary, .btn--cta') || closeBtn;
    if (target) target.focus();
  });
  return api;
}
function focusable(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null);
}

export function confirmDialog({ title, message, confirmText = 'بەڵێ', cancelText = 'نەخێر', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title,
      size: 'sm',
      content: h('p', { class: 'modal__text' }, message),
      footer: [
        h('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', onclick: () => { answer = true; m.close(); } }, confirmText),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => m.close() }, cancelText),
      ],
      onClose: () => resolve(answer),
    });
  });
}

/* ================= buttons ================= */
export function button(label, { variant = 'primary', icon: ic, onClick, type = 'button', size, title, disabled, className = '' } = {}) {
  const b = h('button', { class: `btn btn--${variant} ${size ? `btn--${size}` : ''} ${className}`, type, title, disabled, 'aria-label': title }, ic ? icon(ic, 18) : null, label ? h('span', null, label) : null);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
/** runs fn while the button shows a spinner and cannot be pressed twice */
export async function withBusy(btn, fn) {
  if (btn.classList.contains('is-busy')) return undefined;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
}

/* ================= form controls ================= */
let uid = 0;
export function field(label, control, { hint, error, required, className = '' } = {}) {
  const id = control.id || `f${++uid}`;
  if (control.tagName === 'INPUT' || control.tagName === 'SELECT' || control.tagName === 'TEXTAREA') control.id = id;
  const err = h('div', { class: 'field__error', role: 'alert' }, error || '');
  err.hidden = !error;
  const f = h('div', { class: `field ${className}` },
    h('label', { class: 'field__label', for: id }, label, required ? h('span', { class: 'field__req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('div', { class: 'field__hint' }, hint) : null,
    err);
  f.setError = (m) => {
    err.textContent = m || '';
    err.hidden = !m;
    control.classList.toggle('is-invalid', !!m);
  };
  return f;
}
export function textInput({ value = '', placeholder, type = 'text', maxlength, autocomplete = 'off', dir, name, className = '', required } = {}) {
  return h('input', { class: `input ${className}`, type, value, placeholder, maxlength, autocomplete, dir, name, required, spellcheck: 'false' });
}
export function textArea({ value = '', placeholder, rows = 3, maxlength } = {}) {
  return h('textarea', { class: 'input input--area', value, placeholder, rows, maxlength });
}
function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function liveFormat(el, grouped, allowNegative) {
  const raw = toLatinDigits(el.value);
  const caret = el.selectionStart ?? raw.length;
  const before = (raw.slice(0, caret).match(/\d/g) || []).length;
  const neg = allowNegative && raw.trim().startsWith('-');
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const out = (neg ? '-' : '') + (grouped ? groupThousands(digits) : digits);
  if (out !== el.value) el.value = out;
  let pos = 0;
  let seen = 0;
  while (pos < out.length && seen < before) if (/\d/.test(out[pos++])) seen++;
  try {
    el.setSelectionRange(pos, pos);
  } catch { /* some input types refuse selection */ }
}
/** Whole-number field. Accepts ٠١٢٣ and ۰۱۲۳, shows 125,000, returns 125000 from getValue(). */
export function numberInput({ value = null, placeholder = '0', grouped = true, allowNegative = false, className = '', onInput, max } = {}) {
  const el = h('input', { class: `input input--num ${className}`, type: 'text', inputmode: allowNegative ? 'text' : 'numeric', autocomplete: 'off', dir: 'ltr', placeholder, spellcheck: 'false' });
  el.value = value === null || value === undefined ? '' : grouped ? groupThousands(String(Math.abs(value))).replace(/^/, value < 0 ? '-' : '') : String(value);
  el.getValue = () => (el.value.trim() === '' ? null : parseInteger(el.value));
  el.setValue = (n) => {
    el.value = n === null || n === undefined ? '' : String(n);
    liveFormat(el, grouped, allowNegative);
  };
  el.addEventListener('input', () => {
    liveFormat(el, grouped, allowNegative);
    if (max !== undefined && el.getValue() > max) el.setValue(max);
    if (onInput) onInput(el.getValue());
  });
  el.addEventListener('focus', () => setTimeout(() => el.select && el.select(), 0));
  return el;
}
export function selectBox({ options, value, className = '', onChange } = {}) {
  const s = h('select', { class: `input input--select ${className}` }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}
export function checkbox({ label, checked = false, onChange, hint }) {
  const input = h('input', { type: 'checkbox', checked, class: 'check__box' });
  input.addEventListener('change', () => onChange && onChange(input.checked));
  const el = h('label', { class: 'check' }, input, h('span', { class: 'check__label' }, label, hint ? h('small', { class: 'check__hint' }, hint) : null));
  el.input = input;
  return el;
}
/** segmented control: options [{value,label}] */
export function segmented({ options, value, onChange, label, className = '' }) {
  const el = h('div', { class: `seg ${className}`, role: 'group', 'aria-label': label });
  let current = value;
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', class: `seg__btn${o.value === current ? ' is-on' : ''}`, 'aria-pressed': String(o.value === current), dataset: { value: o.value }, onclick: () => set(o.value, true) }, o.label);
    return b;
  });
  el.append(...btns);
  function set(v, fire) {
    current = v;
    btns.forEach((b) => {
      const on = b.dataset.value === String(v);
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (fire && onChange) onChange(v);
  }
  el.set = (v) => set(v, false);
  el.get = () => current;
  return el;
}
export function searchBox({ placeholder = 'گەڕان...', onInput, value = '', delay = 180, autofocus = false } = {}) {
  const input = h('input', { class: 'search__input', type: 'search', placeholder, value, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder, autofocus });
  const fire = debounce(() => onInput && onInput(input.value), delay);
  input.addEventListener('input', fire);
  const el = h('label', { class: 'search' }, icon('search', 18), input);
  el.input = input;
  return el;
}

/* ================= small pieces ================= */
export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge--${tone}` }, text);
}
/** a number that always reads left-to-right, even inside Kurdish text */
export function num(n, { unit = false, tone } = {}) {
  const el = h('span', { class: `num${tone ? ` num--${tone}` : ''}` }, money(n));
  return unit ? h('span', { class: 'num-unit' }, el, h('span', { class: 'unit' }, ' دینار')) : el;
}
export function signed(n) {
  return h('span', { class: `num${n < 0 ? ' num--neg' : ''}` }, money(n));
}
export function loading(text = 'چاوەڕێ بکە...') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner' }), h('span', null, text));
}
export function emptyState({ icon: ic = 'box', title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty__icon' }, icon(ic, 28)), h('h3', { class: 'empty__title' }, title), text ? h('p', { class: 'empty__text' }, text) : null, action || null);
}
export function errorState(message, retry) {
  return h('div', { class: 'empty empty--err' }, h('div', { class: 'empty__icon' }, icon('alert', 28)), h('h3', { class: 'empty__title' }, message), retry ? button('دووبارە هەوڵبدەرەوە', { variant: 'ghost', icon: 'refresh', onClick: retry }) : null);
}

/* ================= ledger table ================= */
/**
 * columns: [{ key, label, num, align, width, sort: true|fn, value(row), render(row) -> node|string, className }]
 * Returns { el, update(rows) }.
 */
export function ledger({ columns, rowKey = (r) => r.id, onRowClick, empty, footer, defaultSort, dense = false, caption, cards = false }) {
  let rows = [];
  let sortKey = defaultSort ? defaultSort.key : null;
  let sortDir = defaultSort ? defaultSort.dir : 'desc';
  const thead = h('thead');
  const tbody = h('tbody');
  const tfoot = h('tfoot');
  const table = h('table', { class: `ledger${dense ? ' ledger--dense' : ''}${cards ? ' ledger--cards' : ''}` }, caption ? h('caption', { class: 'sr-only' }, caption) : null, thead, tbody, tfoot);
  const wrap = h('div', { class: 'ledger-wrap' }, table);
  const val = (c, r) => (c.value ? c.value(r) : r[c.key]);

  function head() {
    thead.replaceChildren(
      h('tr', null, columns.map((c) => {
        const sortable = !!c.sort;
        const th = h('th', { class: `${c.num ? 'is-num' : ''} ${c.className || ''}`, style: c.width ? { width: c.width } : null, scope: 'col', 'aria-sort': sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : null });
        if (sortable) {
          th.append(h('button', { type: 'button', class: `th-btn${sortKey === c.key ? ' is-sorted' : ''}`, onclick: () => {
            if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortKey = c.key; sortDir = c.num ? 'desc' : 'asc'; }
            head();
            body();
          } }, c.label, h('span', { class: 'th-arrow', 'aria-hidden': 'true' }, sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '')));
        } else th.append(c.label);
        return th;
      })));
  }
  const collator = new Intl.Collator(['ckb', 'ar', 'en'], { numeric: true, sensitivity: 'base' });
  function sorted() {
    if (!sortKey) return rows;
    const c = columns.find((x) => x.key === sortKey);
    if (!c) return rows;
    const cmp = typeof c.sort === 'function' ? c.sort : (a, b) => {
      const x = val(c, a); const y = val(c, b);
      if (x === y) return 0;
      if (x === null || x === undefined) return -1;
      if (y === null || y === undefined) return 1;
      return typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
    };
    const out = [...rows].sort(cmp);
    return sortDir === 'asc' ? out : out.reverse();
  }
  function body() {
    const data = sorted();
    if (!data.length) {
      tbody.replaceChildren(h('tr', { class: 'ledger__empty' }, h('td', { colspan: columns.length }, empty || 'هیچ تۆمارێک نییە')));
    } else {
      tbody.replaceChildren(...data.map((r) => {
        const tr = h('tr', { class: onRowClick ? 'is-click' : '', tabindex: onRowClick ? 0 : null, dataset: { id: rowKey(r) } },
          columns.map((c) => {
            const content = c.render ? c.render(r) : val(c, r);
            return h('td', { class: `${c.num ? 'is-num' : ''} ${c.className || ''}`, dataset: { label: typeof c.label === 'string' ? c.label : '' } }, c.num && !(content instanceof Node) ? h('span', { class: 'num' }, content === null || content === undefined ? '—' : typeof content === 'number' ? money(content) : content) : content);
          }));
        if (onRowClick) {
          tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, label')) onRowClick(r); });
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === tr) onRowClick(r); });
        }
        return tr;
      }));
    }
    if (footer && data.length) {
      const f = footer(data) || {};
      tfoot.replaceChildren(h('tr', null, columns.map((c, i) => h('td', { class: `${c.num ? 'is-num' : ''} ${c.className || ''}` }, f[c.key] !== undefined ? (c.num && typeof f[c.key] === 'number' ? h('span', { class: 'num' }, money(f[c.key])) : f[c.key]) : (i === 0 ? 'کۆی گشتی' : '')))));
    } else tfoot.replaceChildren();
  }
  head();
  body();
  return {
    el: wrap,
    update(next) {
      rows = next || [];
      body();
    },
  };
}

/* ================= pop-up menu ================= */
let openMenuState = null;
export function closeMenu() {
  if (!openMenuState) return;
  const { menu, anchor, off } = openMenuState;
  openMenuState = null;
  off();
  menu.remove();
  if (anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
}
/** items: [{ label, icon, onClick, danger }] or the string 'sep' */
export function openMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu', style: { position: 'fixed', visibility: 'hidden' } },
    items.map((it) => (it === 'sep' ? h('div', { class: 'menu__sep' }) : h('button', {
      class: `menu__item${it.danger ? ' menu__item--danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        closeMenu();
        it.onClick();
      },
    }, it.icon ? icon(it.icon, 18) : null, it.label))));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 4;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';
  menu.style.zIndex = '150';
  const btns = [...menu.querySelectorAll('.menu__item')];
  const onDown = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
    } else if (e.key === 'Tab') {
      closeMenu();
    }
  };
  const onScroll = () => closeMenu();
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onScroll);
  window.addEventListener('scroll', onScroll, true);
  const off = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onScroll);
    window.removeEventListener('scroll', onScroll, true);
  };
  openMenuState = { menu, anchor, off };
  if (btns[0]) btns[0].focus();
  return menu;
}

/* ================= printing ================= */
export function printNode(node) {
  const root = document.getElementById('print-root');
  root.replaceChildren(node);
  const done = () => {
    root.replaceChildren();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
