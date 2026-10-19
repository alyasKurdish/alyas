// ڕێکخستنی پەیوەندی — تەنها ئەم دێڕە بگۆڕە (دوای ئەوەی Worker لە Cloudflare دروست کرا).
window.ZP_CONFIG = {
  // ناونیشانی Worker ی Cloudflare. بۆ نموونە: https://zp-pos.ناوی-تۆ.workers.dev
  // (Cloudflare ← Workers & Pages ← zp-pos ← ناونیشانی workers.dev)
  API_URL: 'https://YOUR-WORKER.workers.dev',

  // کاشێر و ئادمین بە ناوی ئاسایی (وەک sara) دەچنە ژوورەوە؛ لە ژێرەوە سیستەم دەیکات بە sara@shop.krd .
  // هیچ نامەیەک ناڕەوانە دەکرێت و پێویست ناکات ئەم ناونیشانە ڕاستەقینە بێت.
  // ئاگادار: دوای دروستکردنی یەکەم هەژمار ئەمە مەگۆڕە.
  USERNAME_DOMAIN: 'shop.krd',
};
