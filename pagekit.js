// Page furniture shared by the admin screens: title row, KPI band, panels, small async helpers.
import { h } from './ui.js';
import { money } from './fmt.js';

export function pageHead({ title, sub, actions }) {
  return h('header', { class: 'page-head' },
    h('div', null, h('h1', { class: 'page-head__title' }, title), sub ? h('p', { class: 'page-head__sub' }, sub) : null),
    actions && actions.length ? h('div', { class: 'page-head__actions' }, actions) : null);
}

/** One ruled band of figures. items: [{ label, value, unit, sub, tone: 'good'|'bad'|'warn'|undefined }] */
export function kpiBand(items, { className = '' } = {}) {
  return h('div', { class: `kpi ${className}` }, items.filter(Boolean).map((it) => h('div', { class: `kpi__cell${it.tone ? ` kpi__cell--${it.tone}` : ''}` },
    h('div', { class: 'kpi__label' }, it.label),
    h('div', { class: 'kpi__value' }, it.value instanceof Node ? it.value : h('span', { class: 'num' }, typeof it.value === 'number' ? money(it.value) : it.value), it.unit ? h('span', { class: 'unit' }, ` ${it.unit}`) : null),
    it.sub ? h('div', { class: 'kpi__sub' }, it.sub) : null)));
}

export function panel({ title, sub, actions, body, className = '' }) {
  return h('section', { class: `panel ${className}` },
    title || actions ? h('header', { class: 'panel__head' },
      h('div', null, title ? h('h2', { class: 'panel__title' }, title) : null, sub ? h('p', { class: 'panel__sub' }, sub) : null),
      actions ? h('div', { class: 'panel__actions' }, actions) : null) : null,
    body);
}

/** Keeps only the newest answer when several requests overlap (fast filter changes). */
export function latest() {
  let n = 0;
  return {
    next: () => ++n,
    isCurrent: (k) => k === n,
  };
}

/** change figure vs. a previous period: { text, tone } */
export function delta(now, before) {
  if (before === null || before === undefined) return null;
  if (before === 0 && now === 0) return { text: 'هیچ گۆڕانکارییەک', tone: 'flat' };
  if (before === 0) return { text: 'پێشتر نەبووە', tone: 'flat' };
  const p = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(p) < 0.5) return { text: 'وەک ماوەی پێشوو', tone: 'flat' };
  const up = p > 0;
  return { text: `${up ? '▲' : '▼'} ${Math.abs(Math.round(p))}% ${up ? 'زیاتر' : 'کەمتر'}`, tone: up ? 'good' : 'bad' };
}
