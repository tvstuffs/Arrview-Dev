const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL: NodeURL } = require('url');

const app = express();
const PORT = process.env.PORT || 7777;
const CONFIG_DIR = process.env.CONFIG_DIR || __dirname;
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Canonical user-facing app version. Surfaced in the Settings page and the
// /api/arrview/identify endpoint (the iOS app reads it from there).
// Pre-2.0 track: each build increments the A number (1.9A1, 1.9A2, ...). The label
// is display text; clients detect features through `capabilities`, never by
// comparing versions (1.9A1 sorts below 1.10.2 as numbers).
const APP_VERSION = '1.9A4';

// ── Password login (optional, off by default) ────────────────────────────────
// All of it lives in this file (the Dockerfile copies only server.js). State is in memory, read once from
// auth.json at start; nothing is served until start-up has finished (see initAuth and the end of the file).
const { Buffer } = require('buffer');
const net = require('net');

const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');
const COOKIE_NAME = 'arrview_session';
const COOKIE_MAX_AGE = 2592000;           // 30 days
const COOKIE_SLIDE_BELOW = 29 * 86400;    // re-issue when less than 29 days are left
const SCRYPT_MAXMEM = 268435456;
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, keylen: 64 };
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const LIMIT_MAX = 10;
const LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LIMIT_ENTRIES = 10000;
const FAIL_FLOOR_MS = 500;
const QUEUE_WAITING_MAX = 16;
const authLog = msg => console.log(msg);

// mode: 'off' (open), 'on' (login required) or 'closed' (login required and nobody can sign in: unreadable
// auth.json or a broken Docker password setting).
const auth = { mode: 'off', record: null, secret: null, key: null, keyDigest: null, dockerManaged: false, disabledByDocker: false };

// validatePassword:begin
// The one password rule (Settings, sign in and the Docker variables). The web client keeps a copy in src/passwordRules.js.
function validatePassword(raw, source) {
  if (typeof raw !== 'string') return { ok: false, reason: 'length' };
  let s = raw;
  if (source === 'docker-file') s = s.replace(/\r?\n$/, '');
  if (s.length > 1024) return { ok: false, reason: 'length' };
  s = s.normalize('NFKC');
  if (/^\s*$/.test(s)) return { ok: false, reason: 'blank' };
  if (s.length < 8 || s.length > 256) return { ok: false, reason: 'length' };
  return { ok: true, value: s };
}
// validatePassword:end

function scryptAsync(password, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM },
      (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

async function hashPassword(normalised, origin) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(normalised, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return { origin, algorithm: 'scrypt', ...SCRYPT_PARAMS, salt: salt.toString('base64'), hash: derived.toString('base64') };
}

async function verifyRecord(record, normalised) {
  const derived = await scryptAsync(normalised, Buffer.from(record.salt, 'base64'), record.keylen, record);
  const stored = Buffer.from(record.hash, 'base64');
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

const strictBase64 = (s, min, max) => {
  if (typeof s !== 'string') return null;
  const b = Buffer.from(s, 'base64');
  return b.length >= min && b.length <= max && b.toString('base64') === s ? b : null;
};

function validRecord(r) {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return false;
  if (r.origin !== 'settings' && r.origin !== 'docker') return false;
  if (r.algorithm !== 'scrypt') return false;
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(r.N, 1024, 262144) || (r.N & (r.N - 1)) !== 0) return false;
  if (!int(r.r, 1, 16) || !int(r.p, 1, 16) || !int(r.keylen, 32, 128)) return false;
  if (128 * r.N * r.r > SCRYPT_MAXMEM) return false;
  if (!strictBase64(r.salt, 8, 64)) return false;
  const hash = strictBase64(r.hash, 1, 1024);
  return Boolean(hash) && hash.length === r.keylen;
}

const newAccessKey = () => crypto.randomBytes(32).toString('base64url');
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest();

// auth.json contents -> { record, secret, accessKey } or null when invalid.
function parseAuthText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (_) { return null; }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj) || obj.version !== 1) return null;
  if (obj.password === null) return { record: null, secret: null, accessKey: null };
  if (!validRecord(obj.password)) return null;
  const secret = strictBase64(obj.sessionSecret, 32, 1024);
  if (!secret || typeof obj.accessKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(obj.accessKey)) return null;
  const { origin, algorithm, N, r, p, keylen, salt, hash } = obj.password;
  return { record: { origin, algorithm, N, r, p, keylen, salt, hash }, secret, accessKey: obj.accessKey };
}

