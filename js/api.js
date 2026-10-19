// A very small Supabase client: password sign-in, sign-up and RPC calls over fetch().
// No library needed — the whole app only uses these few endpoints:
//   POST /auth/v1/token?grant_type=password | refresh_token      (sign in / keep the session alive)
//   POST /auth/v1/signup                                         (create staff accounts / first admin)
//   PUT  /auth/v1/user                                           (change my own password)
//   POST /rest/v1/rpc/<function>                                 (everything else)

const cfg = window.ZP_CONFIG || {};
const STORE = 'zp.session.v1';
const TIMEOUT_MS = 25000;

export class ApiError extends Error {
  constructor(key, { status = 0, details = null, raw = null } = {}) {
    super(key);
    this.name = 'ApiError';
    this.key = key; // STOCK_INSUFFICIENT, INVALID_CREDENTIALS, NETWORK ...
    this.status = status;
    this.details = details; // parsed JSON from the database error DETAIL, if any
    this.raw = raw;
  }
  get isNetwork() {
    return this.key === 'NETWORK' || this.key === 'TIMEOUT' || this.key === 'BAD_RESPONSE' || this.status >= 502;
  }
}

/* ---- what config.js must contain ----
 * SUPABASE_URL, SUPABASE_ANON_KEY  and  LOGIN_EMAIL (a real mailbox of the owner).
 * Staff sign in with a plain user name ("sara"); Supabase only knows e-mail addresses, so we turn the
 * name into  owner+sara@gmail.com  — it passes Supabase's address checks and no mail is ever sent
 * (the "Confirm email" switch is off), but if one were, it would land in the owner's own inbox.
 * Shops that own a domain can use USERNAME_DOMAIN instead  (sara@myshop.com). */
const EMAIL_RE = /^[^@\s+]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const RESERVED_HOST = /(^|\.)(example\.(com|net|org)|test|invalid|local|localhost)$/i; // Supabase refuses these
const placeholder = (v) => /your[-_]/i.test(v);
function ownerEmail() {
  const v = String(cfg.LOGIN_EMAIL || '').trim().toLowerCase();
  return EMAIL_RE.test(v) && !placeholder(v) && !RESERVED_HOST.test(v.split('@')[1]) ? v : '';
}
function loginDomain() {
  const d = String(cfg.USERNAME_DOMAIN || '').trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !placeholder(d) && !RESERVED_HOST.test(d) ? d : '';
}
/** the names of the config.js settings that are still missing or unusable */
export function configIssues() {
  const out = [];
  const u = String(cfg.API_URL || cfg.SUPABASE_URL || '');
  const k = String(cfg.SUPABASE_ANON_KEY || '');
  if (!/^https?:\/\//.test(u) || placeholder(u)) out.push(cfg.API_URL ? 'API_URL' : 'SUPABASE_URL');
  if (!cfg.API_URL && (k.length <= 20 || placeholder(k))) out.push('SUPABASE_ANON_KEY'); // only the Supabase backend needs a key
  if (!ownerEmail() && !loginDomain()) out.push('LOGIN_EMAIL');
  return out;
}
export const configured = () => configIssues().length === 0;

/** "sara" -> "owner+sara@gmail.com"  (or "sara@myshop.com"); a full e-mail address is left alone */
export function toEmail(login) {
  const v = String(login || '').trim().toLowerCase();
  if (v.includes('@')) return v;
  const owner = ownerEmail();
  if (owner) {
    const [local, domain] = owner.split('@');
    return `${local.split('+')[0]}+${v}@${domain}`;
  }
  return `${v}@${loginDomain()}`;
}

/* ---------------- session ---------------- */
const nowSec = () => Math.floor(Date.now() / 1000);

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    return s && s.access_token && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}
function writeStored(s) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* private mode: the session simply lives until the tab closes */
  }
}

let session = readStored();
const listeners = new Set();
function setSession(s, reason) {
  session = s;
  writeStored(s);
  listeners.forEach((cb) => cb(s, reason));
}
/** cb(session|null, reason) — reason: signin | refresh | signout | expired | storage */
export function onSession(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
window.addEventListener('storage', (e) => {
  if (e.key === STORE) {
    session = readStored();
    listeners.forEach((cb) => cb(session, 'storage'));
  }
});
export const isSignedIn = () => !!session;
export const currentUserId = () => session?.user?.id || null;

function normalize(d) {
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at || nowSec() + (d.expires_in || 3600),
    user: d.user || null,
  };
}
export function adoptSession(s) {
  setSession(s, 'signin');
}

