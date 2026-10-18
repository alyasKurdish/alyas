// Date-range control: quick presets plus two custom dates. All dates are 'YYYY-MM-DD' as seen in Baghdad.
import { h, button, segmented } from './ui.js';
import { todayKey, addDays, monthStart, monthEnd, prevMonthStart, fmtDay, daysBetween } from './fmt.js';

export const PRESET_LABEL = {
  today: 'ئەمڕۆ',
  yesterday: 'دوێنێ',
  '7d': '7 ڕۆژ',
  month: 'ئەم مانگە',
  lastmonth: 'مانگی ڕابردوو',
  '30d': '30 ڕۆژ',
  year: 'ئەمساڵ',
  custom: 'دیاریکراو',
};
export const MAX_DAYS = 800;

export function resolveRange(key, custom) {
  const t = todayKey();
  switch (key) {
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
    case '7d': return { from: addDays(t, -6), to: t };
    case 'month': return { from: monthStart(t), to: t };
    case 'lastmonth': { const s = prevMonthStart(t); return { from: s, to: monthEnd(s) }; }
    case '30d': return { from: addDays(t, -29), to: t };
    case 'year': return { from: `${t.slice(0, 4)}-01-01`, to: t };
    default: return custom || { from: t, to: t };
  }
}

export function rangeLabel({ from, to }) {
  return from === to ? fmtDay(from) : `${fmtDay(from)} — ${fmtDay(to)}`;
}
export const rangeDays = ({ from, to }) => daysBetween(from, to) + 1;

/** the period of the same length that ends the day before `from` */
export function previousRange({ from, to }) {
  const n = rangeDays({ from, to });
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/**
 * rangeControl({ initial, presets, onChange }) -> { el, get(), set(key) }
 * get() -> { key, from, to, label, days }
 */
export function rangeControl({ initial = 'month', presets = ['today', 'yesterday', '7d', 'month', 'lastmonth', '30d', 'year'], onChange, allowCustom = true } = {}) {
  let key = initial;
  let custom = null;
  const options = presets.map((k) => ({ value: k, label: PRESET_LABEL[k] }));
  if (allowCustom) options.push({ value: 'custom', label: PRESET_LABEL.custom });

  const t = todayKey();
  const fromIn = h('input', { class: 'input input--date', type: 'date', max: t, value: addDays(t, -6), 'aria-label': 'لە بەرواری' });
  const toIn = h('input', { class: 'input input--date', type: 'date', max: t, value: t, 'aria-label': 'تا بەرواری' });
  const err = h('span', { class: 'field__error range__err', role: 'alert' });
  err.hidden = true;
  const apply = button('پیشاندان', { size: 'sm', onClick: () => submitCustom() });
  const customRow = h('div', { class: 'range__custom' }, h('label', null, h('span', null, 'لە'), fromIn), h('label', null, h('span', null, 'تا'), toIn), apply, err);
  customRow.hidden = true;

  const seg = segmented({
    options,
    value: key,
    label: 'ماوە',
    onChange: (v) => {
      key = v;
      customRow.hidden = v !== 'custom';
      if (v === 'custom') {
        if (custom) onChange && onChange(get()); // come back to the last custom range
        else submitCustom();
        return;
      }
      err.hidden = true;
      onChange && onChange(get());
    },
  });

  function submitCustom() {
    const from = fromIn.value;
    const to = toIn.value;
    err.hidden = true;
    if (!from || !to) { err.textContent = 'هەردوو بەروار دیاری بکە.'; err.hidden = false; return; }
    if (from > to) { err.textContent = 'بەرواری دەستپێک دەبێت پێش کۆتایی بێت.'; err.hidden = false; return; }
    if (daysBetween(from, to) + 1 > MAX_DAYS) { err.textContent = 'ماوەکە زۆر درێژە (زیاتر لە 800 ڕۆژ).'; err.hidden = false; return; }
    custom = { from, to };
    onChange && onChange(get());
  }
  fromIn.addEventListener('keydown', (e) => e.key === 'Enter' && submitCustom());
  toIn.addEventListener('keydown', (e) => e.key === 'Enter' && submitCustom());

  function get() {
    const r = resolveRange(key, custom);
    return { key, ...r, label: rangeLabel(r), days: rangeDays(r) };
  }
  const el = h('div', { class: 'range' }, seg, customRow);
  return {
    el,
    get,
    set(k) {
      key = k;
      seg.set(k);
      customRow.hidden = k !== 'custom';
    },
  };
}