// { missing } | { bad: <code> } | { data }
function readAuthFile() {
  let text;
  try { text = fs.readFileSync(AUTH_FILE, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? { missing: true } : { bad: (e && e.code) || 'unreadable' };
  }
  const data = parseAuthText(text);
  return data ? { data } : { bad: 'invalid contents' };
}

// Atomic, always 0600; throws after cleaning up.
function writeAuthFile(state) {
  const body = {
    version: 1,
    password: state.record,
    sessionSecret: state.record ? state.secret.toString('base64') : null,
    accessKey: state.record ? state.accessKey : null,
  };
  const tmp = path.join(CONFIG_DIR, `.auth.json.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600, flag: 'wx' });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, AUTH_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function adoptAuth(state, dockerManaged) {
  auth.record = state.record;
  auth.secret = state.record ? state.secret : null;
  auth.key = state.record ? state.accessKey : null;
  auth.keyDigest = auth.key ? sha256(auth.key) : null;
  auth.dockerManaged = Boolean(state.record) && dockerManaged;
  auth.mode = state.record ? 'on' : 'off';
}

// Docker variables, mirroring resolveEnvServices: { authOff, password (validated, normalised), error }.
function resolveEnvAuth(env, log) {
  const say = msg => log(`[auth] ${msg}`);
  const out = { authOff: false, password: null, error: false };
  const rawAuth = env.ARRVIEW_AUTH;
  if (typeof rawAuth === 'string' && rawAuth.trim() !== '') {
    if (rawAuth.trim().toLowerCase() === 'off') { out.authOff = true; return out; }
    say('ARRVIEW_AUTH has an unrecognised value and is ignored.');
  }
  const plain = env.ARRVIEW_PASSWORD;
  const file = env.ARRVIEW_PASSWORD_FILE;
  const plainSet = typeof plain === 'string';
  const fileSet = typeof file === 'string';
  if (!plainSet && !fileSet) return out;
  const fail = msg => {
    out.error = true;
    say(`${msg} The login stays on and no one can sign in until this is fixed (or set ARRVIEW_AUTH=off).`);
    return out;
  };
  if (plainSet && fileSet) return fail('ARRVIEW_PASSWORD and ARRVIEW_PASSWORD_FILE are both set; set only one.');
  const name = plainSet ? 'ARRVIEW_PASSWORD' : 'ARRVIEW_PASSWORD_FILE';
  let value = plain;
  if (fileSet) {
    try {
      const filePath = file.trim();
      if (!filePath) throw new Error('empty path');
      value = String(fs.readFileSync(filePath, 'utf8'));
    } catch (_) { return fail(`${name} is unreadable.`); }
  }
  const checked = validatePassword(value, plainSet ? 'docker-env' : 'docker-file');
  if (!checked.ok) return fail(checked.reason === 'blank' ? `${name} is empty.` : `${name} must be 8 to 256 characters.`);
  out.password = checked.value;
  return out;
}

// The eight 16-bit words of a valid IPv6 literal (dotted-quad tail allowed), or null.
function ipv6Words(addr) {
  let text = addr;
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    const q = tail[2].split('.').map(Number);
    text = `${tail[1]}${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const words = [...head, ...Array(fill).fill('0'), ...rest].map(w => parseInt(w, 16));
  return words.length === 8 && words.every(Number.isInteger) ? words : null;
}

// ARRVIEW_TRUSTED_PROXIES: IPv4 / IPv6 literals or CIDR ranges. Returns the array for Express, or false.
function normaliseProxyEntry(entry) {
  const parts = entry.split('/');
  if (parts.length > 2 || entry.includes('%')) return null;
  let addr = parts[0];
  const family = net.isIP(addr);
  if (!family) return null;
  let prefix = null;
  if (parts.length === 2) {
    if (!/^\d{1,3}$/.test(parts[1])) return null;
    prefix = Number(parts[1]);
    if (prefix === 0 || prefix > (family === 4 ? 32 : 128)) return null;
  }
  if (family === 6) {
    addr = addr.toLowerCase();
    const words = ipv6Words(addr);
    if (words && words.slice(0, 5).every(w => w === 0) && words[5] === 0xffff) {
      // IPv4-mapped, in any spelling: the effective IPv4 prefix is prefix - 96, and /0 trusts every address.
      if (prefix !== null && prefix <= 96) return null;
      const v4 = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
      return prefix === null ? v4 : `${v4}/${prefix - 96}`;
    }
  }
  return prefix === null ? addr : `${addr}/${prefix}`;
}

function parseTrustedProxies(raw, log) {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  const list = [];
  for (const token of raw.split(',')) {
    const entry = token.trim();
    if (!entry) continue;
    const normal = normaliseProxyEntry(entry);
    if (!normal) {
      log(`[auth] ARRVIEW_TRUSTED_PROXIES has an invalid entry "${entry.slice(0, 64)}"; no proxy is trusted.`);
      return false;
    }
    list.push(normal);
  }
  if (!list.length) return false;
  log(`[auth] trusting X-Forwarded-For and X-Forwarded-Proto from ${list.length} proxy entries.`);
  return list;
}

app.set('trust proxy', parseTrustedProxies(process.env.ARRVIEW_TRUSTED_PROXIES, authLog));

// The client address, only ever through req.ip.
function clientIp(req) {
  let ip = typeof req.ip === 'string' ? req.ip : '';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  return net.isIP(ip) ? ip : 'unknown';
}

// ── Sessions: v1.<expiry seconds>.<base64url HMAC-SHA256>, stateless ──
const nowSeconds = () => Math.floor(Date.now() / 1000);
const cookieSignature = exp => crypto.createHmac('sha256', auth.secret).update(`v1.${exp}`).digest('base64url');

function sessionCookieValue() {
  const exp = nowSeconds() + COOKIE_MAX_AGE;
  return `v1.${exp}.${cookieSignature(exp)}`;
}

function cookieAttributes(req) {
  return `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;
}

const setSessionCookie = (req, res) =>
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${sessionCookieValue()}; Max-Age=${COOKIE_MAX_AGE}; ${cookieAttributes(req)}`);
const clearSessionCookie = (req, res) =>
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${cookieAttributes(req)}`);

// The expiry (seconds) of a valid session cookie on the request, or null.
function sessionExpiry(req) {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || !auth.secret) return null;
  let tried = 0;
  for (const part of header.split(';')) {
    const piece = part.trim();
    const eq = piece.indexOf('=');
    if (eq < 0 || piece.slice(0, eq) !== COOKIE_NAME) continue;
    if (++tried > 5) break;
    const value = piece.slice(eq + 1);
    if (value.length > 200) continue;
    const bits = value.split('.');
    if (bits.length !== 3 || bits[0] !== 'v1' || !/^\d{1,12}$/.test(bits[1]) || Number(bits[1]) <= nowSeconds()) continue;
    const given = Buffer.from(bits[2]);
    const wanted = Buffer.from(cookieSignature(bits[1]));
    if (given.length === wanted.length && crypto.timingSafeEqual(given, wanted)) return Number(bits[1]);
  }
  return null;
}

// The candidate access key: X-Api-Key wins; otherwise a Bearer token; null when none was sent.
function keyCandidate(req) {
  const direct = req.headers['x-api-key'];
  if (direct !== undefined) return String(direct);
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' ? /^bearer(?:\s+(.*))?$/i.exec(header.trim()) : null;
  return bearer ? (bearer[1] || '') : null;
}

function keyMatches(candidate) {
  return Boolean(auth.keyDigest) && crypto.timingSafeEqual(sha256(candidate), auth.keyDigest);
}

const PUBLIC_ROUTES = new Set([
  'GET /api/health', 'GET /api/arrview/identify', 'GET /api/auth/status',
  'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/token',
  'POST /api/webhooks/sonarr', 'POST /api/webhooks/radarr',
]);
const WEBHOOK_POSTS = new Set(['POST /api/webhooks/sonarr', 'POST /api/webhooks/radarr']);

function gateReply(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

// The one gate in front of every /api route while the login is on. It sets req.authKind ('key', 'cookie' or 'anon').
function authGate(req, res, next) {
  if (auth.mode === 'off') return next();
  const lower = req.path.toLowerCase();
  if (lower !== '/api' && !lower.startsWith('/api/')) return next();
  const normal = lower.length > 1 && lower.endsWith('/') ? lower.slice(0, -1) : lower;
  const route = `${req.method === 'HEAD' ? 'GET' : req.method} ${normal}`;
  const isPublic = PUBLIC_ROUTES.has(route);

  let kind = 'anon';
  let expiry = null;
  const candidate = keyCandidate(req);
  if (candidate !== null && keyMatches(candidate)) kind = 'key';
  else if (candidate !== null && !isPublic) return gateReply(res, 401, { error: 'Authentication required', auth: true });
  else if ((expiry = sessionExpiry(req)) !== null) kind = 'cookie';
  req.authKind = kind;
  req.authProtected = !isPublic;

  if (kind === 'cookie' && req.method !== 'GET' && req.method !== 'HEAD' && !WEBHOOK_POSTS.has(route) &&
      req.headers['x-requested-with'] !== 'ArrView') {
    return gateReply(res, 403, { error: 'Missing X-Requested-With header' });
  }
  if (!isPublic && kind === 'anon') return gateReply(res, 401, { error: 'Authentication required', auth: true });

  // Sliding expiry: a fresh cookie goes out with a successful response to a protected request.
  if (!isPublic && kind === 'cookie' && expiry - nowSeconds() < COOKIE_SLIDE_BELOW) {
    const cookie = `${COOKIE_NAME}=${sessionCookieValue()}; Max-Age=${COOKIE_MAX_AGE}; ${cookieAttributes(req)}`;
    const writeHead = res.writeHead;
    res.writeHead = function slidingWriteHead(status, ...rest) {
      if (!this.headersSent && !this.getHeader('Set-Cookie') && (typeof status !== 'number' || status < 400)) {
        this.setHeader('Set-Cookie', cookie);
      }
      return writeHead.call(this, status, ...rest);
    };
  }
  next();
}

// ── Limiter: one bucket per address, 10 failures per rolling 15 minutes, in memory ──
const limiter = new Map();
function limiterEntry(ip) {
  const now = Date.now();
  let entry = limiter.get(ip);
  if (!entry) {
    entry = { slots: [], announced: false };
    limiter.set(ip, entry);
    if (limiter.size > LIMIT_ENTRIES) limiter.delete(limiter.keys().next().value);
  }
  entry.slots = entry.slots.filter(slot => slot.t > now - LIMIT_WINDOW_MS);
  if (entry.slots.length < LIMIT_MAX) entry.announced = false;
  return entry;
}
// Seconds until a slot frees up, or 0 when the address may try.
function limiterWait(ip) {
  const entry = limiterEntry(ip);
  if (entry.slots.length < LIMIT_MAX) return 0;
  return Math.max(1, Math.ceil((entry.slots[0].t + LIMIT_WINDOW_MS - Date.now()) / 1000));
}
function limiterTake(ip) {
  const slot = { t: Date.now() };
  limiterEntry(ip).slots.push(slot);
  return slot;
}
function limiterGiveBack(ip, slot) {
  const entry = limiter.get(ip);
  if (entry) entry.slots = entry.slots.filter(s => s !== slot);
}
function limiterNoteFailure(ip) {
  const entry = limiterEntry(ip);
  if (entry.slots.length >= LIMIT_MAX && !entry.announced) {
    entry.announced = true;
    authLog(`[auth] too many failed attempts from ${ip}; blocked for ${limiterWait(ip)} s`);
  }
}

// Password hashing and every auth-state change run one at a time (one 128 MiB hash at once, atomic check-then-change).
let authQueueTail = Promise.resolve();
let authQueueWaiting = 0;
function authQueued(fn) {
  if (authQueueWaiting >= QUEUE_WAITING_MAX) return Promise.reject(Object.assign(new Error('busy'), { busy: true }));
  authQueueWaiting++;
  const run = authQueueTail.then(() => { authQueueWaiting--; return fn(); });
  authQueueTail = run.catch(() => {});
  return run;
}

const failureDelay = arrival => new Promise(resolve => setTimeout(resolve, Math.max(0, FAIL_FLOOR_MS - (Date.now() - arrival))));

async function passwordMatches(raw) {
  const checked = validatePassword(raw, 'settings');
  if (!checked.ok || !auth.record) return false;
  return verifyRecord(auth.record, checked.value);
}

// Whether a request admitted by the gate still holds valid credentials now. The gate runs before the body is read and
// before queued work starts, and a password change or Sign out everywhere can land in between.
function reauthorised(req) {
  if (auth.mode === 'off' || !req.authProtected) return true;
  if (req.authKind === 'cookie') return sessionExpiry(req) !== null;
  if (req.authKind === 'key') {
    const candidate = keyCandidate(req);
    return candidate !== null && keyMatches(candidate);
  }
  return false;
}
const staleReply = res => gateReply(res, 401, { error: 'Authentication required', auth: true });

app.use(authGate);
app.use(express.json());
app.use((req, res, next) => (reauthorised(req) ? next() : staleReply(res)));
// Mutating API calls must declare a JSON body. Without this guard a request
// with a text/plain body leaves req.body empty and would wipe the config.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) &&
      req.path.toLowerCase().startsWith('/api/') && !req.path.toLowerCase().startsWith('/api/webhooks/') &&
      !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});
// Malformed JSON under /api gets a JSON 400 (never the HTML default page).
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.status === 400) &&
      req.path.toLowerCase().startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next(err);
});
// API responses and mutable shell files must always reach the server.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── Login routes (/api/auth/*) ───────────────────────────────────────────────
const AUTH_OFF_TEXT = "The login is turned off by the Docker configuration (ARRVIEW_AUTH=off) and can't be changed here";
const AUTH_DOCKER_TEXT = "The password is set by the Docker configuration and can't be changed here";
const AUTH_UNAVAILABLE_TEXT = 'The login is unavailable because its settings could not be read. See the ArrView log.';
const AUTH_BROWSER_TEXT = 'Sign in with a browser to do this';
const AUTH_SAVE_TEXT = 'Could not save the password';

function authRoute(handler) {
  return (req, res) => Promise.resolve().then(() => handler(req, res)).catch(err => {
    if (err && err.busy) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({ error: 'The server is busy. Try again in a moment.' });
    }
    authLog(`[auth] request failed (${(err && err.code) || 'error'})`);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });
}

// Every open event stream ends when the credentials change, so none outlives them.
function closeEventStreams() {
  for (const client of sseClients) {
    try { client.end(); client.destroy(); } catch (_) {}
  }
  sseClients.clear();
}

// A limited password check: a slot is taken first, the check and the action run inside the serial queue, a success
// gives the slot back, and a wrong password is answered by onWrong() no earlier than the failure floor.
async function limitedCheck(req, res, route, raw, onWrong, action) {
  const arrival = Date.now();
  const ip = clientIp(req);
  const wait = limiterWait(ip);
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return res.status(429).json({ error: 'Too many attempts. Try again later.', retryAfterSeconds: wait });
  }
  const slot = limiterTake(ip);
  let matched;
  try {
    matched = await authQueued(async () => {
      if (!(await passwordMatches(raw))) return false;
      limiterGiveBack(ip, slot);
      await action();
      return true;
    });
  } catch (err) {
    limiterGiveBack(ip, slot);
    throw err;
  }
  if (matched) return undefined;
  authLog(`[auth] sign-in failed from ${ip} route=${route}`);
  limiterNoteFailure(ip);
  await failureDelay(arrival);
  return onWrong();
}

async function passwordCheckRoute(req, res, route, onSuccess) {
  if (auth.mode === 'off') return res.status(409).json({ error: 'No password is set' });
  if (auth.mode === 'closed') return res.status(503).json({ error: AUTH_UNAVAILABLE_TEXT });
  const raw = isPlainObject(req.body) ? req.body.password : undefined;
  if (typeof raw !== 'string' || raw === '') return res.status(400).json({ error: 'Password is required' });
  return limitedCheck(req, res, route, raw, () => res.status(401).json({ error: 'Incorrect password' }), onSuccess);
}

// Management routes need a cookie session; returns true when it has already answered.
function manageBlocked(req, res) {
  if (auth.disabledByDocker) { res.status(409).json({ error: AUTH_OFF_TEXT }); return true; }
  if (auth.mode === 'off') { res.status(409).json({ error: 'No password is set' }); return true; }
  if (req.authKind !== 'cookie') { res.status(403).json({ error: AUTH_BROWSER_TEXT }); return true; }
  return false;
}

// Writes the new state to auth.json first, then swaps it into memory. Returns false (after answering 500) on a write failure.
function commitAuth(res, next) {
  try { writeAuthFile(next); } catch (_) { res.status(500).json({ error: AUTH_SAVE_TEXT }); return false; }
  adoptAuth(next, auth.dockerManaged);
  closeEventStreams();
  return true;
}

app.get('/api/auth/status', authRoute((req, res) => {
  const required = auth.mode !== 'off';
  const signedIn = required && (req.authKind === 'key' || req.authKind === 'cookie');
  if (required && !signedIn) {
    return res.json(auth.mode === 'closed' ? { required: true, signedIn: false, unavailable: true } : { required: true, signedIn: false });
  }
  res.json({
    required, signedIn,
    source: auth.record ? (auth.dockerManaged ? 'docker' : 'settings') : 'none',
    authDisabledByDocker: auth.disabledByDocker,
    passwordMinLength: PASSWORD_MIN, passwordMaxLength: PASSWORD_MAX,
  });
}));

app.post('/api/auth/login', authRoute((req, res) => passwordCheckRoute(req, res, 'login', () => {
  setSessionCookie(req, res);
  res.json({ success: true });
})));

app.post('/api/auth/logout', authRoute((req, res) => {
  if (auth.mode !== 'off') clearSessionCookie(req, res);
  res.json({ success: true });
}));

app.post('/api/auth/token', authRoute((req, res) => passwordCheckRoute(req, res, 'token', () => {
  res.json({ accessKey: auth.key });
})));

app.post('/api/auth/password', authRoute(async (req, res) => {
  if (auth.disabledByDocker) return res.status(409).json({ error: AUTH_OFF_TEXT });
  if (auth.dockerManaged) return res.status(409).json({ error: AUTH_DOCKER_TEXT });
  const body = isPlainObject(req.body) ? req.body : {};
  const checked = validatePassword(body.newPassword, 'settings');
  if (!checked.ok) {
    return res.status(400).json({ error: checked.reason === 'blank' ? "Password can't be only spaces" : 'Password must be 8 to 256 characters' });
  }
  const change = async () => {
    if (!reauthorised(req)) return staleReply(res);
    const record = await hashPassword(checked.value, 'settings');
    const next = { record, secret: crypto.randomBytes(32), accessKey: newAccessKey() };
    if (!commitAuth(res, next)) return;
    setSessionCookie(req, res);
    res.json({ success: true });
  };
  if (auth.mode === 'off') {
    return authQueued(async () => {
      if (auth.mode !== 'off') return res.status(409).json({ error: 'A password was set a moment ago. Sign in instead.' });
      return change();
    });
  }
  if (req.authKind !== 'cookie') return res.status(403).json({ error: AUTH_BROWSER_TEXT });
  if (typeof body.currentPassword !== 'string' || body.currentPassword === '') {
    return res.status(400).json({ error: 'Current password is required' });
  }
  return limitedCheck(req, res, 'password', body.currentPassword,
    () => res.status(403).json({ error: 'Current password is incorrect' }), change);
}));

app.post('/api/auth/password/remove', authRoute(async (req, res) => {
  if (auth.disabledByDocker) return res.status(409).json({ error: AUTH_OFF_TEXT });
  if (auth.mode === 'off') return res.status(409).json({ error: 'No password is set' });
  if (auth.dockerManaged) return res.status(409).json({ error: AUTH_DOCKER_TEXT });
  if (req.authKind !== 'cookie') return res.status(403).json({ error: AUTH_BROWSER_TEXT });
  const current = isPlainObject(req.body) ? req.body.currentPassword : undefined;
  if (typeof current !== 'string' || current === '') return res.status(400).json({ error: 'Current password is required' });
  return limitedCheck(req, res, 'remove', current, () => res.status(403).json({ error: 'Current password is incorrect' }), () => {
    if (!reauthorised(req)) return staleReply(res);
    if (!commitAuth(res, { record: null, secret: null, accessKey: null })) return;
    clearSessionCookie(req, res);
    res.json({ success: true });
  });
}));

app.post('/api/auth/logout-all', authRoute((req, res) => {
  if (manageBlocked(req, res)) return undefined;
  return authQueued(() => {
    if (!reauthorised(req)) return staleReply(res);
    if (auth.mode !== 'on') return res.status(409).json({ error: 'No password is set' });
    if (!commitAuth(res, { record: auth.record, secret: crypto.randomBytes(32), accessKey: newAccessKey() })) return undefined;
    clearSessionCookie(req, res);
    return res.json({ success: true });
  });
}));

app.get('/api/auth/access-key', authRoute((req, res) => {
  if (manageBlocked(req, res)) return;
  res.json({ accessKey: auth.key });
}));

app.post('/api/auth/access-key/regenerate', authRoute((req, res) => {
  if (manageBlocked(req, res)) return undefined;
  return authQueued(() => {
    if (!reauthorised(req)) return staleReply(res);
    if (auth.mode !== 'on') return res.status(409).json({ error: 'No password is set' });
    if (!commitAuth(res, { record: auth.record, secret: auth.secret, accessKey: newAccessKey() })) return undefined;
    return res.json({ accessKey: auth.key });
  });
}));

const distPath =path.join(__dirname, 'dist');
app.use('/assets', express.static(path.join(distPath, 'assets'), {
  maxAge: '1y', immutable: true,
}));
app.use(express.static(distPath, {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));

// Process liveness, deliberately independent of optional upstream services.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION });
});

// Lightweight connectivity checks: never request queues or media libraries.
app.get('/api/:service/ping', async (req, res) => {
  const { service } = req.params;
  if (!['sonarr', 'radarr', 'sabnzbd', 'nzbhydra'].includes(service)) {
    return res.status(404).json({ error: 'Unknown service' });
  }
  const { url, apikey } = loadConfig()[service] || {};
  if (!url || !apikey) return res.status(503).json({ error: 'Service not configured' });
  try {
    if (service === 'sabnzbd') {
      const data = await sabRequest({ mode: 'version' });
      if (!data?.version || data.status === false) throw new Error('Invalid version response');
    } else {
      const baseUrl = url.replace(/\/+$/, '');
      const isHydra = service === 'nzbhydra';
      const response = await axios.get(`${baseUrl}${isHydra ? '/api' : '/api/v3/system/status'}`, {
        headers: isHydra ? {} : { 'X-Api-Key': apikey },
        params: isHydra ? { t: 'caps', o: 'json', apikey } : {},
        timeout: 10000,
        maxRedirects: 0,
      });
      // Some services return a login page or API error with HTTP 200.
      const data = response.data;
      // NZBHydra2 answers caps without a `caps` key (server, limits, searching, categories).
      const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
      const hydraOk = isObject(data) && !Object.prototype.hasOwnProperty.call(data, 'error')
        && (isObject(data.caps) || isObject(data.server) || isObject(data.searching) || isObject(data.categories));
      if (isHydra ? !hydraOk : !data?.version) {
        throw new Error('Invalid service response');
      }
    }
    res.json({ status: 'ok' });
  } catch (_) {
    // Do not return upstream URLs, credentials or Axios request details.
    res.status(503).json({ error: 'Service unavailable' });
  }
});

// ── Config ────────────────────────────────────────────────────────────────────

const SERVICE_IDS = ['sabnzbd', 'nzbhydra', 'sonarr', 'radarr'];
const DEFAULT_PORTS = { sabnzbd: 8080, sonarr: 8989, radarr: 7878, nzbhydra: 5076 };
const MASK_PREFIX = '••••';
const KEY_ALNUM_ERROR = 'API key must contain at least one letter or number.';

// Shared by POST /api/config and POST /api/test/:service. Returns
// { key } (trimmed) for a plain key, or { error }. Masked placeholders are
// handled by the callers before this is used.
function cleanSubmittedKey(raw) {
  if (typeof raw !== 'string') return { error: 'API key must be a string' };
  const key = raw.trim();
  if (!/[A-Za-z0-9]/.test(key)) return { error: KEY_ALNUM_ERROR };
  if (key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) {
    return { error: 'API key is too long or contains control characters' };
  }
  return { key };
}

// Shared service URL normaliser. Returns the normalised URL string, or null
// when invalid. Query strings and fragments are forbidden because proxy routes
// append paths to the stored base URL by string concatenation.
function normalizeServiceUrl(raw, defaultPort) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || /[?#]/.test(s)) return null;
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!hadScheme) s = `http://${s}`;
  else s = s.replace(/^[a-z][a-z0-9+.-]*(?=:\/\/)/i, m => m.toLowerCase());
  s = s.replace(/\/+$/, '');
  if (!hadScheme && defaultPort) {
    const rest = s.slice(s.indexOf('://') + 3);
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const tail = slash === -1 ? '' : rest.slice(slash);
    if (!/:\d+$/.test(authority)) s = `http://${authority}:${defaultPort}${tail}`;
  }
  try {
    const u = new NodeURL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.username || u.password) return null;
  } catch (_) { return null; }
  return s;
}

// ArrView's own address as Sonarr and Radarr reach it, kept in config.webhooks.baseUrl so Settings can show
// the webhook URLs to paste into them. Same rules as a service address, plus: no whitespace anywhere and a plain
// host name or IP address (browsers and Node disagree about what a URL parser lets through, and the browser
// shows these same URLs, so the rule is spelled out); a pasted full webhook URL is cut back to the address so the
// paths are never doubled. Returns null when invalid.
// The address is also printed inside a shell command that Settings shows, and this API has no login, so its
// characters are limited to ones that mean nothing to a shell: ASCII letters, digits and . _ - : [ ] in the
// authority, and . _ ~ % - in path segments.
const WEBHOOK_HOST = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)$/;
const WEBHOOK_BASE = /^https?:\/\/[A-Za-z0-9._[\]:-]+(?:\/[A-Za-z0-9._~%-]+)*$/;
function normalizeWebhookBase(raw) {
  if (typeof raw !== 'string' || /\s/.test(raw.trim())) return null;
  const url = normalizeServiceUrl(raw);
  const base = url && normalizeServiceUrl(url.replace(/\/api\/webhooks(?:\/(?:sonarr|radarr))?$/i, ''));
  return base && WEBHOOK_BASE.test(base) && WEBHOOK_HOST.test(new NodeURL(base).hostname) ? base : null;
}