/* ---------------- http ---------------- */
function baseHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.SUPABASE_ANON_KEY) h.apikey = cfg.SUPABASE_ANON_KEY;
  return h;
}
function parseJSON(t) {
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function toError(status, d) {
  d = d && typeof d === 'object' ? d : {};
  let key;
  let details = null;
  if (typeof d.code === 'string' && /^(P0001|PT\d{3})$/.test(d.code)) {
    key = d.message || d.code; // our own RAISE EXCEPTION 'STOCK_INSUFFICIENT'
    details = parseJSON(d.details) || null;
  } else if (d.error_code) {
    key = String(d.error_code).toUpperCase(); // GoTrue
  } else if (typeof d.code === 'string') {
    key = d.code; // 42501, PGRST301 ...
  } else if (d.error) {
    key = String(d.error).toUpperCase();
  } else {
    key = `HTTP_${status}`;
  }
  const e = new ApiError(key, { status, details, raw: d });
  e.message = d.msg || d.message || d.error_description || key;
  return e;
}

async function http(path, { method = 'POST', body, headers } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  let text;
  try {
    res = await fetch(String(cfg.API_URL || cfg.SUPABASE_URL).replace(/\/+$/, '') + path, {
      method,
      headers: headers || baseHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    text = await res.text();
  } catch (e) {
    throw new ApiError(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', { raw: e });
  } finally {
    clearTimeout(timer);
  }
  const data = parseJSON(text);
  if (!res.ok) throw toError(res.status, data === undefined ? { message: String(text).slice(0, 200) } : data);
  if (data === undefined) throw new ApiError('BAD_RESPONSE', { status: res.status });
  return data;
}

/* ---------------- auth ---------------- */
export async function signIn(login, password) {
  const d = await http('/auth/v1/token?grant_type=password', { body: { email: toEmail(login), password } });
  setSession(normalize(d), 'signin');
  return session.user;
}

/** Creates an account WITHOUT touching the current session (the admin stays himself). */
export async function signUp(login, password, data = {}) {
  const d = await http('/auth/v1/signup', { body: { email: toEmail(login), password, data } });
  const id = (d.user && d.user.id) || d.id || null;
  return { id, session: d.access_token ? normalize(d) : null };
}

export async function signOut() {
  const token = session && session.access_token;
  setSession(null, 'signout');
  if (token) {
    try {
      await http('/auth/v1/logout', { headers: { ...baseHeaders(), Authorization: `Bearer ${token}` } });
    } catch {
      /* already signed out locally — nothing else to do */
    }
  }
}

let inflight = null;
/** Gets a fresh access token. Safe with several tabs open (one refreshes, the rest reuse it). */
export function refresh(usedToken = null) {
  if (inflight) return inflight;
  const run = async () => {
    const stored = readStored();
    if (stored) session = stored; // another tab may already have refreshed
    if (!session || !session.refresh_token) throw new ApiError('SESSION_EXPIRED', { status: 401 });
    const stillGood = session.expires_at - nowSec() > 60;
    if (usedToken ? session.access_token !== usedToken : stillGood) return session;
    try {
      const d = await http('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } });
      setSession(normalize(d), 'refresh');
      return session;
    } catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        setSession(null, 'expired');
        throw new ApiError('SESSION_EXPIRED', { status: 401 });
      }
      throw e;
    }
  };
  inflight = (navigator.locks ? navigator.locks.request('zp-refresh', run) : run()).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function authed(path, opts = {}, retried = false) {
  if (!session) throw new ApiError('SESSION_EXPIRED', { status: 401 });
  if (session.expires_at - nowSec() < 45) {
    try {
      await refresh();
    } catch (e) {
      if (!e.isNetwork) throw e; // offline: try the token we have
    }
    if (!session) throw new ApiError('SESSION_EXPIRED', { status: 401 });
  }
  const used = session.access_token;
  try {
    return await http(path, { ...opts, headers: { ...baseHeaders(), Authorization: `Bearer ${used}` } });
  } catch (e) {
    if (e.status === 401 && !retried) {
      await refresh(used);
      return authed(path, opts, true);
    }
    throw e;
  }
}

export async function changePassword(newPassword) {
  await authed('/auth/v1/user', { method: 'PUT', body: { password: newPassword } });
}

/* ---------------- database functions ---------------- */
export function rpc(name, args = {}) {
  return authed(`/rest/v1/rpc/${name}`, { body: args });
}
/** works without signing in (only needs_setup() is open to visitors) */
export function rpcPublic(name, args = {}) {
  return http(`/rest/v1/rpc/${name}`, { body: args });
}
