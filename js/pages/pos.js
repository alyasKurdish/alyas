// The selling screen: product tiles on one side, the receipt-paper cart on the other.
import * as api from '../api.js';
import { h, icon, button, withBusy, toast, numberInput, searchBox, confirmDialog, emptyState, errorState, loading, mount, badge } from '../ui.js';
import { money, fold, uuid, fmtDay, todayKey } from '../fmt.js';
import { errText } from '../i18n.js';
import { showSaleDone, printReceipt, autoPrintOn } from '../receipt.js';

const CART_KEY = 'zp.cart.v1';
const collator = new Intl.Collator(['ckb', 'ar', 'en'], { numeric: true, sensitivity: 'base' });

export default async function pos(root, ctx) {
  const { state } = ctx;
  const role = state.profile.role;
  const canDiscount = () => role === 'admin' || (state.settings.cashier_max_discount_pct || 0) > 0;

  /* ------------------------------------------------ state */
  let products = [];
  let byId = new Map();
  let cart = new Map(); // product id -> qty (insertion order is the receipt order)
  let discount = 0;
  let note = '';
  let received = null;
  let category = '';
  let query = '';
  let pending = null; // a sale whose answer never arrived: { payload, total }
  let busy = false;
  let loadedAt = 0;
  let disposed = false;

  const persist = () => {
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify({ u: state.profile.id, items: [...cart], discount, note, pending }));
    } catch { /* storage may be blocked: the cart just lives in memory */ }
  };
  const restore = () => {
    try {
      const o = JSON.parse(sessionStorage.getItem(CART_KEY) || 'null');
      if (o && o.u === state.profile.id) {
        cart = new Map((o.items || []).map(([id, q]) => [Number(id), Number(q)]));
        discount = o.discount || 0;
        note = o.note || '';
        pending = o.pending || null;
      }
    } catch { /* ignore a damaged value */ }
  };
  restore();

  const subtotal = () => [...cart].reduce((s, [id, q]) => s + (byId.get(id)?.price || 0) * q, 0);
  const maxDiscount = () => {
    const sub = subtotal();
    if (role === 'admin') return sub;
    return Math.floor((sub * (state.settings.cashier_max_discount_pct || 0)) / 100);
  };
  const total = () => Math.max(0, subtotal() - discount);
  const countItems = () => [...cart.values()].reduce((a, b) => a + b, 0);

  /* ------------------------------------------------ catalogue */
  const search = searchBox({
    placeholder: 'ناو یان بارکۆد بنووسە، یان بارکۆد بخوێنەوە...',
    delay: 120,
    onInput: (v) => {
      query = v;
      renderTiles();
    },
  });
  const searchInput = search.input;
  searchInput.setAttribute('aria-label', 'گەڕان بە ناو یان بارکۆد');
  searchInput.addEventListener('focus', () => setTimeout(() => searchInput.select(), 0));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      scanEnter();
    } else if (e.key === 'Escape') {
      searchInput.value = '';
      query = '';
      renderTiles();
    }
  });
  const refreshBtn = h('button', { class: 'icon-btn', type: 'button', title: 'نوێکردنەوەی لیستی کاڵاکان', 'aria-label': 'نوێکردنەوەی لیستی کاڵاکان', onclick: () => loadProducts(true) }, icon('refresh', 20));
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'پۆلەکان' });
  const tiles = h('div', { class: 'tiles' });
  const catalogMsg = h('div', { class: 'pos__msg' });

  function visibleProducts() {
    const q = fold(query);
    return products.filter((p) => (!category || p.category === category) && (!q || p._hay.includes(q)));
  }

  function renderChips() {
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort(collator.compare);
    if (!cats.length) {
      chips.replaceChildren();
      chips.hidden = true;
      return;
    }
    chips.hidden = false;
    const mk = (value, label) => h('button', { class: `chip${category === value ? ' is-on' : ''}`, type: 'button', 'aria-pressed': String(category === value), onclick: () => { category = value; renderChips(); renderTiles(); } }, label);
    chips.replaceChildren(mk('', 'هەمووی'), ...cats.map((c) => mk(c, c)));
  }

  function renderTiles() {
    const list = visibleProducts();
    catalogMsg.replaceChildren();
    if (!products.length) {
      tiles.replaceChildren();
      mount(catalogMsg, emptyState({
        icon: 'box',
        title: 'هێشتا هیچ کاڵایەک نییە',
        text: role === 'admin' ? 'یەکەم کاڵا زیاد بکە، پاشان لێرە دەردەکەوێت.' : 'داوا لە ئادمین بکە کاڵاکان زیاد بکات.',
        action: role === 'admin' ? h('a', { class: 'btn btn--primary', href: '#/products' }, icon('plus', 18), 'زیادکردنی کاڵا') : null,
      }));
      return;
    }
    if (!list.length) {
      tiles.replaceChildren();
      mount(catalogMsg, emptyState({ icon: 'search', title: 'هیچ کاڵایەک نەدۆزرایەوە', text: 'ناوەکە جیاواز بنووسە یان بارکۆدەکە بپشکنە.' }));
      return;
    }
    tiles.replaceChildren(...list.map(tileFor));
  }

  function tileFor(p) {
    const inCart = cart.get(p.id) || 0;
    const out = p.stock <= 0;
    const low = !out && p.stock <= 3;
    const t = h('button', {
      class: `tile${out ? ' is-out' : ''}${inCart ? ' is-in' : ''}`,
      type: 'button',
      disabled: out,
      dataset: { id: p.id },
      onclick: () => add(p.id, 1),
      'aria-label': `${p.name}، ${money(p.price)} دینار، ${out ? 'نەماوە' : `${money(p.stock)} دانە ماوە`}`,
    },
      h('span', { class: 'tile__name' }, p.name),
      h('span', { class: 'tile__foot' },
        h('span', { class: 'tile__price num' }, money(p.price)),
        out ? h('span', { class: 'tile__stock tile__stock--out' }, 'نەماوە')
          : h('span', { class: `tile__stock${low ? ' tile__stock--low' : ''}` }, h('span', { class: 'num' }, money(p.stock)), ' ماوە')),
      inCart ? h('span', { class: 'tile__qty num' }, `×${money(inCart)}`) : null);
    return t;
  }
  const paintTile = (id) => {
    const old = tiles.querySelector(`.tile[data-id="${id}"]`);
    const p = byId.get(id);
    if (old && p) old.replaceWith(tileFor(p));
  };

  function scanEnter() {
    const raw = searchInput.value.trim();
    if (!raw) return;
    query = searchInput.value; // a scanner presses Enter before the typing delay has fired
    const code = raw.toLowerCase();
    let hit = products.find((p) => p.code && p.code.toLowerCase() === code);
    if (!hit) {
      const list = visibleProducts();
      if (list.length === 1) hit = list[0];
    }
    if (!hit) {
      toast(visibleProducts().length > 1 ? 'چەند کاڵایەک دۆزرانەوە — یەکێکیان هەڵبژێرە.' : 'هیچ کاڵایەک بەم بارکۆدە نەدۆزرایەوە.', 'info');
      searchInput.select();
      return;
    }
    if (hit.stock <= 0) {
      toast(`«${hit.name}» لە کۆگا نەماوە.`, 'err');
      searchInput.select();
      return;
    }
    add(hit.id, 1);
    searchInput.value = '';
    query = '';
    renderTiles();
    searchInput.focus();
  }

  /* ------------------------------------------------ cart */
  const lineRefs = new Map();
  const linesEl = h('ul', { class: 'cart-lines' });
  const emptyCart = h('div', { class: 'slip__empty' }, icon('sale', 30), h('strong', null, 'سەبەتە بەتاڵە'), h('span', null, 'کاڵایەک هەڵبژێرە یان بارکۆد بخوێنەوە'));
  const countEl = h('span', { class: 'slip__count' });
  const clearBtn = h('button', { class: 'btn btn--quiet btn--sm', type: 'button', onclick: clearCart }, icon('trash', 16), 'پاککردنەوە');

  const subEl = h('span', { class: 'num' });
  const discInput = numberInput({ placeholder: '0', onInput: (v) => { setDiscount(v || 0, false); } });
  discInput.setAttribute('aria-label', 'داشکان بە دینار');
  const discHint = h('div', { class: 'slip__hint' });
  const discRow = h('div', { class: 'slip__disc' }, h('label', { for: 'discInput' }, 'داشکان'), discInput, discHint);
  discInput.id = 'discInput';
  const totalEl = h('span', { class: 'num slip__total-val' });
  const recvInput = numberInput({ placeholder: '0', onInput: (v) => { received = v; renderChange(); } });
  recvInput.id = 'recvInput';
  const quick = h('div', { class: 'quickcash' });
  const changeEl = h('div', { class: 'slip__change' });
  const noteInput = h('input', { class: 'input input--note', type: 'text', maxlength: '300', placeholder: 'تێبینی بۆ وەسڵ (ئارەزوومەندانە)', value: note, 'aria-label': 'تێبینی' });
  noteInput.addEventListener('input', () => { note = noteInput.value; persist(); });
  const doSell = async () => {
    await withBusy(sellBtn, sell);
    if (!disposed) renderTotals();
  };
  const sellBtn = h('button', { class: 'btn btn--cta btn--lg btn--block sell', type: 'button', onclick: doSell },
    icon('check', 22), h('span', { class: 'sell__label' }, 'فرۆشتن'), h('span', { class: 'sell__sum' }, h('span', { class: 'num' }, '0'), ' دینار'));
  const pendingBox = h('div', { class: 'slip__pending', role: 'alert' });
  pendingBox.hidden = true;

  function setDiscount(v, writeBack = true) {
    const cap = maxDiscount();
    let d = Math.max(0, v);
    if (d > cap) {
      d = cap;
      if (role !== 'admin') toast(cap > 0 ? `زۆرترین داشکانی کاشێر بۆ ئەم وەسڵە ${money(cap)} دینارە.` : 'داشکان بۆ کاشێر ڕێگەپێدراو نییە.', 'info');
      writeBack = true;
    }
    discount = d;
    if (writeBack) discInput.setValue(d || '');
    renderTotals();
    persist();
  }

  function add(id, n) {
    if (pending) return;
    const p = byId.get(id);
    if (!p) return;
    const cur = cart.get(id) || 0;
    if (p.stock <= 0) {
      toast(`«${p.name}» لە کۆگا نەماوە.`, 'err');
      return;
    }
    if (cur + n > p.stock) {
      toast(`«${p.name}» تەنها ${money(p.stock)} دانەی ماوە.`, 'info');
      if (cur >= p.stock) return;
      n = p.stock - cur;
    }
    cart.set(id, cur + n);
    afterCartChange(id);
  }
  function setQty(id, q) {
    const p = byId.get(id);
    if (!p) return;
    if (q <= 0) {
      cart.delete(id);
    } else {
      if (q > p.stock) {
        toast(`«${p.name}» تەنها ${money(p.stock)} دانەی ماوە.`, 'info');
        q = p.stock;
      }
      cart.set(id, q);
    }
    afterCartChange(id);
  }
  function afterCartChange(id) {
    if (discount > maxDiscount()) {
      discount = maxDiscount();
      discInput.setValue(discount || '');
    }
    renderCart();
    if (id !== undefined) paintTile(id);
    persist();
  }
  async function clearCart() {
    if (!cart.size || pending) return;
    if (cart.size > 1 || countItems() > 2) {
      const ok = await confirmDialog({ title: 'پاککردنەوەی سەبەتە', message: 'هەموو کاڵاکانی ئەم وەسڵە لادەبرێن. دڵنیایت؟', confirmText: 'بەڵێ، پاکی بکەرەوە', danger: true });
      if (!ok) return;
    }
    resetSale();
  }
  function resetSale() {
    const ids = [...cart.keys()];
    cart = new Map();
    discount = 0;
    note = '';
    received = null;
    pending = null;
    discInput.setValue('');
    recvInput.setValue('');
    noteInput.value = '';
    renderCart();
    ids.forEach(paintTile);
    persist();
  }

  function lineFor(id, q) {
    const p = byId.get(id);
    const sumEl = h('span', { class: 'num cart-line__sum' }, money(p.price * q));
    const qtyIn = numberInput({ value: q, grouped: false, className: 'input--qty' });
    qtyIn.setAttribute('aria-label', `بڕی ${p.name}`);
    qtyIn.addEventListener('change', () => {
      const v = qtyIn.getValue();
      setQty(id, v === null ? cart.get(id) : v);
    });
    qtyIn.addEventListener('input', () => {
      const v = qtyIn.getValue();
      if (v && v > 0 && v <= p.stock) {
        cart.set(id, v);
        sumEl.textContent = money(p.price * v);
        plus.disabled = v >= p.stock;
        renderTotals();
        persist();
      }
    });
    const minus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'کەمکردن', onclick: () => setQty(id, (cart.get(id) || 1) - 1) }, icon('minus', 16));
    const plus = h('button', { class: 'stepper__btn', type: 'button', 'aria-label': 'زیادکردن', disabled: q >= p.stock, title: q >= p.stock ? 'ئەوەندەی لە کۆگا ماوە' : null, onclick: () => add(id, 1) }, icon('plus', 16));
    const li = h('li', { class: 'cart-line' },
      h('div', { class: 'cart-line__top' },
        h('span', { class: 'cart-line__name' }, p.name),
        h('button', { class: 'icon-btn icon-btn--sm', type: 'button', 'aria-label': `لابردنی ${p.name}`, title: 'لابردن', onclick: () => setQty(id, 0) }, icon('x', 16))),
      h('div', { class: 'cart-line__bottom' },
        h('span', { class: 'cart-line__unit num' }, money(p.price)),
        h('span', { class: 'stepper' }, minus, qtyIn, plus),
        sumEl));
    lineRefs.set(id, { qtyIn, sumEl, plus });
    return li;
  }

  function renderCart() {
    lineRefs.clear();
    const ids = [...cart.keys()].filter((id) => byId.has(id));
    linesEl.replaceChildren(...ids.map((id) => lineFor(id, cart.get(id))));
    emptyCart.hidden = ids.length > 0;
    linesEl.hidden = ids.length === 0;
    clearBtn.hidden = ids.length === 0;
    renderTotals();
  }

  function renderTotals() {
    const sub = subtotal();
    const n = countItems();
    const t = total();
    subEl.textContent = money(sub);
    totalEl.textContent = money(t);
    countEl.textContent = n ? `${money(n)} دانە` : '';
    sellBtn.querySelector('.sell__sum .num').textContent = money(t);
    sellBtn.disabled = busy || !cart.size || !!pending;
    fabCount.textContent = money(n);
    fabSum.textContent = money(t);
    fab.hidden = false;
    fab.classList.toggle('is-empty', !n);

    const showDisc = canDiscount() && cart.size > 0;
    discRow.hidden = !showDisc;
    if (showDisc) {
      const cap = maxDiscount();
      discHint.textContent = role === 'admin' ? '' : `زۆرترین: ${money(cap)} دینار (${state.settings.cashier_max_discount_pct}%)`;
    }
    // quick cash suggestions
    const sug = cashSuggestions(t);
    quick.replaceChildren(...(t > 0 ? sug.map((v, i) => h('button', { class: 'chip chip--cash', type: 'button', onclick: () => { received = v; recvInput.setValue(v); renderChange(); } }, i === 0 && v === t ? 'ئەوەندە' : money(v))) : []));
    renderChange();
    root.classList.toggle('pos--locked', !!pending);
    pendingBox.hidden = !pending;
  }

  function renderChange() {
    const t = total();
    if (!cart.size || received === null || received === undefined) {
      changeEl.replaceChildren();
      changeEl.className = 'slip__change';
      return;
    }
    const diff = received - t;
    if (diff >= 0) {
      changeEl.className = 'slip__change is-ok';
      changeEl.replaceChildren(h('span', null, diff === 0 ? 'بڕەکە تەواوە' : 'بدەرەوە بە کڕیار'), diff === 0 ? icon('check', 20) : h('strong', null, h('span', { class: 'num' }, money(diff)), ' دینار'));
    } else {
      changeEl.className = 'slip__change is-short';
      changeEl.replaceChildren(h('span', null, 'کەمە'), h('strong', null, h('span', { class: 'num' }, money(-diff)), ' دینار'));
    }
  }

  /* ------------------------------------------------ selling */
  async function callSale(payload) {
    try {
      return await api.rpc('create_sale', payload);
    } catch (e) {
      if (!e.isNetwork) throw e;
      await new Promise((r) => setTimeout(r, 1200));
      return api.rpc('create_sale', payload); // same client_id: the database never sells twice
    }
  }

  async function sell() {
    if (!cart.size || busy) return;
    if (pending) return retryPending();
    const payload = {
      p_items: [...cart].map(([product_id, qty]) => ({ product_id, qty })),
      p_discount: discount,
      p_note: note.trim() || null,
      p_client_id: uuid(),
    };
    await submit(payload);
  }
  async function retryPending() {
    if (pending) await submit(pending.payload);
  }
  async function submit(payload) {
    busy = true;
    sellBtn.disabled = true;
    try {
      const sale = await callSale(payload);
      onSold(sale);
    } catch (e) {
      if (e.isNetwork) {
        pending = { payload, total: total() };
        persist();
        renderPending();
        renderTotals();
        toast('پەیوەندی بچڕا. نازانرێت فرۆشتنەکە تۆمار کراوە یان نا — دووبارە هەوڵبدەرەوە.', 'err', 9000);
      } else {
        toast(errText(e), 'err', 8000);
        if (e.key === 'STOCK_INSUFFICIENT' || e.key === 'PRODUCT_UNAVAILABLE') await loadProducts(true);
      }
    } finally {
      busy = false;
      if (!disposed) renderTotals();
    }
  }
  function renderPending() {
    pendingBox.replaceChildren(
      h('div', { class: 'slip__pending-text' }, icon('alert', 18), h('span', null, 'پەیوەندی بچڕا و نازانرێت ئەم فرۆشتنە تۆمار کراوە یان نا. دووبارە هەوڵبدەرەوە — ئەگەر پێشتر تۆمار کرابێت، دووبارە نافرۆشرێت.')),
      h('div', { class: 'slip__pending-actions' },
        button('دووبارە هەوڵبدەرەوە', { variant: 'primary', size: 'sm', icon: 'refresh', onClick: (e) => withBusy(e.currentTarget, retryPending) }),
        button('هەڵوەشاندنەوە', { variant: 'ghost', size: 'sm', onClick: dropPending })));
  }
  async function dropPending() {
    const ok = await confirmDialog({ title: 'هەڵوەشاندنەوەی هەوڵەکە', message: 'پێش ئەوەی هەڵیبوەشێنیتەوە، لە «وەسڵەکانم» بپشکنە ئایا ئەم فرۆشتنە تۆمار کراوە. ئەگەر تۆمار کرابێت و دووبارە بیفرۆشیت، دوو جار دەنووسرێت.', confirmText: 'هەڵیبوەشێنەوە', danger: true });
    if (!ok) return;
    pending = null;
    persist();
    renderTotals();
  }

  function onSold(sale) {
    resetSale();
    loadProducts(true).catch(() => {});
    showSaleDone(sale, state.settings, { onClose: () => { if (!disposed && matchMedia('(pointer: fine)').matches) searchInput.focus(); } });
    closeCart();
    if (autoPrintOn()) setTimeout(() => printReceipt(sale, state.settings), 250);
  }

  /* ------------------------------------------------ data */
  async function loadProducts(announce = false) {
    try {
      const list = await api.rpc('pos_products');
      products = list.map((p) => ({ ...p, _hay: fold(`${p.name} ${p.code || ''} ${p.category || ''}`) })).sort((a, b) => collator.compare(a.name, b.name));
      byId = new Map(products.map((p) => [p.id, p]));
      loadedAt = Date.now();
      if (!pending) reconcile(announce);
      if (disposed) return;
      renderChips();
      renderTiles();
      renderCart();
    } catch (e) {
      if (!products.length) throw e;
      if (announce) toast(errText(e), 'err');
    }
  }
  function reconcile(announce) {
    const msgs = [];
    for (const [id, q] of [...cart]) {
      const p = byId.get(id);
      if (!p || p.stock <= 0) {
        cart.delete(id);
        msgs.push(p ? `«${p.name}» لە کۆگا نەما و لە سەبەتە لابرا.` : 'کاڵایەک لە سەبەتە لابرا چونکە ئیتر بەردەست نییە.');
      } else if (q > p.stock) {
        cart.set(id, p.stock);
        msgs.push(`«${p.name}» تەنها ${money(p.stock)} دانەی ماوە.`);
      }
    }
    if (discount > maxDiscount()) discount = maxDiscount();
    if (msgs.length) {
      persist();
      if (announce !== null) msgs.slice(0, 3).forEach((m) => toast(m, 'info', 6000));
    }
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt > 45000 && !busy) loadProducts(false).catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  const onKey = (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.documentElement.classList.contains('has-modal')) {
      e.preventDefault();
      searchInput.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  /* ------------------------------------------------ layout */
  const fabCount = h('span', { class: 'num fab__count' });
  const fabSum = h('span', { class: 'num' });
  const fab = h('button', { class: 'fab', type: 'button', onclick: openCart, 'aria-label': 'کردنەوەی سەبەتە' },
    icon('sale', 22), h('span', { class: 'fab__text' }, 'سەبەتە'), fabCount, h('span', { class: 'fab__sum' }, fabSum, ' دینار'));
  function openCart() { root.classList.add('pos--cart-open'); }
  function closeCart() { root.classList.remove('pos--cart-open'); }

  const slip = h('div', { class: 'slip' },
    h('header', { class: 'slip__head' },
      h('button', { class: 'icon-btn slip__close', type: 'button', 'aria-label': 'گەڕانەوە بۆ کاڵاکان', onclick: closeCart }, icon('chevron', 22)),
      h('div', { class: 'slip__title' }, h('h2', null, 'وەسڵی نوێ'), h('small', null, fmtDay(todayKey()))),
      countEl, clearBtn),
    h('div', { class: 'slip__body' }, emptyCart, linesEl),
    h('div', { class: 'slip__foot' },
      pendingBox,
      h('div', { class: 'slip__row' }, h('span', null, 'کۆ'), subEl),
      discRow,
      h('div', { class: 'slip__total' }, h('span', null, 'کۆی گشتی'), h('strong', null, totalEl, h('span', { class: 'unit' }, ' دینار'))),
      h('div', { class: 'slip__pay' },
        h('label', { for: 'recvInput' }, 'پارەی وەرگیراو'), recvInput, quick, changeEl),
      noteInput,
      sellBtn));

  mount(root, h('div', { class: 'pos' },
    h('section', { class: 'pos__catalog', 'aria-label': 'کاڵاکان' },
      h('div', { class: 'pos__bar' }, search, refreshBtn),
      chips, tiles, catalogMsg),
    h('aside', { class: 'pos__cart', 'aria-label': 'سەبەتە' }, slip),
    fab));
  root.classList.add('pos-root'); // the holder carries the state classes (cart sheet open / locked)

  if (pending) renderPending();
  renderCart();
  try {
    mount(catalogMsg, loading());
    await loadProducts(null);
    catalogMsg.replaceChildren();
    renderTiles();
  } catch (e) {
    mount(catalogMsg, errorState(errText(e), () => ctx.go('pos')));
  }
  if (cart.size && countItems()) discInput.setValue(discount || '');
  if (matchMedia('(pointer: fine)').matches) searchInput.focus();

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
  };
}

function cashSuggestions(total) {
  if (!(total > 0)) return [];
  const set = new Set([total]);
  for (const step of [1000, 5000, 10000, 25000, 50000, 100000]) set.add(Math.ceil(total / step) * step);
  return [...set].sort((a, b) => a - b).slice(0, 4);
}
