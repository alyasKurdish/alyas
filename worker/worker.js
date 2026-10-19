// ZERO PHONE POS — backend for Turso (SQLite) as one Cloudflare Worker.
//
// It speaks the same small HTTP language the web app already knows (sign-in, sign-up, refresh, and
// POST /rest/v1/rpc/<function>), so the front-end only needs the Worker's address in config.js.
//
// Secrets (Cloudflare → Worker → Settings → Variables and Secrets):
//   TURSO_URL    libsql://pos-xxxx.turso.io        (plain text)
//   TURSO_TOKEN  the database token                 (Secret)
// Everything else is created automatically on the first request.
//
// Design rules (same as the old SQL version)
//   * The browser never touches the database. Every function checks WHO is calling (admin / cashier).
//   * Money is whole Iraqi dinar. Prices and costs come from the database, never from the browser.
//   * Cost is tracked as "value of stock on hand", so every sale stores its own cost and profit.
//   * Day boundaries use Asia/Baghdad (UTC+3, no daylight saving).

/* ===================================================================================================
 * 1. Schema
 * ================================================================================================ */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const SCHEMA = [
  `create table if not exists profiles (
    id text primary key,
    email text not null,
    username text not null check (length(trim(username)) between 1 and 60),
    full_name text not null default '' check (length(full_name) <= 80),
    role text not null default 'cashier' check (role in ('admin','cashier')),
    active integer not null default 0,
    pw_hash text not null,
    created_at text not null default (${NOW}),
    approved_at text,
    last_sign_in_at text
  )`,
  `create unique index if not exists profiles_email_key on profiles (lower(email))`,
  `create unique index if not exists profiles_username_key on profiles (lower(username))`,
  `create table if not exists sessions (
    id integer primary key autoincrement,
    user_id text not null,
    token_hash text not null unique,
    created_at text not null default (${NOW}),
    expires_at text not null
  )`,
  `create index if not exists sessions_user_idx on sessions (user_id)`,
  `create table if not exists login_fails (key text not null, at text not null default (${NOW}))`,
  `create index if not exists login_fails_key_idx on login_fails (key, at)`,
  `create table if not exists shop_settings (
    id integer primary key check (id = 1),
    shop_name text not null default 'ZERO PHONE 2',
    shop_phone text not null default '',
    shop_address text not null default '',
    receipt_footer text not null default 'سوپاس بۆ سەردانتان',
    cashier_max_discount_pct integer not null default 0 check (cashier_max_discount_pct between 0 and 100),
    cashier_can_return integer not null default 1,
    return_window_days integer not null default 14 check (return_window_days between 0 and 3650),
    updated_at text not null default (${NOW})
  )`,
  `create table if not exists products (
    id integer primary key autoincrement,
    name text not null check (length(trim(name)) between 1 and 200),
    code text check (code is null or length(trim(code)) between 1 and 64),
    category text check (category is null or length(trim(category)) between 1 and 80),
    price integer not null default 0 check (price >= 0),
    stock integer not null default 0 check (stock >= 0),
    stock_value integer not null default 0 check (stock_value >= 0),
    min_stock integer not null default 0 check (min_stock >= 0),
    active integer not null default 1,
    created_at text not null default (${NOW}),
    updated_at text not null default (${NOW}),
    check (stock > 0 or stock_value = 0)
  )`,
  `create unique index if not exists products_code_key on products (lower(code)) where code is not null`,
  `create index if not exists products_name_idx on products (lower(name))`,
  `create table if not exists purchases (
    id integer primary key autoincrement,
    product_id integer not null references products (id) on delete cascade,
    qty integer not null check (qty > 0),
    total_cost integer not null check (total_cost >= 0),
    supplier text, note text,
    kind text not null default 'purchase' check (kind in ('purchase','opening')),
    created_by text not null references profiles (id),
    created_at text not null default (${NOW}),
    voided_at text,
    client_id text
  )`,
  `create unique index if not exists purchases_client_id_key on purchases (client_id) where client_id is not null`,
  `create index if not exists purchases_created_idx on purchases (created_at)`,
  `create index if not exists purchases_product_idx on purchases (product_id, id desc)`,
  `create table if not exists sales (
    id integer primary key autoincrement,
    created_at text not null default (${NOW}),
    cashier_id text not null references profiles (id),
    subtotal integer not null check (subtotal >= 0),
    discount integer not null default 0 check (discount >= 0),
    total integer not null check (total >= 0),
    cost_total integer not null default 0 check (cost_total >= 0),
    note text,
    client_id text,
    check (discount <= subtotal and total = subtotal - discount)
  )`,
  `create unique index if not exists sales_client_id_key on sales (client_id) where client_id is not null`,
  `create index if not exists sales_created_idx on sales (created_at)`,
  `create index if not exists sales_cashier_idx on sales (cashier_id, created_at)`,
  `create table if not exists sale_items (
    id integer primary key autoincrement,
    sale_id integer not null references sales (id) on delete cascade,
    product_id integer not null references products (id),
    product_name text not null,
    qty integer not null check (qty > 0),
    unit_price integer not null check (unit_price >= 0),
    line_total integer not null check (line_total >= 0),
    line_discount integer not null default 0 check (line_discount >= 0),
    line_net integer not null check (line_net >= 0),
    cost_total integer not null default 0 check (cost_total >= 0),
    returned_qty integer not null default 0 check (returned_qty >= 0),
    refunded integer not null default 0 check (refunded >= 0),
    cost_returned integer not null default 0 check (cost_returned >= 0),
    check (returned_qty <= qty),
    check (line_net = line_total - line_discount),
    check (refunded <= line_net and cost_returned <= cost_total)
  )`,
  `create index if not exists sale_items_sale_idx on sale_items (sale_id)`,
  `create index if not exists sale_items_product_idx on sale_items (product_id)`,
  `create table if not exists sale_returns (
    id integer primary key autoincrement,
    sale_id integer not null references sales (id) on delete cascade,
    sale_item_id integer not null references sale_items (id) on delete cascade,
    product_id integer not null references products (id),
    qty integer not null check (qty > 0),
    refund integer not null check (refund >= 0),
    cost_back integer not null default 0 check (cost_back >= 0),
    restocked integer not null default 1,
    reason text not null check (length(trim(reason)) between 1 and 300),
    created_by text not null references profiles (id),
    created_at text not null default (${NOW}),
    client_id text
  )`,
  `create unique index if not exists sale_returns_client_id_key on sale_returns (client_id) where client_id is not null`,
  `create index if not exists sale_returns_created_idx on sale_returns (created_at)`,
  `create index if not exists sale_returns_sale_idx on sale_returns (sale_id)`,
  `create index if not exists sale_returns_product_idx on sale_returns (product_id)`,
  `create table if not exists stock_movements (
    id integer primary key autoincrement,
    product_id integer not null references products (id) on delete cascade,
    kind text not null check (kind in ('opening','purchase','sale','return','return_loss','adjust','void')),
    qty_change integer not null,
    value_change integer not null default 0,
    stock_after integer not null,
    value_after integer not null,
    ref_id integer,
    note text,
    created_by text references profiles (id),
    created_at text not null default (${NOW})
  )`,
  `create index if not exists stock_movements_product_idx on stock_movements (product_id, id desc)`,
  `create index if not exists stock_movements_created_idx on stock_movements (created_at)`,
  `create table if not exists service_entries (
    id integer primary key autoincrement,
    kind text not null check (kind in ('repair','card')),
    title text,
    profit integer not null check (profit > 0 and profit <= 100000000),
    created_by text references profiles (id),
    created_at text not null default (${NOW}),
    client_id text unique,
    voided_at text,
    voided_by text references profiles (id),
    void_reason text
  )`,
  `create index if not exists service_entries_created_idx on service_entries (created_at)`,
  `create index if not exists service_entries_user_idx on service_entries (created_by, created_at)`,
  `insert or ignore into shop_settings (id) values (1)`,
];

/* ===================================================================================================
 * 2. Small helpers
 * ================================================================================================ */
export class Fail extends Error {
  constructor(key, { detail = null, status = 400, code = 'P0001' } = {}) {
    super(key);
    this.key = key;
    this.detail = detail;
    this.status = status;
    this.code = code;
  }
}
const fail = (key, detail = null) => {
  throw new Fail(key, { detail });
};
const forbid = (key) => {
  throw new Fail(key, { status: 403, code: 'PT403' });
};