function mask(key) {
  const k = String(key || '');
  return k.length > 8 ? MASK_PREFIX + k.slice(-4) : MASK_PREFIX;
}

// Docker environment seeding. Resolved once at startup. A service is
// env-managed only when it has both a resolved key and a resolved address.
function resolveEnvServices(env, log) {
  const managed = {};
  const say = msg => log(`[config] ${msg}`);

  let hostBase = null; // { scheme, host } when ARRVIEW_HOST is valid
  let hostInvalid = false;
  const rawHost = env.ARRVIEW_HOST;
  if (typeof rawHost === 'string' && rawHost.trim()) {
    const m = rawHost.trim().replace(/\/$/, '').match(/^(?:(https?):\/\/)?(.+)$/i);
    const host = m && m[2];
    const ok = host && (/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) ||
      /^\[[0-9A-Fa-f:.]+\]$/.test(host));
    let derivedOk = false;
    if (ok) {
      try { derivedOk = Boolean(new NodeURL(`http://${host}:8080`).hostname); } catch (_) {}
    }
    if (ok && derivedOk) hostBase = { scheme: (m[1] || 'http').toLowerCase(), host };
    else {
      hostInvalid = true;
      say('ARRVIEW_HOST is invalid (use a bare host name or IP, optionally with http:// or https://, no port, path, query or credentials) and is ignored.');
    }
  }

  let anyKey = false;
  for (const svc of SERVICE_IDS) {
    const S = svc.toUpperCase();
    const keyVar = `ARRVIEW_${S}_API_KEY`;
    const fileVar = `${keyVar}_FILE`;
    const urlVar = `ARRVIEW_${S}_URL`;
    const plainRaw = env[keyVar];
    const fileRaw = env[fileVar];
    const plainSet = typeof plainRaw === 'string' && plainRaw.trim() !== '';
    const fileSet = typeof fileRaw === 'string' && fileRaw.trim() !== '';

    let key = null;
    let keyError = false;
    if (plainSet && fileSet) {
      keyError = true;
      say(`${keyVar} and ${fileVar} are both set; set only one. ${svc} env config ignored.`);
    } else if (plainSet) {
      key = plainRaw.trim();
    } else if (fileSet) {
      try { key = String(fs.readFileSync(fileRaw.trim(), 'utf8')).trim(); } catch (_) { key = null; }
      if (!key) {
        key = null; keyError = true;
        say(`${fileVar} is unreadable or empty. ${svc} env config ignored.`);
      }
    } else if (typeof plainRaw === 'string') {
      keyError = true;
      say(`${keyVar} is empty. ${svc} env config ignored.`);
    } else if (typeof fileRaw === 'string') {
      keyError = true;
      say(`${fileVar} is empty. ${svc} env config ignored.`);
    }
    if (key && !/[A-Za-z0-9]/.test(key)) {
      key = null; keyError = true;
      say(`${plainSet ? keyVar : fileVar} must contain at least one letter or number. ${svc} env config ignored.`);
    }
    if (key) anyKey = true;

    let address = null;
    let urlError = false;
    let hasOverride = false;
    const rawUrl = env[urlVar];
    if (typeof rawUrl === 'string' && rawUrl.trim()) {
      hasOverride = true;
      address = normalizeServiceUrl(rawUrl, DEFAULT_PORTS[svc]);
      if (!address) {
        urlError = true;
        say(`${urlVar} is invalid (http/https URL without credentials, query or fragment). ${svc} env config ignored.`);
      }
    } else if (hostBase) {
      address = `${hostBase.scheme}://${hostBase.host}:${DEFAULT_PORTS[svc]}`;
    }

    if (keyError || urlError) continue;
    if (key && address) managed[svc] = { url: address, apikey: key };
    else if (key) say(`${svc} has an API key but no valid address (set ${urlVar} or a valid ARRVIEW_HOST). ${svc} env config ignored.`);
    else if (hasOverride) say(`${urlVar} is set without an API key. ${svc} env config ignored.`);
  }
  if (hostBase && !anyKey) say('ARRVIEW_HOST is set but no service has an ARRVIEW_<SVC>_API_KEY; nothing is env-managed.');
  return managed;
}

