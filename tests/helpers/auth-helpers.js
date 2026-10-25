// Helpers for the login tests: a seeded auth.json (cheap scrypt cost), cookie forging and parsing, and a fetch that
// records everything it sees.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./server-harness');

const PASSWORD = 'correct horse battery';
const AJAX = { 'Content-Type': 'application/json', 'X-Requested-With': 'ArrView' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// A temp config directory with a built-shell stub, to be handed to startServer as options.root.
function newRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html>shell</html>');
  return root;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const digestOf = token => crypto.createHash('sha256').update(token).digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

// Writes a valid version 2 auth.json using N=1024 (allowed by the server's validation) so tests skip the 155 ms / 128 MiB
// hash. `sessions` lists the seconds each stored session has left (default one with 30 days); `keys` lists key names
// (default one). Returns the raw tokens (the file holds only their digests): token/cookie for the first session,
// tokens[] / cookies[] for all, accessKey for the first key, accessKeys[] for all.
function seedAuth(root, password = PASSWORD, { origin = 'settings', N = 1024, sessions = [30 * DAY], keys = ['Test key'] } = {}) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, 64, { N, r: 8, p: 1 });
  const record = { origin, algorithm: 'scrypt', N, r: 8, p: 1, keylen: 64, salt: salt.toString('base64'), hash: hash.toString('base64') };
  const tokens = sessions.map(() => newToken());
  const accessKeys = keys.map(() => newToken());
  const now = nowSec();
  const body = {
    version: 2, password: record,
    sessions: tokens.map((token, i) => ({ digest: digestOf(token), created: now - i, expires: now + sessions[i] })),
    keys: accessKeys.map((key, i) => ({ id: crypto.randomBytes(8).toString('hex'), name: keys[i], digest: digestOf(key), created: now - i, lastUsed: null })),
  };
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify(body, null, 2), { mode: 0o600 });
  const cookies = tokens.map(t => `arrview_session=${t}`);
  return { password, record, tokens, token: tokens[0], cookies, cookie: cookies[0], accessKeys, accessKey: accessKeys[0], keyIds: body.keys.map(k => k.id) };
}

// 'name=value; Max-Age=...' -> { name, value, attrs: { lowercased attribute: value|true } }
function parseSetCookie(line) {
  const [pair, ...rest] = line.split(';').map(s => s.trim());
  const eq = pair.indexOf('=');
  const attrs = {};
  for (const a of rest) {
    const i = a.indexOf('=');
    attrs[(i < 0 ? a : a.slice(0, i)).toLowerCase()] = i < 0 ? true : a.slice(i + 1);
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs, raw: line };
}
const setCookies = response => response.headers.getSetCookie().map(parseSetCookie);
const cookieHeader = parsed => `${parsed.name}=${parsed.value}`;

async function loginCookie(base, password = PASSWORD) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password }) });
  if (response.status !== 200) throw new Error(`login failed with ${response.status}`);
  return cookieHeader(setCookies(response)[0]);
}

// Starts a server on a fresh root with a seeded auth.json (unless seed is false).
async function startSeeded(t, { password = PASSWORD, seed = true, seedOptions, ...options } = {}) {
  const root = options.root || newRoot(t);
  const seeded = seed ? seedAuth(root, password, seedOptions) : null;
  const server = await startServer(t, { ...options, root });
  return { ...server, seeded };
}

// fetch that records every response (status, headers, body text) for the secrets scan.
function trackingFetch() {
  const seen = [];
  const tracked = async (url, options) => {
    const response = await fetch(url, options);
    const body = await response.clone().text().catch(() => '');
    seen.push({ url: String(url), method: (options && options.method) || 'GET', status: response.status,
      headers: [...response.headers.entries()], setCookies: response.headers.getSetCookie(), body });
    return response;
  };
  tracked.seen = seen;
  return tracked;
}

module.exports = { PASSWORD, AJAX, JSON_HEADERS, DAY, newToken, digestOf, nowSec, newRoot, seedAuth, parseSetCookie, setCookies, cookieHeader,
  loginCookie, startSeeded, trackingFetch };