const DAY_MS = 86400000;
const TZ_MS = 3 * 3600 * 1000; // Asia/Baghdad
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const todayBaghdad = () => isoDate(Date.now() + TZ_MS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = (s) => (DATE_RE.test(String(s)) ? Date.parse(`${s}T00:00:00Z`) : NaN);

/** [start of day from, start of the day after to) in Baghdad, as UTC ISO strings */
function bounds(from, to) {
  const a = dayMs(from);
  const b = dayMs(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) fail('BAD_RANGE');
  if ((b - a) / DAY_MS > 800) fail('RANGE_TOO_LONG');
  return [new Date(a - TZ_MS).toISOString(), new Date(b + DAY_MS - TZ_MS).toISOString()];
}
function eachDay(from, to) {
  const out = [];
  for (let m = dayMs(from); m <= dayMs(to); m += DAY_MS) out.push(isoDate(m));
  return out;
}
const dayOf = (iso) => isoDate(Date.parse(iso) + TZ_MS);

// exact integer arithmetic for money (BigInt): a*b/c rounded half-up, or floored
const big = (n) => BigInt(Math.trunc(n));
const mulDivFloor = (a, b, c) => Number((big(a) * big(b)) / big(c));
const mulDivRound = (a, b, c) => Number((2n * big(a) * big(b) + big(c)) / (2n * big(c)));
// share of total that belongs to the first k of n units; exact when k = n
const prorate = (total, k, n) => (k >= n ? total : mulDivFloor(total, k, n));

const toInt = (v, key = 'BAD_INPUT') => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : /^-?\d+$/.test(String(v).trim()) ? Number(v) : NaN;
  if (!Number.isSafeInteger(n)) fail(key);
  return n;
};
const toBool = (v, dflt) => (v === null || v === undefined || v === '' ? dflt : v === true || v === 'true' || v === 1 || v === '1');
const str = (v) => (v === null || v === undefined ? '' : String(v));
const clip = (s, n) => Array.from(s).slice(0, n).join('');
const nul = (s) => (s === '' ? null : s);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toUuid = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (!UUID_RE.test(String(v))) fail('BAD_INPUT');
  return String(v).toLowerCase();
};
const displayName = 'coalesce(nullif(pr.full_name, \'\'), pr.username)';
const isUnique = (e) => /UNIQUE constraint failed/i.test(String(e && e.message));

/* ===================================================================================================
 * 3. Database client for Turso (libSQL "Hrana over HTTP"). Tests plug in another client with the
 *    same four methods: all, get, run, many  (+ tx for a transaction).
 * ================================================================================================ */
export class DbError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const encArg = (v) => {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  return { type: 'text', value: String(v) };
};
const decVal = (v) => {
  switch (v.type) {
    case 'null': return null;
    case 'integer': return Number(v.value);
    case 'float': return Number(v.value);
    default: return v.value;
  }
};
const toRows = (res) => {
  const cols = res.cols.map((c) => c.name);
  return res.rows.map((r) => Object.fromEntries(r.map((v, i) => [cols[i], decVal(v)])));
};

export class Hrana {
  constructor(url, token) {
    this.base = String(url).replace(/^libsql:\/\//, 'https://').replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '');
    this.token = token;
  }

  async _call(requests, baton = null, base = this.base) {
    let res;
    try {
      res = await fetch(`${base}/v2/pipeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ baton, requests }),
      });
    } catch (e) {
      throw new DbError(`DB unreachable: ${e.message}`, 'DB_UNREACHABLE');
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not json */ }
    if (!res.ok || !data) throw new DbError(`DB http ${res.status}: ${text.slice(0, 200)}`, `DB_HTTP_${res.status}`);
    return data;
  }

  _unpack(data, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = data.results[i];
      if (!r || r.type === 'error') throw new DbError((r && r.error && r.error.message) || 'DB error', r && r.error && r.error.code);
      out.push(r.response.result);
    }
    return out;
  }

  async _one(statements) {
    const reqs = statements.map(([sql, args]) => ({ type: 'execute', stmt: { sql, args: (args || []).map(encArg) } }));
    reqs.push({ type: 'close' });
    return this._unpack(await this._call(reqs), statements.length);
  }

  async many(statements) {
    return (await this._one(statements)).map(toRows);
  }
  async all(sql, args) {
    return (await this.many([[sql, args]]))[0];
  }
  async get(sql, args) {
    return (await this.all(sql, args))[0] || null;
  }
  async run(sql, args) {
    const [r] = await this._one([[sql, args]]);
    return { changes: r.affected_row_count, lastId: r.last_insert_rowid === null || r.last_insert_rowid === undefined ? null : Number(r.last_insert_rowid) };
  }
  /** several statements in ONE request (no transaction; used for the idempotent schema) */
  async exec(statements) {
    await this._one(statements);
  }

  async tx(fn) {
    let baton = null;
    let base = this.base;
    const send = async (reqs) => {
      const data = await this._call(reqs, baton, base);
      if (data.base_url) base = String(data.base_url).replace(/\/+$/, '');
      baton = data.baton || null;
      return this._unpack(data, reqs.length);
    };
    const stmt = (sql, args) => ({ type: 'execute', stmt: { sql, args: (args || []).map(encArg) } });
    const t = {
      many: async (list) => (await send(list.map(([s, a]) => stmt(s, a)))).map(toRows),
      all: async (sql, args) => (await t.many([[sql, args]]))[0],
      get: async (sql, args) => (await t.all(sql, args))[0] || null,
      run: async (sql, args) => {
        const [r] = await send([stmt(sql, args)]);
        return { changes: r.affected_row_count, lastId: r.last_insert_rowid === null || r.last_insert_rowid === undefined ? null : Number(r.last_insert_rowid) };
      },
    };
    const closing = (sql) => send([stmt(sql), { type: 'close' }]);
    let began = false;
    try {
      for (let i = 0; ; i++) {
        try { await send([stmt('begin immediate')]); began = true; break; } catch (e) {
          if (i < 3 && /locked|busy/i.test(e.message)) { await new Promise((r) => setTimeout(r, 150 * (i + 1))); continue; }
          throw e;
        }
      }
      const out = await fn(t);
      began = false;
      await closing('commit');
      return out;
    } catch (e) {
      if (began && baton) { try { await closing('rollback'); } catch { /* connection already gone */ } }
      throw e;
    } finally {
      if (baton) { try { await this._call([{ type: 'close' }], baton, base); } catch { /* ignore */ } }
    }
  }
}

/* ===================================================================================================
 * 4. Passwords and tokens (Web Crypto: PBKDF2-SHA256, HMAC-SHA256)
 * ================================================================================================ */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
// Cloudflare's free plan gives a request about 10 ms of CPU time, and 100000 rounds (the platform maximum) can take
// longer than that. 20000 rounds cost ~3 ms. The round count is stored inside every hash, so changing it (variable
// PBKDF2_ITER, 1000..100000) never breaks existing passwords.
let PBKDF2_ITER = 20000;
const setIter = (env) => {
  const n = Math.floor(Number(env && env.PBKDF2_ITER));
  PBKDF2_ITER = n >= 1000 && n <= 100000 ? n : 20000;
};

async function pbkdf2(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64u(salt)}$${b64u(await pbkdf2(pw, salt, PBKDF2_ITER))}`;
}
async function checkPassword(pw, stored) {
  const [alg, iter, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(pw, unb64u(salt), Number(iter)));
  const want = unb64u(hash);
  let diff = got.length ^ want.length;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
const sha256Hex = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

let hmacKey = null;
async function signingKey(env) {
  if (!hmacKey) {
    const secret = String(env.JWT_SECRET || env.TURSO_TOKEN || '');
    if (secret.length < 16) throw new Fail('SERVER_NOT_CONFIGURED', { status: 500, code: 'XX000' });
    hmacKey = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`zp-jwt-v1|${secret}`)),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  return hmacKey;
}
const accessTtl = (env) => Number(env.ACCESS_TTL) || 3600;
async function signAccess(env, uid) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = accessTtl(env);
  const body = b64u(enc.encode(JSON.stringify({ sub: uid, iat: now, exp: now + ttl })));
  const sig = await crypto.subtle.sign('HMAC', await signingKey(env), enc.encode(body));
  return { token: `${body}.${b64u(sig)}`, exp: now + ttl, ttl };
}
async function readAccess(env, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return { err: 'JWT invalid' };
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await signingKey(env), unb64u(sig), enc.encode(body)); } catch { /* malformed */ }
  if (!ok) return { err: 'JWT invalid' };
  let p;
  try { p = JSON.parse(new TextDecoder().decode(unb64u(body))); } catch { return { err: 'JWT invalid' }; }
  if (!p.sub || p.exp <= Math.floor(Date.now() / 1000)) return { err: 'JWT expired' };
  return { uid: p.sub };
}

/* ===================================================================================================
 * 5. Sign-in / sign-up / refresh (GoTrue-shaped answers, so the web app needs no changes)
 * ================================================================================================ */
const REFRESH_DAYS = 60;
const authErr = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
const EMAIL_RE = /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { full_name: u.full_name }, created_at: u.created_at };
}
async function issue(env, db, u, before = []) {
  const { token, exp, ttl } = await signAccess(env, u.id);
  const refresh = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  // ONE request to the database: the caller's own statements, the new session, and forgetting expired sessions
  await db.exec([
    ...before,
    ['insert into sessions (user_id, token_hash, expires_at) values (?, ?, ?)', [u.id, await sha256Hex(refresh), new Date(now + REFRESH_DAYS * DAY_MS).toISOString()]],
    ['delete from sessions where expires_at < ?', [new Date(now).toISOString()]],
  ]);
  return { access_token: token, token_type: 'bearer', expires_in: ttl, expires_at: exp, refresh_token: refresh, user: userJson(u) };
}

