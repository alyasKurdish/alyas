// Numbers, dates, text normalising and CSV. Everything the shop sees uses Latin digits and Asia/Baghdad time.

export const TZ = 'Asia/Baghdad';

/* ---------- digits ---------- */
const AR = '٠١٢٣٤٥٦٧٨٩';
const FA = '۰۱۲۳۴۵۶۷۸۹';
/** Kurdish keyboards type ٠١٢ or ۰۱۲; the system always works with 0123. */
export function toLatinDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (c) => String(AR.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(FA.indexOf(c)))
    .replace(/[٬،]/g, ',')
    .replace(/٫/g, '.');
}

/** "125,000" / "١٢٥٬٠٠٠" / "125000" -> 125000. Anything that is not a whole number (12.5, "abc") -> null */
export function parseInteger(s) {
  const t = toLatinDigits(s).replace(/[,\s\u00a0]/g, '');
  if (!/^-?\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(Math.trunc(n)) ? Math.trunc(n) : null;
}

/* ---------- money ---------- */
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  return nf.format(Math.round(Number(n)));
}
export const int = money;
export function pct(n, digits = 0) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits) + '%';
}
export function margin(profit, revenue) {
  return revenue > 0 ? (profit / revenue) * 100 : null;
}

/* ---------- dates (all in Baghdad time) ---------- */
export const MONTHS = ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمموز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'];
export const WEEKDAYS = ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'];

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function parts(d) {
  const o = {};
  for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}
const toDate = (v) => (v instanceof Date ? v : new Date(v));

/** 'YYYY-MM-DD' of a moment, as seen in Baghdad */
export function dayKey(v = new Date()) {
  const p = parts(toDate(v));
  return `${p.year}-${p.month}-${p.day}`;
}
export const todayKey = () => dayKey();

function utc(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function addDays(key, n) {
  const d = utc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}
export const monthStart = (key) => key.slice(0, 8) + '01';
export function monthEnd(key) {
  const d = utc(monthStart(key));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
export function prevMonthStart(key) {
  const d = utc(monthStart(key));
  d.setUTCMonth(d.getUTCMonth() - 1, 1);
  return d.toISOString().slice(0, 10);
}
export function weekdayOf(key) {
  return WEEKDAYS[utc(key).getUTCDay()];
}

/** 18 تشرینی یەکەم 2026 */
export function fmtDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** 18 تش ١ — short, for chart axes */
export function fmtDayShort(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${d}/${m}`;
}
/** یەکشەممە، 18 تشرینی یەکەم 2026 */
export function fmtLongDate(key) {
  return `${weekdayOf(key)}، ${fmtDay(key)}`;
}
/** 10:30 د.ن */
export function fmtTime(v) {
  const p = parts(toDate(v));
  const h = Number(p.hour);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${p.minute} ${h < 12 ? 'پ.ن' : 'د.ن'}`;
}
export function fmtDateTime(v) {
  return `${fmtDay(dayKey(v))} · ${fmtTime(v)}`;
}
/** 2026/10/18 — for tables */
export function fmtDateNum(v) {
  const k = typeof v === 'string' && v.length === 10 ? v : dayKey(v);
  return k.replaceAll('-', '/');
}
export function relativeDay(v) {
  if (!v) return 'هەرگیز';
  const n = daysBetween(dayKey(v), todayKey());
  if (n <= 0) return 'ئەمڕۆ';
  if (n === 1) return 'دوێنێ';
  if (n < 31) return `${n} ڕۆژ لەمەوبەر`;
  if (n < 365) return `${Math.round(n / 30)} مانگ لەمەوبەر`;
  return `${Math.round(n / 365)} ساڵ لەمەوبەر`;
}
export function daysSince(v) {
  return v ? Math.max(0, daysBetween(dayKey(v), todayKey())) : null;
}

/* ---------- text ---------- */
const FOLD = { 'ك': 'ک', 'ي': 'ی', 'ى': 'ی', 'ێ': 'ی', 'ۆ': 'و', 'ڕ': 'ر', 'ڵ': 'ل', 'ە': 'ه', 'ہ': 'ه', 'ة': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' };
/** makes searching forgiving: Arabic/Kurdish letter variants, digits, case, diacritics */
export function fold(s) {
  return toLatinDigits(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[كيىێۆڕڵەہةأإآ]/g, (c) => FOLD[c])
    .trim();
}

export function debounce(fn, ms = 200) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- CSV (opens correctly in Excel, Kurdish included) ---------- */
export function toCSV(headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}
export function downloadCSV(filename, headers, rows) {
  const blob = new Blob([toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
