// Every word the shop sees. Sorani Kurdish, Latin digits.
import { money } from './fmt.js';

export const ROLE = { admin: 'ئادمین', cashier: 'کاشێر' };

export const MOVEMENT = {
  opening: 'کۆگای سەرەتا',
  purchase: 'هاتنی کاڵا',
  sale: 'فرۆشتن',
  return: 'گەڕاندنەوە بۆ کۆگا',
  return_loss: 'گەڕاوەی تێکچوو',
  adjust: 'ڕاستکردنەوەی ژمارە',
  void: 'هەڵوەشاندنەوەی هاتن',
};

export const RETURN_REASONS = [
  'کاڵاکە خراپە یان کارناکات',
  'کڕیار پەشیمان بووەوە',
  'جۆر یان مۆدێلەکە هەڵەیە',
  'گۆڕینی کاڵا',
];

const same = (s) => () => s;
const NOT_ALLOWED = 'ئەم کارە بۆ تۆ ڕێگەپێدراو نییە.';

const ERRORS = {
  NETWORK: same('پەیوەندی بە ئینتەرنێت نییە. دڵنیابە ئینتەرنێتەکەت کاردەکات و دووبارە هەوڵبدەرەوە.'),
  TIMEOUT: same('وەڵامی سێرڤەر درەنگ بوو. دووبارە هەوڵبدەرەوە.'),
  BAD_RESPONSE: same('وەڵامی سێرڤەر تێنەگەیشت. دووبارە هەوڵبدەرەوە.'),
  SESSION_EXPIRED: same('کاتی چوونەژوورەوەکەت تەواو بوو. تکایە دووبارە بچۆ ژوورەوە.'),

  INVALID_CREDENTIALS: same('ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە.'),
  USER_ALREADY_EXISTS: same('ئەم ناوی بەکارهێنەرە پێشتر بەکارهاتووە.'),
  EMAIL_EXISTS: same('ئەم ناوی بەکارهێنەرە پێشتر بەکارهاتووە.'),
  WEAK_PASSWORD: same('وشەی نهێنی دەبێت لانی کەم 6 پیت یان ژمارە بێت.'),
  PASSWORD_INVALID: same('وشەی نهێنی دەبێت لانی کەم 6 پیت یان ژمارە بێت.'),
  VALIDATION_FAILED: same('ناوی بەکارهێنەر دروست نییە. تەنها پیتی ئینگلیزی و ژمارە بەکاربهێنە.'),
  EMAIL_ADDRESS_INVALID: same('Supabase ئەو ئیمەیڵەی بۆ ئەم ناوە دروستکراوە ڕەتی کردەوە. لە فایلی config.js دەبێت LOGIN_EMAIL ئیمەیڵێکی ڕاستی خۆت بێت (وەک Gmail)، نەک ئیمەیڵی ساختە.'),
  EMAIL_ADDRESS_NOT_AUTHORIZED: same('Supabase ناتوانێت نامە بنێرێت بۆ ئەم ئیمەیڵە. لە Authentication ← Sign In / Providers ← Email دەبێت "Confirm email" بکوژێنیتەوە.'),
  SIGNUP_DISABLED: same('دروستکردنی هەژمار لە Supabase ڕاگیراوە. لە Authentication ← Sign In / Providers دەبێت "Allow new users to sign up" چالاک بێت.'),
  UNEXPECTED_FAILURE: same('سێرڤەر نەیتوانی هەژمارەکە دروست بکات. دڵنیابە فایلی schema.sql بە تەواوی جێبەجێ کراوە.'),
  OVER_REQUEST_RATE_LIMIT: same('زۆر هەوڵت دا. چەند خولەکێک چاوەڕێ بکە و دووبارە هەوڵبدەرەوە.'),
  OVER_EMAIL_SEND_RATE_LIMIT: same('زۆر هەوڵت دا. چەند خولەکێک چاوەڕێ بکە و دووبارە هەوڵبدەرەوە.'),
  SAME_PASSWORD: same('وشەی نهێنی نوێ دەبێت جیاواز بێت لە کۆنەکە.'),

  NOT_AUTHORIZED: same(NOT_ALLOWED),
  ADMIN_ONLY: same('ئەم کارە تەنها بۆ ئادمینە.'),
  42501: same(NOT_ALLOWED),
  PGRST202: same('ئەم کارە لە سێرڤەر نییە. دڵنیابە کۆدی Worker نوێترین وەشانە (worker/worker.js) و دووبارە Deploy ی بکە.'),
  BAD_INPUT: same('زانیارییەکە دروست نییە. بیپشکنەرەوە و دووبارە هەوڵبدەرەوە.'),
  SETTINGS_INVALID: same('ڕێکخستنەکان دروست نین: ڕێژەی داشکاندن دەبێت لە 0 تا 100 بێت و ماوەی گەڕاندنەوە لە 0 تا 3650 ڕۆژ.'),
  DB_ERROR: same('سێرڤەر نەیتوانی بگاتە داتابەیس. چەند چرکەیەک چاوەڕێ بکە و دووبارە هەوڵبدەرەوە.'),
  SERVER_NOT_CONFIGURED: same('سێرڤەرەکە ڕێکنەخراوە: لە Cloudflare ← Worker ← Settings ← Variables دەبێت TURSO_URL و TURSO_TOKEN دابنرێن.'),
  PGRST301: same('کاتی چوونەژوورەوەکەت تەواو بوو. تکایە دووبارە بچۆ ژوورەوە.'),

  EMPTY_CART: same('سەبەتەکە بەتاڵە.'),
  BAD_ITEMS: same('بڕی کاڵاکان دروست نییە.'),
  TOO_MANY_LINES: same('ژمارەی دێڕەکان زۆرە (زیاتر لە 300).'),
  PRODUCT_UNAVAILABLE: same('ئەم کاڵایە بەردەست نییە (شاراوەتەوە یان سڕاوەتەوە). لیستی کاڵاکان نوێ بکەرەوە.'),
  STOCK_INSUFFICIENT: (d) =>
    d && d.name
      ? d.available > 0
        ? `«${d.name}» تەنها ${money(d.available)} دانەی ماوە.`
        : `«${d.name}» لە کۆگا نەماوە.`
      : 'کۆگا بەشی ئەم بڕە ناکات.',
  DISCOUNT_INVALID: same('بڕی داشکان دروست نییە.'),
  DISCOUNT_TOO_HIGH: same('داشکان لە کۆی گشتی زیاترە.'),
  DISCOUNT_NOT_ALLOWED: (d) =>
    d && d.max > 0
      ? `کاشێر تەنها دەتوانێت تا ${money(d.max)} دینار (${d.pct}%) داشکان بکات.`
      : 'داشکان بۆ کاشێر ڕێگەپێدراو نییە.',

  SALE_NOT_FOUND: same('ئەم وەسڵە نەدۆزرایەوە.'),
  ITEM_NOT_FOUND: same('ئەم دێڕە نەدۆزرایەوە.'),
  REASON_REQUIRED: same('هۆکارەکە بنووسە.'),
  RETURNS_DISABLED: same('گەڕاندنەوە بۆ کاشێر ڕاگیراوە. داوا لە ئادمین بکە.'),
  RETURN_WINDOW_EXPIRED: (d) => `ماوەی گەڕاندنەوە${d && d.days !== undefined ? ` (${d.days} ڕۆژ)` : ''} تەواو بووە. تەنها ئادمین دەتوانێت بیگەڕێنێتەوە.`,
  RETURN_QTY_INVALID: (d) => (d && d.max === 0 ? 'هەموو ئەم کاڵایە پێشتر گەڕێنراوەتەوە.' : `تەنها ${d ? d.max : 0} دانە ماوە بۆ گەڕاندنەوە.`),

  NAME_REQUIRED: same('ناوی کاڵا بنووسە.'),
  PRICE_INVALID: same('نرخی فرۆشتن دروست نییە.'),
  MIN_STOCK_INVALID: same('ژمارەی ئاگادارکردنەوەی کەمبوون دروست نییە.'),
  QTY_INVALID: same('بڕەکە دەبێت ژمارەیەکی تەواو بێت.'),
  COST_REQUIRED: same('کۆی نرخی کڕین بنووسە (دەتوانێت 0 بێت).'),
  COST_INVALID: same('کۆی نرخی کڕین دروست نییە.'),
  CODE_TAKEN: (d) => `بارکۆد${d && d.code ? ` «${d.code}»` : ''} بۆ کاڵایەکی دیکە بەکارهاتووە.`,
  PRODUCT_NOT_FOUND: same('کاڵاکە نەدۆزرایەوە.'),
  PRODUCT_HAS_SALES: same('ئەم کاڵایە فرۆشراوە و ناسڕدرێتەوە؛ دەتوانیت بیشاریتەوە.'),
  NO_CHANGE: same('ژمارەکە هەمان ژمارەی ئێستایە.'),
  PURCHASE_NOT_FOUND: same('ئەم هاتنە نەدۆزرایەوە.'),
  ALREADY_VOIDED: same('ئەم هاتنە پێشتر هەڵوەشێنراوەتەوە.'),
  PURCHASE_NOT_LAST: same('دوای ئەم هاتنە بزووتنەوەی تر ڕوویداوە؛ بۆ ڕاستکردنەوە "ڕاستکردنەوەی ژمارە" بەکاربهێنە.'),

  NOT_FOUND: same('تۆمارەکە نەدۆزرایەوە.'),
  BAD_KIND: same('جۆری خزمەتگوزاری دروست نییە.'),
  BAD_AMOUNT: same('قازانج دەبێت لە ١ بۆ ١٠٠٬٠٠٠٬٠٠٠ دینار بێت.'),
  BAD_RANGE: same('بەرواری دەستپێک دەبێت پێش بەرواری کۆتایی بێت.'),
  RANGE_TOO_LONG: same('ماوەکە زۆر درێژە (زیاتر لە 800 ڕۆژ).'),

  STAFF_NOT_FOUND: same('بەکارهێنەرەکە نەدۆزرایەوە.'),
  ROLE_INVALID: same('دەسەڵاتەکە دروست نییە.'),
  CANNOT_CHANGE_SELF: same('ناتوانیت دەسەڵات یان چالاکی هەژماری خۆت بگۆڕیت یان بیسڕیتەوە.'),
  STAFF_HAS_HISTORY: same('ئەم کەسە فرۆشتنی تۆمارکراوی هەیە و ناسڕدرێتەوە؛ ناچالاکی بکە.'),
};

/** Turns any error into a sentence the shop can act on. */
export function errText(e) {
  const key = e && (e.key || e.message);
  const f = ERRORS[key];
  if (f) return f(e.details);
  if (e && e.status === 403) return NOT_ALLOWED;
  if (e && e.status >= 500) return 'هەڵەیەک لە سێرڤەر ڕوویدا. دووبارە هەوڵبدەرەوە.';
  if (typeof console !== 'undefined') console.warn('[unmapped error]', e);
  return 'هەڵەیەک ڕوویدا. دووبارە هەوڵبدەرەوە.';
}