const ENV_SERVICES = resolveEnvServices(process.env, msg => console.log(msg));

// Stored config: config.json only.
function loadStoredConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return {};
}

// Effective config: stored config with env-managed services applied on top.
function loadConfig() {
  const config = loadStoredConfig();
  for (const [svc, v] of Object.entries(ENV_SERVICES)) config[svc] = { url: v.url, apikey: v.apikey };
  return config;
}

// Atomic write of the stored config; throws on failure after cleaning up.
function saveConfig(config) {
  const tmp = path.join(CONFIG_DIR, `.config.json.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    // Created owner-only so keys are never readable while the temp file exists.
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    // Keep the existing file mode across the rename. If that fails the temp
    // file stays 0600, which is never broader than the original.
    try { fs.chmodSync(tmp, fs.statSync(CONFIG_FILE).mode & 0o7777); } catch (_) {}
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// A masked placeholder is only honoured when the address is unchanged.
function resolveMaskedKey(service, submittedKey, normalizedUrl) {
  const current = loadConfig()[service];
  if (!current || typeof current.apikey !== 'string' || !current.apikey) return null;
  if (submittedKey !== mask(current.apikey)) return null;
  const currentUrl = normalizeServiceUrl(current.url);
  if (!currentUrl || currentUrl !== normalizedUrl) return null;
  return current.apikey;
}

const REENTER_KEY_ERROR = 'API key must be re-entered when the address changes';

app.get('/api/config', (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(loadConfig())) {
    out[k] = v && typeof v === 'object' && typeof v.apikey === 'string'
      ? { ...v, apikey: mask(v.apikey) } : v;
  }
  out.envManaged = Object.fromEntries(SERVICE_IDS.map(svc => [svc, Boolean(ENV_SERVICES[svc])]));
  res.json(out);
});

// Bonjour (iOS auto-discovery) state, reported by the identify route below and shown on the
// Settings page. It starts 'off' and the Bonjour block at the bottom of this file drives it:
// 'starting', then 'advertising', or 'unavailable' with a reason code (port-in-use,
// permission-denied, not-installed, start-failed). Clients get codes, never raw error text,
// and choose their own wording.
const bonjourStatus = { state: 'off' };
function setBonjourStatus(state, reason) {
  bonjourStatus.state = state;
  if (reason) bonjourStatus.reason = reason; else delete bonjourStatus.reason;
}

// Identity endpoint used by the ArrView iOS app to confirm a discovered or
// manually entered host is an ArrView server, and which services it proxies.
app.get('/api/arrview/identify', (req, res) => {
  const config = loadConfig();
  const services = {};
  for (const svc of ['sabnzbd', 'sonarr', 'radarr', 'nzbhydra']) {
    services[svc] = Boolean(config[svc]?.url && config[svc]?.apikey);
  }
  res.json({
    app: 'arrview',
    version: APP_VERSION,
    capabilities: ['pwa', 'ping', 'health', 'movieDelete', 'seriesMonitor', 'historyLimit',
      'sonarrQueue', 'radarrQueue', 'episodeStills', 'calendarStills', 'radarrCalendar', 'auth'],
    auth: auth.mode !== 'off',
    services,
    bonjour: { ...bonjourStatus },
  });
});

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Validate a POST /api/config body. Returns { config } or { status, error }.
function buildConfigToSave(body) {
  const bad = error => ({ status: 400, error });
  if (!isPlainObject(body)) return bad('Config must be a JSON object');
  const stored = loadStoredConfig();
  const out = {};
  for (const key of Object.keys(body)) {
    if (key !== 'envManaged' && key !== 'webhooks' && !SERVICE_IDS.includes(key)) return bad(`Unknown config key: ${key}`);
  }
  for (const svc of SERVICE_IDS) {
    if (!Object.prototype.hasOwnProperty.call(body, svc)) {
      if (ENV_SERVICES[svc] && stored[svc] !== undefined) out[svc] = stored[svc];
      continue;
    }
    const entry = body[svc];
    if (!isPlainObject(entry)) return bad(`${svc} must be an object`);
    const allowed = svc === 'sabnzbd' ? ['url', 'apikey', 'sabPath'] : ['url', 'apikey'];
    for (const k of Object.keys(entry)) {
      if (!allowed.includes(k)) return bad(`Unknown ${svc} key: ${k}`);
    }
    const env = ENV_SERVICES[svc];
    if (env) {
      const same = typeof entry.url === 'string' && normalizeServiceUrl(entry.url) === env.url &&
        typeof entry.apikey === 'string' && (entry.apikey.trim() === env.apikey || entry.apikey.trim() === mask(env.apikey));
      if (!same) {
        const label = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' }[svc];
        return { status: 409, error: `${label} is set by the Docker configuration and can't be changed here` };
      }
      if (stored[svc] !== undefined) out[svc] = stored[svc];
      continue;
    }
    if (typeof entry.url !== 'string' || !entry.url.trim()) return bad(`${svc} url must be a non-empty string`);
    const url = normalizeServiceUrl(entry.url);
    if (!url) return bad(`${svc} url must be an http(s) URL without credentials, query or fragment`);
    if (typeof entry.apikey !== 'string' || !entry.apikey) return bad(`${svc} apikey must be a non-empty string`);
    let apikey = entry.apikey;
    if (apikey.startsWith(MASK_PREFIX)) {
      apikey = resolveMaskedKey(svc, apikey, url);
      if (!apikey) return bad(REENTER_KEY_ERROR);
    } else {
      const cleaned = cleanSubmittedKey(apikey);
      if (cleaned.error) return bad(`${svc}: ${cleaned.error}`);
      apikey = cleaned.key;
    }
    out[svc] = { url, apikey };
    // Keep sabPath only while the address is unchanged; otherwise re-detect.
    if (svc === 'sabnzbd' && SAB_PATHS.includes(entry.sabPath) &&
        normalizeServiceUrl(stored.sabnzbd?.url) === url) out[svc].sabPath = entry.sabPath;
  }
  // Webhook address: a body without it keeps the stored one, so a client that does not send it cannot
  // erase it; an empty address removes it.
  if (!Object.prototype.hasOwnProperty.call(body, 'webhooks')) {
    if (isPlainObject(stored.webhooks)) out.webhooks = stored.webhooks;
  } else {
    const entry = body.webhooks;
    if (!isPlainObject(entry)) return bad('webhooks must be an object');
    for (const k of Object.keys(entry)) {
      if (k !== 'baseUrl') return bad(`Unknown webhooks key: ${k}`);
    }
    const raw = entry.baseUrl ?? '';
    if (typeof raw !== 'string') return bad('webhooks baseUrl must be a string');
    if (raw.trim()) {
      const baseUrl = normalizeWebhookBase(raw);
      if (!baseUrl) return bad('webhooks baseUrl must be an http(s) address without credentials, query or fragment');
      out.webhooks = { baseUrl };
    }
  }
  return { config: out };
}