async function authToken(env, db, grant, b) {
  if (grant === 'password') {
    const email = str(b.email).trim().toLowerCase();
    const pw = str(b.password);
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const [[f], [u]] = await db.many([
      ['select count(*) n from login_fails where key = ? and at > ?', [email, since]],
      ['select * from profiles where lower(email) = ?', [email]],
    ]);
    if (f.n >= 8) return authErr(429, 'over_request_rate_limit', 'Too many attempts, try again in a few minutes');
    const good = u ? await checkPassword(pw, u.pw_hash) : (await pbkdf2(pw, new Uint8Array(16), PBKDF2_ITER), false);
    if (!good) {
      await db.exec([
        ['insert into login_fails (key) values (?)', [email]],
        ['delete from login_fails where at < ?', [new Date(Date.now() - DAY_MS).toISOString()]],
      ]);
      return authErr(400, 'invalid_credentials', 'Invalid login credentials');
    }
    return {
      status: 200,
      body: await issue(env, db, u, [
        ['delete from login_fails where key = ?', [email]],
        ['update profiles set last_sign_in_at = ? where id = ?', [new Date().toISOString(), u.id]],
      ]),
    };
  }
  if (grant === 'refresh_token') {
    const h = await sha256Hex(str(b.refresh_token));
    const s = await db.get('select * from sessions where token_hash = ?', [h]);
    const bad = authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    if (!s || s.expires_at < new Date().toISOString()) return bad;
    const del = await db.run('delete from sessions where id = ?', [s.id]); // one use only
    if (!del.changes) return bad;
    const u = await db.get('select * from profiles where id = ?', [s.user_id]);
    if (!u) return bad;
    return { status: 200, body: await issue(env, db, u) };
  }
  return authErr(400, 'validation_failed', 'unsupported grant_type');
}

async function authSignup(env, db, b) {
  const email = str(b.email).trim().toLowerCase();
  const pw = str(b.password);
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  if (!EMAIL_RE.test(email)) return authErr(422, 'validation_failed', 'Unable to validate email address: invalid format');
  if (pw.length < 6) return authErr(422, 'weak_password', 'Password should be at least 6 characters.');
  if (pw.length > 72) return authErr(422, 'weak_password', 'Password is too long.');
  // a flood of sign-ups must not fill the database: 30 an hour in total (staff are added a few at a time)
  await db.run('delete from login_fails where at < ?', [new Date(Date.now() - DAY_MS).toISOString()]);
  const slot = await db.run(
    `insert into login_fails (key) select '*signup*' where (select count(*) from login_fails where key = '*signup*' and at > ?) < 30`,
    [new Date(Date.now() - 3600000).toISOString()],
  );
  if (!slot.changes) return authErr(429, 'over_request_rate_limit', 'Too many sign-ups, try again in a while');
  const pwHash = await hashPassword(pw);
  const id = crypto.randomUUID();
  // "owner+sara@gmail.com" -> user name "sara"; a plain "sara@shop.com" keeps its local part
  const local = email.split('@')[0];
  const plus = local.indexOf('+');
  let username = plus >= 0 ? local.slice(plus + 1) : local;
  const fullName = clip(nul(str(data.full_name).trim()) || username, 80);
  try {
    const u = await db.tx(async (t) => {
      if (await t.get('select 1 x from profiles where lower(email) = ?', [email])) return null;
      const first = (await t.get('select count(*) n from profiles')).n === 0;
      let uname = username;
      if (uname === '' || (await t.get('select 1 x from profiles where lower(username) = ?', [uname]))) uname = `${clip(uname, 50)}_${id.slice(0, 4)}`;
      await t.run('insert into profiles (id, email, username, full_name, role, active, pw_hash, approved_at) values (?,?,?,?,?,?,?,?)',
        [id, email, uname, fullName, first ? 'admin' : 'cashier', first ? 1 : 0, pwHash, first ? new Date().toISOString() : null]);
      return t.get('select * from profiles where id = ?', [id]);
    });
    if (!u) return authErr(422, 'user_already_exists', 'User already registered');
    return { status: 200, body: await issue(env, db, u) };
  } catch (e) {
    if (isUnique(e)) return authErr(422, 'user_already_exists', 'User already registered');
    throw e;
  }
}

async function authChangePassword(db, uid, b) {
  const pw = str(b.password);
  if (pw.length < 6 || pw.length > 72) return authErr(422, 'weak_password', 'Password should be at least 6 characters.');
  const u = await db.get('select pw_hash from profiles where id = ?', [uid]);
  if (!u) return authErr(401, 'bad_jwt', 'invalid JWT');
  if (await checkPassword(pw, u.pw_hash)) return authErr(422, 'same_password', 'New password should be different from the old password.');
  await db.run('update profiles set pw_hash = ? where id = ?', [await hashPassword(pw), uid]);
  return { status: 200, body: { id: uid } };
}

/* ===================================================================================================
 * 6. Shapes shared by several functions
 * ================================================================================================ */
const PRODUCT_SQL = `select p.*,
    (select max(s.created_at) from sale_items i join sales s on s.id = i.sale_id where i.product_id = p.id) as last_sold_at,
    (select max(pu.created_at) from purchases pu where pu.product_id = p.id and pu.voided_at is null) as last_purchase_at
  from products p`;
const productJson = (p) => ({
  id: p.id, name: p.name, code: p.code, category: p.category, price: p.price, min_stock: p.min_stock, active: !!p.active,
  stock: p.stock, stock_value: p.stock_value,
  avg_cost: p.stock > 0 ? mulDivRound(p.stock_value, 1, p.stock) : null,
  created_at: p.created_at, last_sold_at: p.last_sold_at, last_purchase_at: p.last_purchase_at,
});
const getProduct = async (x, id) => productJson(await x.get(`${PRODUCT_SQL} where p.id = ?`, [id]));

async function saleJson(x, id, role) {
  const [[s], items, returns] = await x.many([
    [`select s.*, ${displayName} as cashier_name,
        coalesce((select sum(r.refund) from sale_returns r where r.sale_id = s.id), 0) as refunded,
        coalesce((select sum(r.cost_back) from sale_returns r where r.sale_id = s.id), 0) as cost_back
      from sales s join profiles pr on pr.id = s.cashier_id where s.id = ?`, [id]],
    ['select * from sale_items where sale_id = ? order by id', [id]],
    [`select r.*, coalesce(nullif(rp.full_name, ''), rp.username) as by_name
      from sale_returns r join profiles rp on rp.id = r.created_by where r.sale_id = ? order by r.id`, [id]],
  ]);
  if (!s) return null;
  const adm = role === 'admin';
  return {
    id: s.id, created_at: s.created_at, cashier_id: s.cashier_id, cashier_name: s.cashier_name,
    subtotal: s.subtotal, discount: s.discount, total: s.total, note: s.note, refunded: s.refunded,
    cost_total: adm ? s.cost_total : null, cost_back: adm ? s.cost_back : null,
    items: items.map((i) => ({
      id: i.id, product_id: i.product_id, name: i.product_name, qty: i.qty, unit_price: i.unit_price,
      line_total: i.line_total, line_discount: i.line_discount, line_net: i.line_net,
      returned_qty: i.returned_qty, refunded: i.refunded,
      cost_total: adm ? i.cost_total : null, cost_returned: adm ? i.cost_returned : null,
    })),
    returns: returns.map((r) => ({
      id: r.id, sale_item_id: r.sale_item_id, qty: r.qty, refund: r.refund, restocked: !!r.restocked,
      reason: r.reason, created_at: r.created_at, by: r.by_name,
    })),
  };
}

/** stock coming in (new goods, and the opening stock of a new product) */
async function applyPurchase(t, { productId, qty, totalCost, supplier, note, kind, uid, clientId }) {
  if (qty === null || qty < 1 || qty > 1000000) fail('QTY_INVALID');
  if (totalCost === null || totalCost < 0 || totalCost > 1000000000000) fail('COST_INVALID');
  const p = await t.get('select stock, stock_value from products where id = ?', [productId]);
  if (!p) fail('PRODUCT_NOT_FOUND');
  const n = nul(clip(str(note).trim(), 300));
  const { lastId } = await t.run('insert into purchases (product_id, qty, total_cost, supplier, note, kind, created_by, client_id) values (?,?,?,?,?,?,?,?)',
    [productId, qty, totalCost, nul(clip(str(supplier).trim(), 120)), n, kind, uid, clientId]);
  await t.many([
    [`update products set stock = stock + ?, stock_value = stock_value + ?, updated_at = ${NOW} where id = ?`, [qty, totalCost, productId]],
    ['insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by) values (?,?,?,?,?,?,?,?,?)',
      [productId, kind, qty, totalCost, p.stock + qty, p.stock_value + totalCost, lastId, n, uid]],
  ]);
  return lastId;
}

const serviceJson = (e, admin, names) => ({
  id: e.id, kind: e.kind, title: e.title, profit: e.profit, created_at: e.created_at, created_by: e.created_by,
  cashier_name: names ? names[e.created_by] ?? null : e.cashier_name ?? null,
  voided: e.voided_at !== null && e.voided_at !== undefined,
  voided_at: admin ? e.voided_at : null,
  void_reason: admin ? e.void_reason : null,
});
const SERVICE_SQL = `select e.*, (select coalesce(nullif(p.full_name, ''), p.username) from profiles p where p.id = e.created_by) as cashier_name from service_entries e`;

/* ===================================================================================================
 * 7. The functions the web app calls   (name -> handler(ctx, args))
 *    ctx = { db, uid, staff(), admin() }
 * ================================================================================================ */
const RPC = {};
const def = (name, opts, fn) => { RPC[name] = { ...opts, fn }; };
const ANY = { auth: true };

def('needs_setup', { pub: true }, async (c) => (await c.db.get('select count(*) n from profiles')).n === 0);

def('my_profile', ANY, async (c) => {
  const p = await c.db.get('select id, username, full_name, role, active from profiles where id = ?', [c.uid]);
  return p ? { ...p, active: !!p.active } : null;
});

/* ---- settings ---- */
const settingsJson = (s) => ({
  shop_name: s.shop_name, shop_phone: s.shop_phone, shop_address: s.shop_address, receipt_footer: s.receipt_footer,
  cashier_max_discount_pct: s.cashier_max_discount_pct, cashier_can_return: !!s.cashier_can_return, return_window_days: s.return_window_days,
});
const getSettings = async (x) => {
  const s = await x.get('select * from shop_settings where id = 1');
  if (s) return s;
  await x.run('insert or ignore into shop_settings (id) values (1)');
  return x.get('select * from shop_settings where id = 1');
};
def('get_settings', ANY, async (c) => { await c.staff(); return settingsJson(await getSettings(c.db)); });
def('save_settings', ANY, async (c, a) => {
  await c.admin();
  const p = a.p || {};
  const pct = toInt(p.cashier_max_discount_pct);
  const win = toInt(p.return_window_days);
  if ((pct !== null && (pct < 0 || pct > 100)) || (win !== null && (win < 0 || win > 3650))) fail('SETTINGS_INVALID');
  const trimmed = (k) => (p[k] === null || p[k] === undefined ? null : str(p[k]).trim());
  const name = trimmed('shop_name');
  return c.db.tx(async (t) => {
    const cur = await getSettings(t);
    const next = {
      shop_name: name ? name : cur.shop_name,
      shop_phone: trimmed('shop_phone') ?? cur.shop_phone,
      shop_address: trimmed('shop_address') ?? cur.shop_address,
      receipt_footer: trimmed('receipt_footer') ?? cur.receipt_footer,
      pct: pct ?? cur.cashier_max_discount_pct,
      can: p.cashier_can_return === null || p.cashier_can_return === undefined ? cur.cashier_can_return : (toBool(p.cashier_can_return, true) ? 1 : 0),
      win: win ?? cur.return_window_days,
    };
    await t.run(`update shop_settings set shop_name=?, shop_phone=?, shop_address=?, receipt_footer=?, cashier_max_discount_pct=?,
                 cashier_can_return=?, return_window_days=?, updated_at=${NOW} where id = 1`,
      [next.shop_name, next.shop_phone, next.shop_address, next.receipt_footer, next.pct, next.can, next.win]);
    return settingsJson(await t.get('select * from shop_settings where id = 1'));
  });
});

/* ---- products and stock ---- */
def('pos_products', ANY, async (c) => {
  await c.staff();
  const rows = await c.db.all('select id, name, code, category, price, stock from products where active = 1 order by id');
  return rows;
});
def('admin_products', ANY, async (c) => {
  await c.admin();
  return (await c.db.all(`${PRODUCT_SQL} order by p.id desc`)).map(productJson);
});

def('save_product', ANY, async (c, a) => {
  await c.admin();
  const p = a.p || {};
  const id = toInt(p.id);
  const name = str(p.name).trim();
  const code = nul(str(p.code).trim());
  const cat = nul(str(p.category).trim());
  const price = toInt(p.price, 'PRICE_INVALID') ?? 0;
  const min = toInt(p.min_stock, 'MIN_STOCK_INVALID') ?? 0;
  const active = toBool(p.active, true);
  const qty = toInt(p.opening_qty, 'QTY_INVALID') ?? 0;
  const cost = toInt(p.opening_cost, 'COST_INVALID');
  if (name === '') fail('NAME_REQUIRED');
  if (price < 0 || price > 1000000000000) fail('PRICE_INVALID');
  if (min < 0 || min > 1000000) fail('MIN_STOCK_INVALID');
  try {
    return await c.db.tx(async (t) => {
      let pid = id;
      if (pid === null) {
        if (qty < 0) fail('QTY_INVALID');
        if (qty > 0 && cost === null) fail('COST_REQUIRED');
        pid = (await t.run('insert into products (name, code, category, price, min_stock, active) values (?,?,?,?,?,?)',
          [name, code, cat, price, min, active ? 1 : 0])).lastId;
        if (qty > 0) await applyPurchase(t, { productId: pid, qty, totalCost: cost, supplier: null, note: null, kind: 'opening', uid: c.uid, clientId: null });
      } else {
        const r = await t.run(`update products set name=?, code=?, category=?, price=?, min_stock=?, active=?, updated_at=${NOW} where id = ?`,
          [name, code, cat, price, min, active ? 1 : 0, pid]);
        if (!r.changes) fail('PRODUCT_NOT_FOUND');
      }
      return getProduct(t, pid);
    });
  } catch (e) {
    if (isUnique(e)) fail('CODE_TAKEN', { code });
    throw e;
  }
});

def('set_product_active', ANY, async (c, a) => {
  await c.admin();
  const id = toInt(a.p_id);
  const r = await c.db.run(`update products set active = ?, updated_at = ${NOW} where id = ?`, [toBool(a.p_active, true) ? 1 : 0, id]);
  if (!r.changes) fail('PRODUCT_NOT_FOUND');
  return getProduct(c.db, id);
});

def('delete_product', ANY, async (c, a) => {
  await c.admin();
  const id = toInt(a.p_id);
  return c.db.tx(async (t) => {
    if (await t.get('select 1 x from sale_items where product_id = ? limit 1', [id])) fail('PRODUCT_HAS_SALES');
    if (await t.get('select 1 x from sale_returns where product_id = ? limit 1', [id])) fail('PRODUCT_HAS_SALES');
    await t.run('delete from stock_movements where product_id = ?', [id]);
    await t.run('delete from purchases where product_id = ?', [id]);
    const r = await t.run('delete from products where id = ?', [id]);
    if (!r.changes) fail('PRODUCT_NOT_FOUND');
    return { ok: true };
  });
});

def('add_stock', ANY, async (c, a) => {
  await c.admin();
  const pid = toInt(a.p_product_id);
  const clientId = toUuid(a.p_client_id);
  return c.db.tx(async (t) => {
    if (clientId) {
      const dup = await t.get('select id from purchases where client_id = ?', [clientId]);
      if (dup) return { purchase_id: dup.id, product: await getProduct(t, pid), duplicate: true };
    }
    const id = await applyPurchase(t, {
      productId: pid, qty: toInt(a.p_qty), totalCost: toInt(a.p_total_cost), supplier: a.p_supplier, note: a.p_note,
      kind: 'purchase', uid: c.uid, clientId,
    });
    return { purchase_id: id, product: await getProduct(t, pid) };
  });
});