app.post('/api/config', (req, res) => {
  const result = buildConfigToSave(req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  try {
    saveConfig(result.config);
  } catch (_) {
    return res.status(500).json({ error: 'Could not save settings' });
  }
  _sabPathCache = null; // reset so new URL is re-probed (only after a successful save)
  res.json({ success: true });
});

// ── SABnzbd path auto-detection ───────────────────────────────────────────────
// Some installs use /sabnzbd/api (subdirectory), others use /api (root).

const SAB_PATHS = ['/sabnzbd/api', '/api'];

async function detectSabPath(baseUrl, apikey) {
  for (const p of SAB_PATHS) {
    try {
      const r = await axios.get(`${baseUrl}${p}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
        validateStatus: s => s === 200,
      });
      if (r.data && (r.data.version || r.data.status !== false)) return p;
    } catch (_) {}
  }
  return null;
}

// ── Test connections ──────────────────────────────────────────────────────────

app.post('/api/test/:service', async (req, res) => {
  const { service } = req.params;
  const body = isPlainObject(req.body) ? req.body : {};
  if (!body.url || !body.apikey || typeof body.url !== 'string' || typeof body.apikey !== 'string') {
    return res.status(400).json({ error: 'URL and API key are required' });
  }
  const url = normalizeServiceUrl(body.url);
  if (!url) return res.status(400).json({ error: 'Invalid URL: use an http(s) address without credentials, query or fragment' });
  let apikey = body.apikey;
  if (apikey.startsWith(MASK_PREFIX)) {
    apikey = SERVICE_IDS.includes(service) ? resolveMaskedKey(service, apikey, url) : null;
    if (!apikey) return res.status(400).json({ error: REENTER_KEY_ERROR });
  } else {
    const cleaned = cleanSubmittedKey(apikey);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    apikey = cleaned.key;
  }

  try {
    if (service === 'sabnzbd') {
      const detectedPath = await detectSabPath(url, apikey);
      if (!detectedPath) return res.status(503).json({ error: 'Could not reach SABnzbd — check URL and API key' });
      // Fetch version for display
      const r = await axios.get(`${url}${detectedPath}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
      });
      return res.json({ success: true, version: r.data.version, sabPath: detectedPath });
    }

    if (service === 'sonarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'radarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'nzbhydra') {
      await axios.get(`${url}/api`, {
        params: { t: 'caps', o: 'json', apikey },
        timeout: 10000,
      });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown service' });
  } catch (e) {
    const msg = e.response
      ? `HTTP ${e.response.status}: ${e.response.statusText}`
      : e.code === 'ECONNREFUSED'
      ? 'Connection refused — is the service running?'
      : e.message;
    res.status(503).json({ error: msg });
  }
});

// ── SABnzbd ───────────────────────────────────────────────────────────────────

let _sabPathCache = null;

async function getSabPath(baseUrl, apikey) {
  if (_sabPathCache) return _sabPathCache;
  // Env-managed SABnzbd never reads or persists sabPath: memory cache only.
  const envManaged = Boolean(ENV_SERVICES.sabnzbd);
  if (!envManaged) {
    const stored = loadStoredConfig();
    if (stored.sabnzbd?.sabPath) { _sabPathCache = stored.sabnzbd.sabPath; return _sabPathCache; }
  }
  const detected = await detectSabPath(baseUrl, apikey);
  if (detected) {
    _sabPathCache = detected;
    if (!envManaged) {
      // Persist it (stored config only) so future restarts don't re-probe
      try {
        const fresh = loadStoredConfig();
        fresh.sabnzbd = { ...fresh.sabnzbd, sabPath: detected };
        saveConfig(fresh);
      } catch (_) {}
    }
  }
  return detected;
}

async function sabRequest(params) {
  const config = loadConfig();
  const { url, apikey } = config.sabnzbd || {};
  if (!url || !apikey) throw Object.assign(new Error('SABnzbd not configured'), { status: 503 });
  const sabPath = await getSabPath(url, apikey);
  if (!sabPath) throw Object.assign(new Error('Cannot reach SABnzbd'), { status: 503 });
  const r = await axios.get(`${url}${sabPath}`, {
    params: { output: 'json', apikey, ...params },
    timeout: 10000,
  });
  return r.data;
}