// fix a wrong count: the average cost stays the same
def('adjust_stock', ANY, async (c, a) => {
  await c.admin();
  const pid = toInt(a.p_product_id);
  const ns = toInt(a.p_new_stock);
  const note = str(a.p_note).trim();
  if (ns === null || ns < 0 || ns > 1000000) fail('QTY_INVALID');
  if (note === '') fail('REASON_REQUIRED');
  return c.db.tx(async (t) => {
    const p = await t.get('select * from products where id = ?', [pid]);
    if (!p) fail('PRODUCT_NOT_FOUND');
    const delta = ns - p.stock;
    if (delta === 0) fail('NO_CHANGE');
    let vchange;
    if (delta > 0) {
      let unit; // as [numerator, denominator]
      if (p.stock > 0) unit = [p.stock_value, p.stock];
      else {
        const last = await t.get('select total_cost, qty from purchases where product_id = ? and voided_at is null order by id desc limit 1', [pid]);
        unit = last ? [mulDivRound(last.total_cost, 1, last.qty), 1] : [0, 1];
      }
      vchange = mulDivRound(unit[0] * 1, delta, unit[1]);
    } else if (ns === 0) vchange = -p.stock_value;
    else vchange = -mulDivRound(p.stock_value, -delta, p.stock);
    await t.run(`update products set stock = ?, stock_value = stock_value + ?, updated_at = ${NOW} where id = ?`, [ns, vchange, pid]);
    const n = await t.get('select stock, stock_value from products where id = ?', [pid]);
    await t.run('insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, note, created_by) values (?,?,?,?,?,?,?,?)',
      [pid, 'adjust', delta, vchange, n.stock, n.stock_value, clip(note, 300), c.uid]);
    return getProduct(t, pid);
  });
});

// undo an arrival typed by mistake (only while nothing else happened to that product since)
def('void_purchase', ANY, async (c, a) => {
  await c.admin();
  const id = toInt(a.p_purchase_id);
  return c.db.tx(async (t) => {
    const pu = await t.get('select * from purchases where id = ?', [id]);
    if (!pu) fail('PURCHASE_NOT_FOUND');
    if (pu.voided_at !== null) fail('ALREADY_VOIDED');
    const last = (await t.get('select max(id) m from stock_movements where product_id = ?', [pu.product_id])).m;
    const mine = (await t.get("select max(id) m from stock_movements where product_id = ? and kind in ('purchase','opening') and ref_id = ?", [pu.product_id, pu.id])).m;
    if (last !== mine) fail('PURCHASE_NOT_LAST');
    await t.run(`update products set stock = stock - ?, stock_value = stock_value - ?, updated_at = ${NOW} where id = ?`, [pu.qty, pu.total_cost, pu.product_id]);
    await t.run(`update purchases set voided_at = ${NOW} where id = ?`, [pu.id]);
    const n = await t.get('select stock, stock_value from products where id = ?', [pu.product_id]);
    await t.run('insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, created_by) values (?,?,?,?,?,?,?,?)',
      [pu.product_id, 'void', -pu.qty, -pu.total_cost, n.stock, n.stock_value, pu.id, c.uid]);
    return getProduct(t, pu.product_id);
  });
});

def('list_movements', ANY, async (c, a) => {
  await c.admin();
  const [b0, b1] = bounds(a.p_from, a.p_to);
  const limit = Math.min(Math.max(toInt(a.p_limit) ?? 200, 1), 1000);
  const offset = Math.max(toInt(a.p_offset) ?? 0, 0);
  const pid = toInt(a.p_product_id);
  const kind = a.p_kind === undefined || a.p_kind === '' ? null : a.p_kind;
  const where = 'm.created_at >= ? and m.created_at < ? and (? is null or m.product_id = ?) and (? is null or m.kind = ?)';
  const args = [b0, b1, pid, pid, kind, kind];
  const [[cnt], rows] = await c.db.many([
    [`select count(*) n from stock_movements m where ${where}`, args],
    [`select m.*, p.name as product_name, coalesce(nullif(pr.full_name, ''), pr.username) as by_name,
        case when m.kind in ('purchase','opening') then (select pu.voided_at is not null from purchases pu where pu.id = m.ref_id) end as purchase_voided,
        case when m.kind in ('purchase','opening') then (select pu.supplier from purchases pu where pu.id = m.ref_id) end as supplier
      from stock_movements m join products p on p.id = m.product_id left join profiles pr on pr.id = m.created_by
      where ${where} order by m.id desc limit ? offset ?`, [...args, limit, offset]],
  ]);
  return {
    count: cnt.n,
    rows: rows.map((m) => ({
      id: m.id, created_at: m.created_at, product_id: m.product_id, product_name: m.product_name, kind: m.kind,
      qty_change: m.qty_change, value_change: m.value_change, stock_after: m.stock_after, value_after: m.value_after,
      ref_id: m.ref_id, note: m.note, by: m.by_name,
      purchase_voided: m.purchase_voided === null || m.purchase_voided === undefined ? null : !!m.purchase_voided,
      supplier: m.supplier ?? null,
    })),
  };
});

/* ---- selling and returns ---- */
// Prices and costs come from the database, never from the browser. client_id makes a retry safe.
def('create_sale', ANY, async (c, a) => {
  const role = await c.staff();
  const items = a.p_items;
  const discount = toInt(a.p_discount) ?? 0;
  const clientId = toUuid(a.p_client_id);
  return c.db.tx(async (t) => {
    if (clientId) {
      const dup = await t.get('select id from sales where client_id = ?', [clientId]);
      if (dup) return saleJson(t, dup.id, role);
    }
    if (!Array.isArray(items) || items.length === 0) fail('EMPTY_CART');
    if (items.length > 300) fail('TOO_MANY_LINES');
    // merge duplicate products, keep the cart order
    const merged = new Map();
    for (const it of items) {
      const pid = it && toInt(it.product_id, 'BAD_ITEMS');
      const q = it && toInt(it.qty, 'BAD_ITEMS');
      if (pid === null || q === null) fail('BAD_ITEMS');
      merged.set(pid, (merged.get(pid) || 0) + q);
    }
    const lines = [];
    for (const [pid, q] of merged) {
      if (q < 1 || q > 100000) fail('BAD_ITEMS');
      lines.push({ pid, qty: q });
    }
    let subtotal = 0;
    const found = new Map((await t.all(`select * from products where id in (${lines.map(() => '?').join(',')})`, lines.map((l) => l.pid))).map((p) => [p.id, p]));
    for (const l of lines) {
      const p = found.get(l.pid);
      if (!p || !p.active) fail('PRODUCT_UNAVAILABLE', { product_id: l.pid });
      if (p.stock < l.qty) fail('STOCK_INSUFFICIENT', { product_id: p.id, name: p.name, available: p.stock, requested: l.qty });
      Object.assign(l, { name: p.name, price: p.price, stock: p.stock, value: p.stock_value });
      subtotal += p.price * l.qty;
      if (subtotal > 9e15) fail('BAD_ITEMS');
    }
    if (discount < 0) fail('DISCOUNT_INVALID');
    if (discount > subtotal) fail('DISCOUNT_TOO_HIGH');
    if (role === 'cashier' && discount > 0) {
      const set = await getSettings(t);
      const max = mulDivFloor(subtotal, set.cashier_max_discount_pct, 100);
      if (discount > max) fail('DISCOUNT_NOT_ALLOWED', { max, pct: set.cashier_max_discount_pct });
    }
    const saleId = (await t.run('insert into sales (cashier_id, subtotal, discount, total, cost_total, note, client_id) values (?,?,?,?,?,?,?)',
      [c.uid, subtotal, discount, subtotal - discount, 0, nul(clip(str(a.p_note).trim(), 500)), clientId])).lastId;
    let cumGross = 0;
    let prevDisc = 0;
    let costSum = 0;
    const writes = [];
    for (const l of lines) {
      const gross = l.price * l.qty;
      cumGross += gross;
      // the discount is shared between the lines in proportion; the shares add up exactly
      const cumDisc = subtotal === 0 ? 0 : mulDivFloor(discount, cumGross, subtotal);
      const lineDisc = cumDisc - prevDisc;
      prevDisc = cumDisc;
      // cost of the units sold = their share of the stock value (the last units take whatever is left)
      const cost = l.qty >= l.stock ? l.value : Math.min(mulDivRound(l.value, l.qty, l.stock), l.value);
      writes.push(
        [`update products set stock = stock - ?, stock_value = stock_value - ?, updated_at = ${NOW} where id = ?`, [l.qty, cost, l.pid]],
        ['insert into sale_items (sale_id, product_id, product_name, qty, unit_price, line_total, line_discount, line_net, cost_total) values (?,?,?,?,?,?,?,?,?)',
          [saleId, l.pid, l.name, l.qty, l.price, gross, lineDisc, gross - lineDisc, cost]],
        ['insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, created_by) values (?,?,?,?,?,?,?,?)',
          [l.pid, 'sale', -l.qty, -cost, l.stock - l.qty, l.value - cost, saleId, c.uid]]);
      costSum += cost;
    }
    writes.push(['update sales set cost_total = ? where id = ?', [costSum, saleId]]);
    await t.many(writes);
    return saleJson(t, saleId, role);
  });
});

def('get_sale', ANY, async (c, a) => {
  const role = await c.staff();
  const id = toInt(a.p_sale_id);
  const s = await c.db.get('select id, cashier_id, created_at from sales where id = ?', [id]);
  if (!s) fail('SALE_NOT_FOUND');
  if (role === 'cashier') {
    const set = await getSettings(c.db);
    const day = dayOf(s.created_at);
    const today = todayBaghdad();
    if (!(s.cashier_id === c.uid && day === today)) {
      if (!set.cashier_can_return || day < isoDate(dayMs(today) - set.return_window_days * DAY_MS)) forbid('NOT_AUTHORIZED');
    }
  }
  return saleJson(c.db, id, role);
});

def('list_sales', ANY, async (c, a) => {
  const role = await c.staff();
  let b;
  let cashier = toUuid(a.p_cashier);
  if (role === 'cashier') {
    b = bounds(todayBaghdad(), todayBaghdad());
    cashier = c.uid;
  } else b = bounds(a.p_from, a.p_to);
  const limit = Math.min(Math.max(toInt(a.p_limit) ?? 100, 1), 500);
  const offset = Math.max(toInt(a.p_offset) ?? 0, 0);
  const search = nul(str(a.p_search).trim());
  let like = null;
  let sid = null;
  if (search !== null) {
    like = `%${search.replace(/([\\%_])/g, '\\$1')}%`;
    if (/^#?[0-9]{1,15}$/.test(search)) sid = Number(search.replace(/^#/, ''));
  }
  const where = `s.created_at >= ? and s.created_at < ? and (? is null or s.cashier_id = ?)
     and (? is null or s.id = ? or exists (select 1 from sale_items i where i.sale_id = s.id and i.product_name like ? escape '\\'))`;
  const args = [b[0], b[1], cashier, cashier, search, sid, like];
  const [[cnt], rows] = await c.db.many([
    [`select count(*) n from sales s where ${where}`, args],
    [`select s.*, ${displayName} as cashier_name,
        (select coalesce(sum(i.qty), 0) from sale_items i where i.sale_id = s.id) as qty,
        (select count(*) from sale_items i where i.sale_id = s.id) as lines,
        coalesce((select sum(r.refund) from sale_returns r where r.sale_id = s.id), 0) as refunded,
        coalesce((select sum(r.cost_back) from sale_returns r where r.sale_id = s.id), 0) as cost_back
      from sales s join profiles pr on pr.id = s.cashier_id where ${where}
      order by s.created_at desc, s.id desc limit ? offset ?`, [...args, limit, offset]],
  ]);
  const adm = role === 'admin';
  return {
    count: cnt.n,
    rows: rows.map((s) => ({
      id: s.id, created_at: s.created_at, cashier_id: s.cashier_id, cashier_name: s.cashier_name, qty: s.qty, lines: s.lines,
      subtotal: s.subtotal, discount: s.discount, total: s.total, refunded: s.refunded,
      cost_total: adm ? s.cost_total : null, cost_back: adm ? s.cost_back : null, note: s.note,
    })),
  };
});

// take back some units of one receipt line. The refund is the customer's real price for those units
// (after any discount); the cost goes back into stock only when restocking (false = damaged, written off).
def('process_return', ANY, async (c, a) => {
  const role = await c.staff();
  const itemId = toInt(a.p_sale_item_id);
  const qty = toInt(a.p_qty);
  const reason = str(a.p_reason).trim();
  const restock = toBool(a.p_restock, true);
  const clientId = toUuid(a.p_client_id);
  return c.db.tx(async (t) => {
    if (clientId) {
      const prev = await t.get('select sale_id from sale_returns where client_id = ?', [clientId]);
      if (prev) return saleJson(t, prev.sale_id, role);
    }
    if (reason === '') fail('REASON_REQUIRED');
    const item = await t.get('select * from sale_items where id = ?', [itemId]);
    if (!item) fail('ITEM_NOT_FOUND');
    const sale = await t.get('select created_at from sales where id = ?', [item.sale_id]);
    if (role === 'cashier') {
      const set = await getSettings(t);
      if (!set.cashier_can_return) forbid('RETURNS_DISABLED');
      if (dayOf(sale.created_at) < isoDate(dayMs(todayBaghdad()) - set.return_window_days * DAY_MS)) fail('RETURN_WINDOW_EXPIRED', { days: set.return_window_days });
    }
    if (qty === null || qty < 1 || qty > item.qty - item.returned_qty) fail('RETURN_QTY_INVALID', { max: item.qty - item.returned_qty });
    // cumulative shares: the pieces always add up to exactly the line total
    const after = item.returned_qty + qty;
    const refund = prorate(item.line_net, after, item.qty) - prorate(item.line_net, item.returned_qty, item.qty);
    const share = prorate(item.cost_total, after, item.qty) - prorate(item.cost_total, item.returned_qty, item.qty);
    const costBack = restock ? share : 0;
    const p = await t.get('select * from products where id = ?', [item.product_id]);
    await t.run('update sale_items set returned_qty = ?, refunded = refunded + ?, cost_returned = cost_returned + ? where id = ?', [after, refund, costBack, item.id]);
    const retId = (await t.run('insert into sale_returns (sale_id, sale_item_id, product_id, qty, refund, cost_back, restocked, reason, created_by, client_id) values (?,?,?,?,?,?,?,?,?,?)',
      [item.sale_id, item.id, item.product_id, qty, refund, costBack, restock ? 1 : 0, clip(reason, 300), c.uid, clientId])).lastId;
    if (restock) {
      await t.run(`update products set stock = stock + ?, stock_value = stock_value + ?, updated_at = ${NOW} where id = ?`, [qty, costBack, p.id]);
      await t.run('insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by) values (?,?,?,?,?,?,?,?,?)',
        [p.id, 'return', qty, costBack, p.stock + qty, p.stock_value + costBack, retId, clip(reason, 300), c.uid]);
    } else {
      await t.run('insert into stock_movements (product_id, kind, qty_change, value_change, stock_after, value_after, ref_id, note, created_by) values (?,?,?,?,?,?,?,?,?)',
        [p.id, 'return_loss', 0, 0, p.stock, p.stock_value, retId, clip(reason, 300), c.uid]);
    }
    return saleJson(t, item.sale_id, role);
  });
});

def('list_returns', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const rows = await c.db.all(`select r.*, i.product_name, coalesce(nullif(pr.full_name, ''), pr.username) as by_name
      from sale_returns r join sale_items i on i.id = r.sale_item_id join profiles pr on pr.id = r.created_by
     where r.created_at >= ? and r.created_at < ? order by r.id desc`, b);
  return rows.map((r) => ({
    id: r.id, created_at: r.created_at, sale_id: r.sale_id, product_name: r.product_name, qty: r.qty, refund: r.refund,
    cost_back: r.cost_back, restocked: !!r.restocked, reason: r.reason, by: r.by_name,
  }));
});

/* ---- reports (admin). Sales count on the day they were made; refunds on the day they were paid back ---- */
def('report_summary', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const [[s], [r], [pu], [st]] = await c.db.many([
    [`select count(*) as receipts, coalesce(sum(subtotal),0) as gross, coalesce(sum(discount),0) as discount,
        coalesce(sum(total),0) as sales_net, coalesce(sum(cost_total),0) as cogs,
        coalesce((select sum(i.qty) from sale_items i join sales x on x.id = i.sale_id where x.created_at >= ? and x.created_at < ?), 0) as items
      from sales where created_at >= ? and created_at < ?`, [...b, ...b]],
    ['select count(*) as refund_count, coalesce(sum(refund),0) as refunds, coalesce(sum(cost_back),0) as cost_back, coalesce(sum(qty),0) as qty from sale_returns where created_at >= ? and created_at < ?', b],
    ['select coalesce(sum(total_cost),0) as spent from purchases where created_at >= ? and created_at < ? and voided_at is null', b],
    [`select coalesce(sum(stock_value),0) as stock_value, coalesce(sum(stock),0) as stock_units,
        coalesce(sum(case when active = 1 then 1 else 0 end),0) as products_active,
        coalesce(sum(case when active = 1 and stock = 0 then 1 else 0 end),0) as out_of_stock,
        coalesce(sum(case when active = 1 and stock > 0 and stock <= min_stock then 1 else 0 end),0) as low_stock
      from products`, []],
  ]);
  return {
    receipts: s.receipts, items: s.items, gross: s.gross, discount: s.discount, sales_net: s.sales_net,
    refund_count: r.refund_count, refund_qty: r.qty, refunds: r.refunds,
    revenue: s.sales_net - r.refunds, cogs: s.cogs, cost_back: r.cost_back, cost: s.cogs - r.cost_back,
    profit: s.sales_net - r.refunds - (s.cogs - r.cost_back),
    purchases_spent: pu.spent, stock_value: st.stock_value, stock_units: st.stock_units,
    products_active: st.products_active, out_of_stock: st.out_of_stock, low_stock: st.low_stock,
  };
});