app.get('/api/sabnzbd/queue', async (req, res) => {
  try { res.json(await sabRequest({ mode: 'queue' })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sabnzbd/history', async (req, res) => {
  const limit = req.query.limit === undefined ? 15 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return res.status(400).json({ error: 'limit must be an integer from 1 to 1000' });
  try { res.json(await sabRequest({ mode: 'history', limit })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/action', async (req, res) => {
  const { mode, nzo_id, name, value } = req.body;
  try {
    let params;
    if (nzo_id && (mode === 'pause' || mode === 'resume')) {
      // Per-item pause/resume uses mode=queue&name=pause/resume&value=<id>
      params = { mode: 'queue', name: mode, value: nzo_id };
    } else {
      params = { mode };
      if (name)  params.name  = name;
      if (value) params.value = value;
      if (nzo_id && !value) params.value = nzo_id;
    }
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// ── Sonarr ────────────────────────────────────────────────────────────────────

function sonarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.sonarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Sonarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Shared calendar window rule: both bounds are single parseable strings, end is
// after start, and the interval is at most 32 days. Returns null when invalid.
function parseCalendarWindow(query) {
  const { start, end } = query;
  const startTime = typeof start === 'string' ? Date.parse(start) : NaN;
  const endTime = typeof end === 'string' ? Date.parse(end) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) ||
      endTime <= startTime || endTime - startTime > 32 * 86400000) return null;
  return { startTime, endTime };
}

// Poster and fanart (first of each, upstream order), reduced to url fields.
function pickPosterFanart(images) {
  if (!Array.isArray(images)) return [];
  const picked = [];
  let poster = false, fanart = false;
  for (const image of images) {
    if (!image || typeof image !== 'object') continue;
    if (image.coverType === 'poster' && !poster) poster = true;
    else if (image.coverType === 'fanart' && !fanart) fanart = true;
    else continue;
    picked.push({ coverType: image.coverType, url: image.url, remoteUrl: image.remoteUrl });
  }
  return picked;
}

// Sonarr/Radarr queue proxies: bounded page, allowlisted records, and a fixed
// error message. downloadId is passed through verbatim for exact matching.
const QUEUE_PAGE_SIZE = 100;

function queueEnvelopeValid(queue) {
  return !!queue && typeof queue === 'object' && !Array.isArray(queue) &&
    queue.page === 1 && Number.isSafeInteger(queue.pageSize) &&
    queue.pageSize >= 1 && queue.pageSize <= QUEUE_PAGE_SIZE &&
    Number.isSafeInteger(queue.totalRecords) && queue.totalRecords >= 0 &&
    Array.isArray(queue.records) && queue.records.length <= queue.pageSize &&
    queue.records.every(record => record && typeof record === 'object');
}

function queueCommon(record) {
  const qualityName = record.quality?.quality?.name;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    size: record.size,
    sizeleft: record.sizeleft,
    timeleft: record.timeleft,
    estimatedCompletionTime: record.estimatedCompletionTime,
    trackedDownloadStatus: record.trackedDownloadStatus,
    trackedDownloadState: record.trackedDownloadState,
    downloadId: typeof record.downloadId === 'string' && record.downloadId !== '' ? record.downloadId : null,
    quality: qualityName === undefined || qualityName === null ? null : { name: qualityName },
  };
}

function sendQueueError(res, error, message) {
  // Never expose an axios error/config, upstream paths or authentication material.
  const code = error.response?.status;
  // A 404 from the service is an upstream failure, not a missing ArrView route.
  res.status(code === 404 ? 502 : (code >= 400 && code <= 599 ? code : 503)).json({ error: message });
}

async function fetchQueue({ baseUrl, headers }, includeParams) {
  const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/queue`, {
    headers,
    params: { page: 1, pageSize: QUEUE_PAGE_SIZE, ...includeParams },
    timeout: 10000,
    maxContentLength: 4 * 1024 * 1024,
    maxRedirects: 0,
    responseType: 'json',
    transitional: { silentJSONParsing: false },
  });
  return response.data;
}

app.get('/api/sonarr/queue', async (req, res) => {
  const message = 'Sonarr queue unavailable';
  try {
    const queue = await fetchQueue(sonarrHeaders(), { includeSeries: true, includeEpisode: true });
    if (!queueEnvelopeValid(queue)) return res.status(502).json({ error: message });
    // Deliberate allowlist: no filesystem paths, download client, indexer or overviews.
    const records = queue.records.map(record => {
      const { series, episode } = record;
      return {
        ...queueCommon(record),
        seriesId: record.seriesId,
        episodeId: record.episodeId,
        series: series && typeof series === 'object' ? {
          id: series.id, title: series.title, year: series.year, images: pickPosterFanart(series.images),
        } : null,
        episode: episode && typeof episode === 'object' ? {
          id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
          title: episode.title, airDateUtc: episode.airDateUtc,
        } : null,
      };
    });
    res.json({ page: 1, pageSize: queue.pageSize, totalRecords: queue.totalRecords, records });
  } catch (error) { sendQueueError(res, error, message); }
});

// Bound calendar requests and include series in one upstream call (no N+1).
app.get('/api/sonarr/calendar', async (req, res) => {
  const window = parseCalendarWindow(req.query);
  if (!window) {
    return res.status(400).json({ error: 'Provide a valid start/end interval of at most 32 days' });
  }
  const { startTime, endTime } = window;
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/v3/calendar`, {
      headers,
      params: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(),
        includeSeries: true, includeEpisodeImages: true, unmonitored: false },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/series/:id/episodes', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/episode`, {
      headers,
      params: { seriesId: req.params.id, includeImages: true },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/command/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/command/${req.params.id}`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Interactive release search for a specific episode.
// Tries Sonarr first; if no results, falls back to a direct NZBHydra search.
// Direct NZBHydra search returning release-shaped objects — the shared
// fallback for both interactive search endpoints (Sonarr + Radarr).
async function hydraDirectSearch(q) {
  const config = loadConfig();
  const { url: hydraUrl, apikey: hydraKey } = config.nzbhydra || {};
  if (!hydraUrl || !hydraKey || !q) return [];

  const hydraRes = await axios.get(`${hydraUrl}/api`, {
    params: { t: 'search', q, o: 'json', apikey: hydraKey },
    timeout: 30000,
  });
  const rawItems = hydraRes.data?.channel?.item || [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]);

  return items.map(item => {
    const attrs = {};
    const rawAttrs = item['newznab:attr'] || item['attr'] || [];
    (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
      const n = a?.['@attributes'] || a;
      if (n?.name) attrs[n.name] = n.value;
    });
    const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
    const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
    const pubDate = item.pubDate ? new Date(item.pubDate) : null;
    const ageHours = pubDate ? (Date.now() - pubDate.getTime()) / 3600000 : null;
    return {
      guid:       item.guid?.['#text'] || item.guid || item.link,
      title:      item.title || '(no title)',
      indexer:    attrs.indexer || attrs.site || 'NZBHydra',
      size:       sizeBytes,
      ageHours,
      protocol:   'usenet',
      approved:   true,
      rejections: [],
      quality:    { quality: { name: 'Unknown' } },
      // For NZBHydra-direct results we send the NZB URL to SABnzbd ourselves
      _source:    'nzbhydra',
      _nzbUrl:    encUrl,
    };
  }).filter(r => r._nzbUrl);
}

app.get('/api/sonarr/release', async (req, res) => {
  const { episodeId, seriesTitle, season, episode } = req.query;
  try {
    // 1. Ask Sonarr (it queries all its configured indexers)
    const { baseUrl, headers } = sonarrHeaders();
    const sonarrRes = await axios.get(`${baseUrl}/api/v3/release`, {
      headers,
      params: { episodeId },
      timeout: 60000,
    });
    const sonarrResults = (sonarrRes.data || []).map(r => ({ ...r, _source: 'sonarr' }));

    if (sonarrResults.length > 0) {
      return res.json(sonarrResults);
    }

    // 2. Fallback: direct NZBHydra search if Sonarr found nothing
    if (!seriesTitle) return res.json([]);
    const sn = String(season || '').padStart(2, '0');
    const ep = String(episode || '').padStart(2, '0');
    res.json(await hydraDirectSearch(`${seriesTitle} S${sn}E${ep}`));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Grab a specific release
app.post('/api/sonarr/release', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/release`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Delete an episode file from disk
app.delete('/api/sonarr/episodefile/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    await axios.delete(`${baseUrl}/api/v3/episodefile/${req.params.id}`, { headers, timeout: 15000 });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Update episode monitored status
app.put('/api/sonarr/episode/monitor', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.put(`${baseUrl}/api/v3/episode/monitor`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/series`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

// Read the current resource so changing monitoring preserves Sonarr metadata.
app.put('/api/sonarr/series/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || typeof req.body.monitored !== 'boolean')
    return res.status(400).json({ error: 'A numeric series id and boolean monitored are required' });
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v3/series/${req.params.id}`;
    const current = await axios.get(url, { headers, timeout: 15000 });
    const updated = await axios.put(url, { ...current.data, monitored: req.body.monitored }, { headers, timeout: 15000 });
    res.json(updated.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.response?.data?.message || e.message }); }
});

app.delete('/api/sonarr/series/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const deleteFiles = req.query.deleteFiles === 'true';
    await axios.delete(`${baseUrl}/api/v3/series/${req.params.id}`, {
      headers,
      params: { deleteFiles, addImportListExclusion: false },
      timeout: 15000,
    });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// ── Radarr ────────────────────────────────────────────────────────────────────

function radarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.radarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Radarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/radarr/movies', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/queue', async (req, res) => {
  const message = 'Radarr queue unavailable';
  try {
    const queue = await fetchQueue(radarrHeaders(), { includeMovie: true });
    if (!queueEnvelopeValid(queue)) return res.status(502).json({ error: message });
    // Deliberate allowlist: no filesystem paths, download client, indexer or overviews.
    const records = queue.records.map(record => {
      const movie = record.movie;
      return {
        ...queueCommon(record),
        movieId: record.movieId,
        movie: movie && typeof movie === 'object' ? {
          id: movie.id, title: movie.title, year: movie.year, images: pickPosterFanart(movie.images),
        } : null,
      };
    });
    res.json({ page: 1, pageSize: queue.pageSize, totalRecords: queue.totalRecords, records });
  } catch (error) { sendQueueError(res, error, message); }
});

// Digital and physical releases only. Radarr returns a movie when any of its
// dates (cinema included) is in the window, so the server applies the product
// rule once for every client: keep a movie only if its digital or physical
// release falls inside the validated window (inclusive).
const RADARR_CALENDAR_LIMIT = 500;
app.get('/api/radarr/calendar', async (req, res) => {
  const window = parseCalendarWindow(req.query);
  if (!window) {
    return res.status(400).json({ error: 'Provide a valid start/end interval of at most 32 days' });
  }
  const { startTime, endTime } = window;
  const message = 'Radarr calendar unavailable';
  try {
    const { baseUrl, headers } = radarrHeaders();
    const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/calendar`, {
      headers,
      params: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(), unmonitored: false },
      timeout: 10000,
      maxContentLength: 4 * 1024 * 1024,
      maxRedirects: 0,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
    });
    if (!Array.isArray(response.data)) return res.status(502).json({ error: message });
    const inWindow = value => {
      const time = typeof value === 'string' ? Date.parse(value) : NaN;
      return time >= startTime && time <= endTime;
    };
    const movies = [];
    for (const movie of response.data) {
      if (movies.length >= RADARR_CALENDAR_LIMIT) break;
      if (!movie || typeof movie !== 'object') continue;
      if (!inWindow(movie.digitalRelease) && !inWindow(movie.physicalRelease)) continue;
      // Deliberate allowlist: no filesystem paths, overviews, ratings or external ids.
      movies.push({
        id: movie.id ?? null, title: movie.title ?? null, year: movie.year ?? null,
        monitored: movie.monitored ?? null, hasFile: movie.hasFile ?? null,
        isAvailable: movie.isAvailable ?? null, status: movie.status ?? null,
        inCinemas: movie.inCinemas ?? null, digitalRelease: movie.digitalRelease ?? null,
        physicalRelease: movie.physicalRelease ?? null,
        physicalReleaseNote: movie.physicalReleaseNote ?? null,
        images: pickPosterFanart(movie.images),
      });
    }
    res.json(movies);
  } catch (error) { sendQueueError(res, error, message); }
});

// Widget metadata must never fetch the full movie library. Radarr's paged
// history takes numeric eventType=3 (downloadFolderImported), newest first.
// Bounds match the widget client: 20 records/page, at most three pages.
app.get('/api/radarr/history/recent-imports', async (req, res) => {
  const pageText = req.query.page ?? '1';
  if (typeof pageText !== 'string' || !/^[1-3]$/.test(pageText)) {
    return res.status(400).json({ error: 'page must be an integer from 1 to 3' });
  }
  const page = Number(pageText);
  const pageSize = 20;
  try {
    const { baseUrl, headers } = radarrHeaders();
    const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/history`, {
      headers,
      params: { page, pageSize, eventType: 3, includeMovie: true, sortKey: 'date', sortDirection: 'descending' },
      timeout: 10000,
      maxContentLength: 512 * 1024,
      maxRedirects: 0,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
    });
    const history = response.data;
    if (history?.page !== page || !Number.isSafeInteger(history.pageSize) ||
        history.pageSize < 1 || history.pageSize > pageSize ||
        !Number.isSafeInteger(history.totalRecords) || history.totalRecords < 0 ||
        !Array.isArray(history.records) || history.records.length > history.pageSize ||
        history.totalRecords < history.records.length ||
        (history.records.length === 0 && history.totalRecords > (page - 1) * history.pageSize)) {
      return res.status(502).json({ error: 'Invalid Radarr history page' });
    }
    // Deliberate allowlist: no filesystem paths, release metadata or overviews.
    const records = history.records.map(record => {
      const movie = record.movie;
      return {
        movieId: record.movieId, date: record.date, eventType: record.eventType,
        movie: movie ? {
          id: movie.id, title: movie.title, year: movie.year,
          hasFile: movie.hasFile, movieFileId: movie.movieFileId,
          movieFile: movie.movieFile ? { id: movie.movieFile.id, dateAdded: movie.movieFile.dateAdded } : null,
          images: Array.isArray(movie.images) ? movie.images.filter(image => image.coverType === 'poster').slice(0, 1)
            .map(image => ({ coverType: image.coverType, url: image.url, remoteUrl: image.remoteUrl })) : [],
        } : null,
      };
    });
    res.json({ page, pageSize: history.pageSize, totalRecords: history.totalRecords, records });
  } catch (error) {
    // Never expose an axios error/config, upstream paths or authentication material.
    const code = error.response?.status;
    // A 404 from Radarr is an upstream failure, not a missing ArrView route.
    res.status(code === 404 ? 502 : (code >= 400 && code <= 599 ? code : 503))
      .json({ error: 'Recent movie imports unavailable' });
  }
});

app.post('/api/radarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Interactive release search for one movie: Radarr's indexers first,
// NZBHydra fallback — mirrors /api/sonarr/release.
app.get('/api/radarr/release', async (req, res) => {
  const { movieId, title, year } = req.query;
  try {
    const { baseUrl, headers } = radarrHeaders();
    const radarrRes = await axios.get(`${baseUrl}/api/v3/release`, {
      headers,
      params: { movieId },
      timeout: 60000,
    });
    const radarrResults = (radarrRes.data || []).map(r => ({ ...r, _source: 'radarr' }));

    if (radarrResults.length > 0) {
      return res.json(radarrResults);
    }

    if (!title) return res.json([]);
    res.json(await hydraDirectSearch(year ? `${title} ${year}` : title));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Grab a specific movie release
app.post('/api/radarr/release', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/release`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Delete a movie file from disk
app.delete('/api/radarr/moviefile/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    await axios.delete(`${baseUrl}/api/v3/moviefile/${req.params.id}`, { headers, timeout: 15000 });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Remove a movie from Radarr's library; deleteFiles=true also deletes its folder.
// Radarr spells the exclusion flag addImportExclusion — Sonarr's
// addImportListExclusion is silently ignored here, so don't copy the series route.
app.delete('/api/radarr/movie/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid movie id' });
  try {
    const { baseUrl, headers } = radarrHeaders();
    const deleteFiles = req.query.deleteFiles === 'true';
    await axios.delete(`${baseUrl.replace(/\/+$/, '')}/api/v3/movie/${req.params.id}`, {
      headers,
      params: { deleteFiles, addImportExclusion: false },
      timeout: 15000,
    });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Update movie monitored status (bulk, via Radarr's movie editor)
app.put('/api/radarr/movie/monitor', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.put(`${baseUrl}/api/v3/movie/editor`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/radarr/movie', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/movie`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

app.get('/api/nzbhydra/search', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  const { q, cat } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    const params = { t: 'search', q, o: 'json', apikey };
    if (cat) params.cat = cat;
    const r = await axios.get(`${url}/api`, { params, timeout: 30000 });
    const items = r.data?.channel?.item || [];
    const results = (Array.isArray(items) ? items : [items]).map(item => {
      const attrs = {};
      const rawAttrs = item['newznab:attr'] || item['attr'] || [];
      (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
        const n = a?.['@attributes'] || a;
        if (n?.name) attrs[n.name] = n.value;
      });
      const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
      const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
      return {
        title:    item.title || '(no title)',
        guid:     item.guid?.['#text'] || item.guid || item.link,
        link:     encUrl,
        size:     sizeBytes,
        pubDate:  item.pubDate,
        category: item.category,
        indexer:  attrs.indexer || attrs.site || '',
        grabs:    attrs.grabs || 0,
      };
    }).filter(r => r.link);
    res.json(results);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/addurl', async (req, res) => {
  const { url: nzbUrl, name } = req.body;
  if (!nzbUrl) return res.status(400).json({ error: 'Missing url' });
  try {
    const params = { mode: 'addurl', name: nzbUrl };
    if (name) params.nzbname = name;
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});



app.get('/api/nzbhydra/status', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  try {
    await axios.get(`${url}/api`, { params: { t: 'caps', o: 'json', apikey }, timeout: 10000 });
    res.json({ status: 'ok' });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

// ── Server-Sent Events ────────────────────────────────────────────────────────
// Browser clients subscribe here and receive push notifications when Sonarr
// (or Radarr) webhooks fire, triggering an immediate UI refresh.

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  // Keep-alive ping every 25s to prevent proxy/browser timeouts
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

// ── What the webhooks last delivered ─────────────────────────────────────────
// Per service, the last event and, separately, the last Test message, so pressing Test in Sonarr or Radarr
// never hides when a real event last arrived. Memory only: a restart starts it empty, and GET
// /api/webhooks/last says how long ago that was. Settings shows it so a setup can be checked without reading
// logs. Webhook calls are not authenticated, so this only says that a message arrived, not who sent it; the
// type is kept only when it is plain letters (all Sonarr and Radarr event types are), nothing else is.
const STARTED_AT = Date.now();
const webhookSeen = { sonarr: { event: null, test: null }, radarr: { event: null, test: null } };
function noteWebhook(service, eventType) {
  if (typeof eventType !== 'string' || !/^[A-Za-z]{1,40}$/.test(eventType)) return;
  webhookSeen[service][eventType === 'Test' ? 'test' : 'event'] = { eventType, at: Date.now() };
}

// Ages are worked out here, so a browser clock that disagrees with this one never shows a wrong time.
app.get('/api/webhooks/last', (req, res) => {
  const now = Date.now();
  const age = since => Math.max(0, Math.floor((now - since) / 1000));
  const seen = entry => entry && { eventType: entry.eventType, ageSeconds: age(entry.at) };
  const service = name => ({ event: seen(webhookSeen[name].event), test: seen(webhookSeen[name].test) });
  res.json({ uptimeSeconds: age(STARTED_AT), sonarr: service('sonarr'), radarr: service('radarr') });
});

// ── Sonarr webhook ────────────────────────────────────────────────────────────
// In Sonarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/sonarr
//   Method: POST (only POST is routed)
//   Events: On File Import, On File Upgrade, On Rename, On Series Add, On Series Delete, On Episode File Delete
//           (older Sonarr: On Download, On Upgrade)
// Settings → Webhooks in the web UI shows the URL for the address Sonarr uses to reach this server, with these
// steps. The Test message is answered and noted (see above) but changes no page; every other event also
// refreshes the pages that are open.

app.post('/api/webhooks/sonarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, series, episodes } = req.body;
  noteWebhook('sonarr', eventType);
  if (!eventType || eventType === 'Test') return;
  console.log(`[Sonarr webhook] ${eventType} — series: ${series?.title}`);
  broadcast('sonarr', {
    eventType,
    seriesId:   series?.id   ?? null,
    seriesTitle: series?.title ?? null,
    episodeIds: (episodes ?? []).map(e => e.id),
  });
});

// ── Radarr webhook ────────────────────────────────────────────────────────────
// In Radarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/radarr
//   Method: POST (only POST is routed)
//   Events: On File Import, On File Upgrade, On Rename, On Movie Added, On Movie Delete, On Movie File Delete
//           (older Radarr: On Download, On Upgrade)
// Settings → Webhooks in the web UI shows this URL and these steps, as for Sonarr.

app.post('/api/webhooks/radarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, movie } = req.body;
  noteWebhook('radarr', eventType);
  if (!eventType || eventType === 'Test') return;
  console.log(`[Radarr webhook] ${eventType} — movie: ${movie?.title}`);
  broadcast('radarr', {
    eventType,
    movieId:    movie?.id    ?? null,
    movieTitle: movie?.title ?? null,
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  const isApi = req.path === '/api' || req.path.startsWith('/api/');
  res.setHeader('Cache-Control', isApi ? 'no-store' : 'no-cache');
  if (isApi || path.extname(req.path)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Run `npm run build` first, or use `npm run dev` for development.');
  }
});

// ── Login start-up ────────────────────────────────────────────────────────────
// Reads auth.json and the Docker variables and settles the state before anything is served (app.listen runs only
// after this resolves). It never rejects: an unexpected error leaves the login ON with no way to sign in.
async function initDockerPassword(password, file) {
  const stored = file.data;
  if (stored && stored.record && stored.record.origin === 'docker' && await verifyRecord(stored.record, password)) {
    adoptAuth(stored, true);
    authLog('[auth] login is ON: password set by the Docker configuration.');
    return;
  }
  const replacing = Boolean(file.bad || (stored && stored.record));
  const next = { record: await hashPassword(password, 'docker'), secret: crypto.randomBytes(32), accessKey: newAccessKey() };
  adoptAuth(next, true);
  try { writeAuthFile(next); } catch (e) {
    authLog(`[auth] could not write auth.json (${(e && e.code) || 'error'}); the Docker password is in force but sessions will not survive a restart.`);
  }
  if (replacing) authLog('[auth] the Docker password changed; everyone is signed out.');
  authLog('[auth] login is ON: password set by the Docker configuration.');
}

async function initAuth() {
  try {
    const env = resolveEnvAuth(process.env, authLog);
    if (env.authOff) {
      auth.disabledByDocker = true;
      authLog('[auth] login is OFF: ARRVIEW_AUTH=off is set (any password is ignored).');
      return;
    }
    if (env.error) { auth.mode = 'closed'; return; }
    const file = readAuthFile();
    if (env.password !== null) return await initDockerPassword(env.password, file);
    if (file.bad) {
      auth.mode = 'closed';
      authLog(`[auth] auth.json could not be read (${file.bad}); the login stays ON and no one can sign in. Fix or remove the file, set ARRVIEW_PASSWORD, or set ARRVIEW_AUTH=off.`);
      return;
    }
    if (file.missing || !file.data.record) { authLog('[auth] login is OFF (no password set).'); return; }
    adoptAuth(file.data, false);
    if (auth.record.origin === 'docker') {
      auth.record.origin = 'settings';
      try { writeAuthFile({ record: auth.record, secret: auth.secret, accessKey: auth.key }); } catch (_) {}
      authLog('[auth] ARRVIEW_PASSWORD is no longer set; the stored password stays in force and can be changed in Settings.');
    }
    authLog('[auth] login is ON (password set in Settings).');
  } catch (e) {
    Object.assign(auth, { mode: 'closed', record: null, secret: null, key: null, keyDigest: null, dockerManaged: false });
    authLog(`[auth] start-up failed (${(e && e.code) || 'error'}); the login stays ON and no one can sign in.`);
  }
}
const authReady = initAuth();

authReady.then(() => app.listen(PORT, () => {
  console.log(`✅  ArrView API running on http://localhost:${PORT}`);
  console.log(`    Sonarr webhook URL: http://localhost:${PORT}/api/webhooks/sonarr`);
  console.log(`    Radarr webhook URL: http://localhost:${PORT}/api/webhooks/radarr`);

  // Advertise over Bonjour so the ArrView iOS app can auto-discover this
  // server. Optional dependency — absence just disables auto-discovery.
  try {
    const { Bonjour } = require('bonjour-service');

    // The SRV target and A records must live under `.local`, or clients resolve
    // them via unicast DNS and fail. Inside a container os.hostname() is the bare
    // container ID (no TLD), so append `.local` explicitly.
    const advertiseHost =
      (process.env.ADVERTISE_HOST || os.hostname()).replace(/\.local\.?$/i, '') + '.local';

    // Pick a single LAN IPv4 to advertise. Under host networking the container
    // sees every host interface (LAN + docker0 + bridges + VPNs); advertising
    // the docker bridge (e.g. 172.17.0.1) hands iOS an unreachable address to
    // try, which breaks discovery. ADVERTISE_IP overrides the auto-pick.
    const advertiseIP = process.env.ADVERTISE_IP || (() => {
      const skip = /^(docker|br-|veth|virbr|cni|flannel|tailscale|zt|wg|lo)/i;
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        if (skip.test(name)) continue;
        for (const a of addrs || []) {
          if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
        }
      }
      return null;
    })();

    // bonjour-service builds A records from os.networkInterfaces() on every
    // announce/response with no filter hook, so constrain what it sees to the
    // chosen address. A non-zero mac is required — it skips 00:..:00 entries.
    if (advertiseIP) {
      os.networkInterfaces = () => ({
        lan: [{ address: advertiseIP, netmask: '255.255.255.0', family: 'IPv4',
                mac: '02:00:00:00:00:01', internal: false, cidr: `${advertiseIP}/24` }],
      });
    }

    // Bonjour must never take the server down. When another mDNS responder on the
    // host owns UDP 5353 without sharing it (Avahi, a NAS's own discovery service),
    // the bind fails after construction, as an async 'error' event on the
    // multicast-dns instance. bonjour-service 1.4 attaches no listener for it, so
    // Node exits and a restart policy loops the container; its default errorCallback
    // rethrows as well. Point both at a logger. multicast-dns reports one failed
    // bind twice and retries it on every send, so each distinct problem logs once.
    const reported = new Set();
    const onBonjourError = (err) => {
      // EADDRINUSE and EACCES are the bind failures multicast-dns raises as 'error' events:
      // nothing is advertised, and the Settings page says so. Any other error (a failed send,
      // say) is transient, so it is logged but leaves the state alone.
      if (err && err.code === 'EADDRINUSE') setBonjourStatus('unavailable', 'port-in-use');
      else if (err && err.code === 'EACCES') setBonjourStatus('unavailable', 'permission-denied');
      const message = (err && err.message) || String(err);
      if (reported.has(message)) return;
      reported.add(message);
      console.log(err && err.code === 'EADDRINUSE'
        ? `    Bonjour: ${message} — another mDNS responder on this host (Avahi or a NAS's discovery service, say) holds UDP 5353 and does not share it, so iOS auto-discovery is unavailable. ArrView keeps running; add the server in the app by address.`
        : `    Bonjour: ${message} — iOS auto-discovery may not work. ArrView keeps running.`);
    };
    setBonjourStatus('starting');
    const bonjour = new Bonjour({}, onBonjourError);
    const mdns = bonjour.server && bonjour.server.mdns;
    if (mdns) {
      mdns.on('error', onBonjourError);
      // 'ready' means the first bind worked. 'networkInterface' fires when the socket has joined
      // the multicast group, which also happens when a bind that failed earlier succeeds on one
      // of the library's later retries (it re-binds on every announcement), clearing the notice.
      mdns.on('ready', () => setBonjourStatus('advertising'));
      mdns.on('networkInterface', () => setBonjourStatus('advertising'));
    }

    bonjour.publish({ name: 'ArrView', type: 'arrview', port: Number(PORT), host: advertiseHost });
    console.log(`    Bonjour: advertising _arrview._tcp as ${advertiseHost} (${advertiseIP || 'all interfaces'}):${PORT}`);
  } catch (err) {
    const missing = Boolean(err) && err.code === 'MODULE_NOT_FOUND';
    setBonjourStatus('unavailable', missing ? 'not-installed' : 'start-failed');
    console.log(missing
      ? '    Bonjour: bonjour-service not installed — iOS auto-discovery disabled'
      : `    Bonjour: couldn't start (${(err && err.message) || err}) — iOS auto-discovery disabled`);
  }
}));