def('report_daily', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const [sales, rets] = await c.db.many([
    [`select date(s.created_at, '+3 hours') as day, count(*) as receipts, sum(s.subtotal) as gross, sum(s.discount) as discount,
        sum(s.total) as sales_net, sum(s.cost_total) as cogs,
        sum((select sum(i.qty) from sale_items i where i.sale_id = s.id)) as items
      from sales s where s.created_at >= ? and s.created_at < ? group by 1`, b],
    [`select date(created_at, '+3 hours') as day, sum(refund) as refunds, sum(cost_back) as cost_back
      from sale_returns where created_at >= ? and created_at < ? group by 1`, b],
  ]);
  const S = new Map(sales.map((x) => [x.day, x]));
  const R = new Map(rets.map((x) => [x.day, x]));
  return eachDay(a.p_from, a.p_to).map((day) => {
    const s = S.get(day) || {};
    const r = R.get(day) || {};
    const net = s.sales_net || 0;
    const refunds = r.refunds || 0;
    const cost = (s.cogs || 0) - (r.cost_back || 0);
    return {
      day, receipts: s.receipts || 0, items: s.items || 0, gross: s.gross || 0, discount: s.discount || 0, sales_net: net,
      refunds, revenue: net - refunds, cost, profit: net - refunds - cost,
    };
  });
});

def('report_products', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const [sold, rets] = await c.db.many([
    [`select i.product_id, sum(i.qty) as qty, sum(i.line_net) as net, sum(i.cost_total) as cogs, count(distinct i.sale_id) as receipts
      from sale_items i join sales sa on sa.id = i.sale_id where sa.created_at >= ? and sa.created_at < ? group by i.product_id`, b],
    ['select product_id, sum(qty) as qty, sum(refund) as refunds, sum(cost_back) as cost_back from sale_returns where created_at >= ? and created_at < ? group by product_id', b],
  ]);
  const ids = [...new Set([...sold.map((x) => x.product_id), ...rets.map((x) => x.product_id)])];
  if (!ids.length) return [];
  const prods = await c.db.all(`select id, name, category, stock, price from products where id in (${ids.map(() => '?').join(',')})`, ids);
  const S = new Map(sold.map((x) => [x.product_id, x]));
  const R = new Map(rets.map((x) => [x.product_id, x]));
  const out = prods.map((p) => {
    const s = S.get(p.id) || {};
    const r = R.get(p.id) || {};
    const revenue = (s.net || 0) - (r.refunds || 0);
    const cost = (s.cogs || 0) - (r.cost_back || 0);
    return {
      id: p.id, name: p.name, category: p.category, stock: p.stock, price: p.price,
      qty_sold: s.qty || 0, qty_returned: r.qty || 0, net_qty: (s.qty || 0) - (r.qty || 0), receipts: s.receipts || 0,
      sales_net: s.net || 0, refunds: r.refunds || 0, revenue, cost, profit: revenue - cost,
    };
  });
  return out.sort((x, y) => y.revenue - x.revenue || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
});

// products that did NOT sell at all in the period (capital sitting on the shelf)
def('report_unsold', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const rows = await c.db.all(`select p.id, p.name, p.category, p.price, p.stock, p.stock_value, p.created_at,
      (select max(sa.created_at) from sale_items i join sales sa on sa.id = i.sale_id where i.product_id = p.id) as last_sold_at,
      (select max(pu.created_at) from purchases pu where pu.product_id = p.id and pu.voided_at is null) as last_purchase_at
    from products p
   where p.active = 1 and not exists (select 1 from sale_items i join sales sa on sa.id = i.sale_id
                                      where i.product_id = p.id and sa.created_at >= ? and sa.created_at < ?)
   order by p.stock_value desc, p.name`, b);
  return rows;
});

def('report_cashiers', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const [people, sold, rets] = await c.db.many([
    ['select id, username, full_name, role, created_at from profiles order by created_at', []],
    ['select cashier_id, count(*) as receipts, sum(total) as net, sum(discount) as discount from sales where created_at >= ? and created_at < ? group by cashier_id', b],
    ['select created_by, count(*) as cnt, sum(refund) as refunds from sale_returns where created_at >= ? and created_at < ? group by created_by', b],
  ]);
  const S = new Map(sold.map((x) => [x.cashier_id, x]));
  const R = new Map(rets.map((x) => [x.created_by, x]));
  return people.filter((p) => S.has(p.id) || R.has(p.id)).map((p) => {
    const s = S.get(p.id) || {};
    const r = R.get(p.id) || {};
    return {
      id: p.id, name: p.full_name || p.username, role: p.role, receipts: s.receipts || 0, sales_net: s.net || 0,
      discount: s.discount || 0, returns: r.cnt || 0, refunds: r.refunds || 0, _o: p.created_at,
    };
  }).sort((x, y) => y.sales_net - x.sales_net || (x._o < y._o ? -1 : 1)).map(({ _o, ...rest }) => rest);
});

/* ---- staff (admin) ---- */
def('list_staff', ANY, async (c) => {
  await c.admin();
  const rows = await c.db.all(`select p.id, p.username, p.full_name, p.role, p.active, p.created_at, p.approved_at, p.last_sign_in_at,
      (select count(*) from sales s where s.cashier_id = p.id) as sales_count from profiles p order by p.created_at`);
  return rows.map((p) => ({ ...p, active: !!p.active }));
});

def('update_staff', ANY, async (c, a) => {
  await c.admin();
  const id = toUuid(a.p_id);
  const role = a.p_role;
  const active = a.p_active === true || a.p_active === 'true';
  return c.db.tx(async (t) => {
    const cur = await t.get('select * from profiles where id = ?', [id]);
    if (!cur) fail('STAFF_NOT_FOUND');
    if (role !== 'admin' && role !== 'cashier') fail('ROLE_INVALID');
    if (id === c.uid && (role !== 'admin' || !active)) fail('CANNOT_CHANGE_SELF');
    const full = clip(nul(str(a.p_full_name).trim()) || cur.username, 80);
    await t.run(`update profiles set full_name = ?, role = ?, active = ?, approved_at = case when ? = 1 then coalesce(approved_at, ${NOW}) else approved_at end where id = ?`,
      [full, role, active ? 1 : 0, active ? 1 : 0, id]);
    return { ok: true };
  });
});

def('delete_staff', ANY, async (c, a) => {
  await c.admin();
  const id = toUuid(a.p_id);
  if (id === c.uid) fail('CANNOT_CHANGE_SELF');
  return c.db.tx(async (t) => {
    const has = await t.get(`select 1 x where exists (select 1 from sales where cashier_id = ?1) or exists (select 1 from purchases where created_by = ?1)
        or exists (select 1 from sale_returns where created_by = ?1) or exists (select 1 from stock_movements where created_by = ?1)
        or exists (select 1 from service_entries where created_by = ?1 or voided_by = ?1)`, [id]);
    if (has) fail('STAFF_HAS_HISTORY');
    await t.run('delete from sessions where user_id = ?', [id]);
    const r = await t.run('delete from profiles where id = ?', [id]);
    if (!r.changes) fail('STAFF_NOT_FOUND');
    return { ok: true };
  });
});

def('admin_set_password', ANY, async (c, a) => {
  await c.admin();
  const pw = a.p_password;
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 72) fail('PASSWORD_INVALID');
  const id = toUuid(a.p_id);
  const hash = await hashPassword(pw);
  const r = await c.db.run('update profiles set pw_hash = ? where id = ?', [hash, id]);
  if (!r.changes) fail('STAFF_NOT_FOUND');
  await c.db.run('delete from sessions where user_id = ?', [id]);
  return { ok: true };
});

/* ---- services: repairs and phone cards (only the shop's own profit is recorded) ---- */
def('add_service', ANY, async (c, a) => {
  const role = await c.staff();
  const kind = a.p_kind;
  const profit = toInt(a.p_profit);
  if (kind !== 'repair' && kind !== 'card') fail('BAD_KIND');
  if (profit === null || profit < 1 || profit > 100000000) fail('BAD_AMOUNT');
  const title = nul(clip(str(a.p_title).trim(), 120));
  const clientId = toUuid(a.p_client_id);
  return c.db.tx(async (t) => {
    if (clientId) {
      const dup = await t.get(`${SERVICE_SQL} where e.client_id = ?`, [clientId]);
      if (dup) return serviceJson(dup, role === 'admin');
    }
    const id = (await t.run('insert into service_entries (kind, title, profit, created_by, client_id) values (?,?,?,?,?)', [kind, title, profit, c.uid, clientId])).lastId;
    return serviceJson(await t.get(`${SERVICE_SQL} where e.id = ?`, [id]), role === 'admin');
  });
});

// Admin: any period / kind / cashier. Cashier: only his own entries of today.
def('list_services', ANY, async (c, a) => {
  const role = await c.staff();
  const admin = role === 'admin';
  let from = a.p_from;
  let to = a.p_to;
  let cash = toUuid(a.p_cashier);
  if (!admin) { from = todayBaghdad(); to = from; cash = c.uid; }
  const kind = a.p_kind === undefined || a.p_kind === '' ? null : a.p_kind;
  if (kind !== null && kind !== 'repair' && kind !== 'card') fail('BAD_KIND');
  const b = bounds(from, to);
  const limit = Math.max(1, Math.min(toInt(a.p_limit) ?? 100, 500));
  const offset = Math.max(0, toInt(a.p_offset) ?? 0);
  const where = 'e.created_at >= ? and e.created_at < ? and (? is null or e.kind = ?) and (? is null or e.created_by = ?) and (? = 1 or e.voided_at is null)';
  const args = [b[0], b[1], kind, kind, cash, cash, admin ? 1 : 0];
  const [[t], rows] = await c.db.many([
    [`select count(*) as all_count,
        coalesce(sum(case when e.voided_at is null then 1 else 0 end),0) as cnt,
        coalesce(sum(case when e.voided_at is null then e.profit else 0 end),0) as profit,
        coalesce(sum(case when e.voided_at is null and e.kind='repair' then 1 else 0 end),0) as repair_count,
        coalesce(sum(case when e.voided_at is null and e.kind='repair' then e.profit else 0 end),0) as repair_profit,
        coalesce(sum(case when e.voided_at is null and e.kind='card' then 1 else 0 end),0) as card_count,
        coalesce(sum(case when e.voided_at is null and e.kind='card' then e.profit else 0 end),0) as card_profit
      from service_entries e where ${where}`, args],
    [`${SERVICE_SQL} where ${where} order by e.created_at desc, e.id desc limit ? offset ?`, [...args, limit, offset]],
  ]);
  return {
    count: t.all_count, active_count: t.cnt, profit: t.profit, repair_count: t.repair_count, repair_profit: t.repair_profit,
    card_count: t.card_count, card_profit: t.card_profit, rows: rows.map((e) => serviceJson(e, admin)),
  };
});

// cancel a wrongly typed entry (admin only). The row stays, marked as cancelled.
def('void_service', ANY, async (c, a) => {
  await c.admin();
  const id = toInt(a.p_id);
  return c.db.tx(async (t) => {
    const e = await t.get('select * from service_entries where id = ?', [id]);
    if (!e) fail('NOT_FOUND');
    if (e.voided_at === null) {
      await t.run(`update service_entries set voided_at = ${NOW}, voided_by = ?, void_reason = ? where id = ?`,
        [c.uid, nul(clip(str(a.p_reason).trim(), 200)), id]);
    }
    return serviceJson(await t.get(`${SERVICE_SQL} where e.id = ?`, [id]), true);
  });
});

def('service_summary', ANY, async (c, a) => {
  await c.admin();
  const b = bounds(a.p_from, a.p_to);
  const [[t], days] = await c.db.many([
    [`select count(*) as cnt, coalesce(sum(profit),0) as profit,
        coalesce(sum(case when kind='repair' then 1 else 0 end),0) as repair_count,
        coalesce(sum(case when kind='repair' then profit else 0 end),0) as repair_profit,
        coalesce(sum(case when kind='card' then 1 else 0 end),0) as card_count,
        coalesce(sum(case when kind='card' then profit else 0 end),0) as card_profit
      from service_entries where created_at >= ? and created_at < ? and voided_at is null`, b],
    [`select date(created_at, '+3 hours') as day,
        sum(case when kind='repair' then profit else 0 end) as repair, sum(case when kind='card' then profit else 0 end) as card
      from service_entries where created_at >= ? and created_at < ? and voided_at is null group by 1`, b],
  ]);
  const D = new Map(days.map((x) => [x.day, x]));
  return {
    count: t.cnt, profit: t.profit, repair_count: t.repair_count, repair_profit: t.repair_profit, card_count: t.card_count, card_profit: t.card_profit,
    daily: eachDay(a.p_from, a.p_to).map((day) => {
      const x = D.get(day) || {};
      return { day, repair: x.repair || 0, card: x.card || 0, profit: (x.repair || 0) + (x.card || 0) };
    }),
  };
});

/* ===================================================================================================
 * 8. HTTP front door
 * ================================================================================================ */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
};
const send = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { ...CORS, ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }) },
});

const ready = new WeakMap();
function ensureSchema(db) {
  if (!ready.has(db)) {
    ready.set(db, db.exec(SCHEMA.map((s) => [s, []])).catch((e) => { ready.delete(db); throw e; }));
  }
  return ready.get(db);
}

export async function handle(req, env, db) {
  if (req.method === 'OPTIONS') return send(204);
  setIter(env);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (path === '' || path === '/health') {
      await ensureSchema(db);
      await db.get('select 1 as ok');
      return send(200, { ok: true });
    }
    await ensureSchema(db);
    const readBody = async () => { try { return await req.json(); } catch { return {}; } };

    if (path === '/auth/v1/token' && req.method === 'POST') {
      const r = await authToken(env, db, url.searchParams.get('grant_type'), (await readBody()) || {});
      return send(r.status, r.body);
    }
    if (path === '/auth/v1/signup' && req.method === 'POST') {
      const r = await authSignup(env, db, (await readBody()) || {});
      return send(r.status, r.body);
    }
    if (path === '/auth/v1/logout' && req.method === 'POST') {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const me = await readAccess(env, tok);
      if (me.uid) await db.run('delete from sessions where user_id = ?', [me.uid]);
      return send(204);
    }
    if (path === '/auth/v1/user' && (req.method === 'PUT' || req.method === 'GET')) {
      const me = await readAccess(env, (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
      if (!me.uid) return send(401, { code: 401, error_code: 'bad_jwt', msg: me.err });
      if (req.method === 'PUT') {
        const r = await authChangePassword(db, me.uid, (await readBody()) || {});
        return send(r.status, r.body);
      }
      const u = await db.get('select * from profiles where id = ?', [me.uid]);
      return u ? send(200, userJson(u)) : send(401, { code: 401, error_code: 'bad_jwt', msg: 'user not found' });
    }

    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path);
    if (m && req.method === 'POST') {
      const fn = RPC[m[1]];
      if (!fn) return send(404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${m[1]}` });
      let uid = null;
      if (!fn.pub) {
        const me = await readAccess(env, (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
        if (!me.uid) return send(401, { code: 'PGRST301', details: null, hint: null, message: me.err });
        uid = me.uid;
      }
      let role;
      const who = async () => {
        if (role === undefined) {
          const r = await db.get('select role from profiles where id = ? and active = 1', [uid]);
          role = r ? r.role : null;
        }
        return role;
      };
      const ctx = {
        db, uid,
        staff: async () => { const r = await who(); if (!r) forbid('NOT_AUTHORIZED'); return r; },
        admin: async () => { if ((await who()) !== 'admin') forbid('ADMIN_ONLY'); },
      };
      const out = await fn.fn(ctx, (await readBody()) || {});
      return send(200, out === undefined ? null : out);
    }
    return send(404, { code: 'NOT_FOUND', message: 'unknown route' });
  } catch (e) {
    if (e instanceof Fail) {
      return send(e.status, { code: e.code, message: e.key, details: e.detail ? JSON.stringify(e.detail) : null, hint: null });
    }
    console.error(e && e.stack ? e.stack : e);
    if (e instanceof DbError) return send(503, { code: 'DB_ERROR', message: 'DB_ERROR', details: String(e.message).slice(0, 200) });
    return send(500, { code: 'XX000', message: 'INTERNAL', details: null });
  }
}

let prodDb = null;
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return send(204);
    if (!env.TURSO_URL || !env.TURSO_TOKEN) {
      // the two settings from the README (Cloudflare -> Worker -> Settings -> Variables) are missing
      return send(500, { code: 'XX000', message: 'SERVER_NOT_CONFIGURED', details: null, hint: null });
    }
    if (!prodDb) prodDb = new Hrana(env.TURSO_URL, env.TURSO_TOKEN);
    return handle(req, env, prodDb);
  },
};
