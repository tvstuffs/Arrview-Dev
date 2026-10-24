const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer } = require('./helpers/server-harness');
const { PASSWORD, AJAX, JSON_HEADERS, newRoot, seedAuth, forgeCookie, setCookies, cookieHeader, loginCookie, startSeeded } = require('./helpers/auth-helpers');
const { routeTable } = require('./helpers/route-table');

const post = (s, path, body, headers = JSON_HEADERS) => fetch(s.base + path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const nowSec = () => Math.floor(Date.now() / 1000);

test('status in every state', async (t) => {
  const open = await startServer(t, { root: newRoot(t) });
  assert.deepEqual(await (await fetch(open.base + '/api/auth/status')).json(), {
    required: false, signedIn: false, source: 'none', authDisabledByDocker: false, passwordMinLength: 8, passwordMaxLength: 256 });
  const s = await startSeeded(t);
  assert.deepEqual(await (await fetch(s.base + '/api/auth/status')).json(), { required: true, signedIn: false });
  const cookie = await loginCookie(s.base);
  const signed = await (await fetch(s.base + '/api/auth/status', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(signed, { required: true, signedIn: true, source: 'settings', authDisabledByDocker: false, passwordMinLength: 8, passwordMaxLength: 256 });
  const byKey = await (await fetch(s.base + '/api/auth/status', { headers: { 'X-Api-Key': s.seeded.accessKey } })).json();
  assert.equal(byKey.signedIn, true);
  assert.equal(JSON.stringify(signed).includes(s.seeded.accessKey), false);
});

test('login: success, wrong password with the 500 ms floor, 400, 409, 503', async (t) => {
  const s = await startSeeded(t);
  const started = Date.now();
  const bad = await post(s, '/api/auth/login', { password: 'wrong password!' });
  assert.ok(Date.now() - started >= 450);
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { error: 'Incorrect password' });
  assert.equal(setCookies(bad).length, 0);
  const short = Date.now();
  assert.equal((await post(s, '/api/auth/login', { password: 'x' })).status, 401);
  assert.ok(Date.now() - short >= 450);
  for (const body of [{}, { password: '' }, { password: 5 }]) {
    const r = await post(s, '/api/auth/login', body);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Password is required' });
  }
  const ok = await post(s, '/api/auth/login', { password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true });
  const [cookie] = setCookies(ok);
  assert.equal(cookie.name, 'arrview_session');
  assert.equal(cookie.attrs.httponly, true);
  assert.equal(cookie.attrs.samesite, 'Lax');
  assert.equal(cookie.attrs.path, '/');
  assert.equal(cookie.attrs['max-age'], '2592000');
  assert.equal('domain' in cookie.attrs, false);
  assert.equal('secure' in cookie.attrs, false);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookieHeader(cookie) } })).status, 200);

  const off = await startServer(t, { root: newRoot(t) });
  const r409 = await post(off, '/api/auth/login', { password: PASSWORD });
  assert.equal(r409.status, 409);
  assert.deepEqual(await r409.json(), { error: 'No password is set' });

  const root = newRoot(t);
  fs.writeFileSync(root + '/auth.json', '{not json');
  const closed = await startServer(t, { root });
  const r503 = await post(closed, '/api/auth/login', { password: PASSWORD });
  assert.equal(r503.status, 503);
  assert.equal((await r503.json()).error, 'The login is unavailable because its settings could not be read. See the ArrView log.');
  assert.deepEqual(await (await fetch(closed.base + '/api/auth/status')).json(), { required: true, signedIn: false, unavailable: true });
  assert.equal((await post(closed, '/api/auth/token', { password: PASSWORD })).status, 503);
});

test('logout clears the cookie, token returns the key and sets no cookie, both key headers work', async (t) => {
  const s = await startSeeded(t);
  const out = await post(s, '/api/auth/logout', {});
  assert.equal(out.status, 200);
  const [cleared] = setCookies(out);
  assert.equal(cleared.value, '');
  assert.equal(cleared.attrs['max-age'], '0');
  assert.equal(cleared.attrs.expires, 'Thu, 01 Jan 1970 00:00:00 GMT');
  assert.equal(cleared.attrs.httponly, true);
  const token = await post(s, '/api/auth/token', { password: PASSWORD });
  assert.equal(token.status, 200);
  assert.deepEqual(await token.json(), { accessKey: s.seeded.accessKey });
  assert.equal(setCookies(token).length, 0);
  const key = s.seeded.accessKey;
  assert.equal((await fetch(s.base + '/api/config', { headers: { Authorization: `Bearer ${key}` } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': 'nope' } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': `${key}x` } })).status, 401);
  assert.equal((await post(s, '/api/auth/token', { password: 'wrong password!' })).status, 401);
});

test('first password, change, remove, logout-all, regenerate', async (t) => {
  const root = newRoot(t);
  const s = await startServer(t, { root });
  assert.equal((await (await fetch(s.base + '/api/arrview/identify')).json()).auth, false);
  const first = await post(s, '/api/auth/password', { newPassword: 'first password 1' });
  assert.equal(first.status, 200);
  let cookie = cookieHeader(setCookies(first)[0]);
  const stored = s.readAuth();
  assert.equal(fs.statSync(s.authFile).mode & 0o777, 0o600);
  assert.deepEqual({ N: stored.password.N, r: stored.password.r, p: stored.password.p, origin: stored.password.origin }, { N: 131072, r: 8, p: 1, origin: 'settings' });
  assert.equal((await (await fetch(s.base + '/api/arrview/identify')).json()).auth, true);
  assert.equal((await fetch(s.base + '/api/config')).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.deepEqual(s.tempFiles(), []);

  // with the login on, a new password needs the current one
  const second = await post(s, '/api/auth/password', { newPassword: 'other password 2' }, { ...AJAX, Cookie: cookie });
  assert.equal(second.status, 400);

  // key-only caller cannot manage; wrong current keeps the browser signed in
  const key1 = (await (await fetch(s.base + '/api/auth/access-key', { headers: { Cookie: cookie } })).json()).accessKey;
  const keyOnly = await post(s, '/api/auth/password', { currentPassword: 'first password 1', newPassword: 'second password 2' }, { ...JSON_HEADERS, 'X-Api-Key': key1 });
  assert.equal(keyOnly.status, 403);
  assert.equal((await keyOnly.json()).error, 'Sign in with a browser to do this');
  assert.equal((await fetch(s.base + '/api/auth/access-key', { headers: { 'X-Api-Key': key1 } })).status, 403);
  const missing = await post(s, '/api/auth/password', { newPassword: 'second password 2' }, { ...AJAX, Cookie: cookie });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, 'Current password is required');
  const t0 = Date.now();
  const wrong = await post(s, '/api/auth/password', { currentPassword: 'nope nope nope', newPassword: 'second password 2' }, { ...AJAX, Cookie: cookie });
  assert.equal(wrong.status, 403);
  assert.ok(Date.now() - t0 >= 450);
  assert.equal((await wrong.json()).error, 'Current password is incorrect');
  assert.equal(setCookies(wrong).length, 0);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  for (const [newPassword, error] of [['short', 'Password must be 8 to 256 characters'], ['        ', "Password can't be only spaces"]]) {
    const r = await post(s, '/api/auth/password', { currentPassword: 'first password 1', newPassword }, { ...AJAX, Cookie: cookie });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, error);
  }

  // change: the other browser and the old key are cut off, this browser gets a new cookie
  const other = await loginCookie(s.base, 'first password 1');
  const changed = await post(s, '/api/auth/password', { currentPassword: 'first password 1', newPassword: 'second password 2' }, { ...AJAX, Cookie: cookie });
  assert.equal(changed.status, 200);
  const newCookie = cookieHeader(setCookies(changed)[0]);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: other } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key1 } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: newCookie } })).status, 200);
  cookie = newCookie;

  // regenerate: old key stops, sessions stay
  const key2 = (await (await fetch(s.base + '/api/auth/access-key', { headers: { Cookie: cookie } })).json()).accessKey;
  const regen = await post(s, '/api/auth/access-key/regenerate', {}, { ...AJAX, Cookie: cookie });
  assert.equal(regen.status, 200);
  const key3 = (await regen.json()).accessKey;
  assert.notEqual(key3, key2);
  assert.match(key3, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key2 } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key3 } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await post(s, '/api/auth/access-key/regenerate', {}, { ...JSON_HEADERS, 'X-Api-Key': key3 })).status, 403);

  // logout-all: other browsers and the key stop, this cookie is cleared
  const another = await loginCookie(s.base, 'second password 2');
  const all = await post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: cookie });
  assert.equal(all.status, 200);
  assert.equal(setCookies(all)[0].attrs['max-age'], '0');
  for (const c of [cookie, another]) assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: c } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key3 } })).status, 401);

  // remove: wrong 403, right turns the login off
  cookie = await loginCookie(s.base, 'second password 2');
  const badRemove = await post(s, '/api/auth/password/remove', { currentPassword: 'nope nope nope' }, { ...AJAX, Cookie: cookie });
  assert.equal(badRemove.status, 403);
  const removed = await post(s, '/api/auth/password/remove', { currentPassword: 'second password 2' }, { ...AJAX, Cookie: cookie });
  assert.equal(removed.status, 200);
  assert.equal(setCookies(removed)[0].attrs['max-age'], '0');
  assert.deepEqual(s.readAuth(), { version: 1, password: null, sessionSecret: null, accessKey: null });
  assert.equal((await fetch(s.base + '/api/config')).status, 200);
  assert.equal((await (await fetch(s.base + '/api/arrview/identify')).json()).auth, false);
  assert.equal((await post(s, '/api/auth/password/remove', { currentPassword: 'x' })).status, 409);
  assert.equal((await post(s, '/api/auth/logout-all', {})).status, 409);
  assert.equal((await fetch(s.base + '/api/auth/access-key')).status, 409);
  assert.deepEqual(s.tempFiles(), []);
});

test('serial queue: more than 16 waiting hashes get 503 with Retry-After', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => post(s, '/api/auth/password', { newPassword: `race password ${i}` })));
  const codes = results.map(r => r.status);
  assert.equal(codes.filter(c => c === 200).length, 1);
  assert.ok(codes.includes(503));
  assert.ok(codes.includes(409));
  const busy = results.find(r => r.status === 503);
  assert.equal(busy.headers.get('retry-after'), '2');
  assert.equal((await busy.json()).error, 'The server is busy. Try again in a moment.');
});

test('limiter: 10 failures block, buckets are shared, a success returns its slot, clock lifts the block', async (t) => {
  let now = 1_800_000_000_000;
  const root = newRoot(t);
  const seeded = seedAuth(root);
  const s = await startServer(t, { root, clock: () => now, env: { ARRVIEW_TRUSTED_PROXIES: '127.0.0.1' } });
  const wrong = (path = '/api/auth/login', extra = {}) => post(s, path, { password: 'wrong password!', ...extra }, { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.5' });
  const cookie = forgeCookie(seeded.secret, Math.floor(now / 1000) + 86400 * 30);
  // 9 failures across login / token, then a success, then one more failure is still not blocked
  for (let i = 0; i < 9; i++) assert.equal((await wrong(i % 2 ? '/api/auth/token' : '/api/auth/login')).status, 401);
  const good = await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.5' });
  assert.equal(good.status, 200);
  assert.equal((await wrong()).status, 401);
  const blocked = await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.5' });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  const retry = Number(blocked.headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 900);
  assert.equal(body.retryAfterSeconds, retry);
  assert.equal(body.error, 'Too many attempts. Try again later.');
  const t1 = Date.now();
  assert.equal((await post(s, '/api/auth/password/remove', { currentPassword: PASSWORD }, { ...AJAX, Cookie: cookie, 'X-Forwarded-For': '203.0.113.5' })).status, 429);
  assert.ok(Date.now() - t1 < 400);
  // another address is another bucket
  assert.equal((await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.6' })).status, 200);
  assert.equal((await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, 'X-Forwarded-For': '::ffff:203.0.113.5' })).status, 429);
  now += 15 * 60 * 1000 + 1000;
  assert.equal((await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, 'X-Forwarded-For': '203.0.113.5' })).status, 200);
});

test('limiter: 20 parallel guesses give at most 10 non-429 answers', async (t) => {
  const s = await startSeeded(t);
  const results = await Promise.all(Array.from({ length: 20 }, () => post(s, '/api/auth/login', { password: 'wrong password!' })));
  const codes = results.map(r => r.status);
  assert.equal(codes.filter(c => c !== 429).length, 10);
  assert.equal(codes.filter(c => c === 429).length, 10);
});

test('identify has the auth field and the capability last, and nothing else new', async (t) => {
  for (const seed of [false, true]) {
    const s = await startSeeded(t, { seed });
    const identity = await (await fetch(s.base + '/api/arrview/identify')).json();
    assert.equal(identity.auth, seed);
    assert.equal(identity.capabilities[identity.capabilities.length - 1], 'auth');
    assert.deepEqual(Object.keys(identity), ['app', 'version', 'capabilities', 'auth', 'services', 'bonjour']);
  }
});

test('Set-Cookie matrix: only the listed routes ever send a cookie', async (t) => {
  const s = await startSeeded(t);
  const table = routeTable(s.app).filter(e => e.kind === 'route');
  const cookie = await loginCookie(s.base);
  const setters = new Set();
  const record = (label, response) => { if (response.headers.getSetCookie().length) setters.add(label); };
  // anonymous and failing requests never send one (login is rate-limited, so only a few wrong guesses here)
  for (const e of table.filter(e => e.template !== '*')) {
    const hasBody = e.method !== 'GET';
    const r = await fetch(s.base + e.path, { method: e.method, headers: JSON_HEADERS, body: hasBody ? '{}' : undefined });
    if (r.headers.getSetCookie().length) assert.ok(e.path === '/api/auth/logout', `anonymous ${e.method} ${e.path}`);
  }
  // signed in: a protected GET slides only when the cookie is old, never on failures
  const old = forgeCookie(s.seeded.secret, nowSec() + 86400);
  const ok = await fetch(s.base + '/api/config', { headers: { Cookie: old } });
  record('sliding', ok);
  const bad = await fetch(s.base + '/api/sonarr/series/1', { method: 'DELETE', headers: { Cookie: old, 'X-Requested-With': 'ArrView' } });
  assert.ok(bad.status >= 400);
  assert.equal(bad.headers.getSetCookie().length, 0);
  record('login', await post(s, '/api/auth/login', { password: PASSWORD }));
  record('logout', await post(s, '/api/auth/logout', {}));
  assert.equal((await post(s, '/api/auth/token', { password: PASSWORD })).headers.getSetCookie().length, 0);
  assert.equal((await fetch(s.base + '/api/auth/access-key', { headers: { Cookie: cookie } })).headers.getSetCookie().length, 0);
  assert.equal((await fetch(s.base + '/api/auth/status', { headers: { Cookie: cookie } })).headers.getSetCookie().length, 0);
  assert.equal((await post(s, '/api/auth/login', { password: 'wrong password!' })).headers.getSetCookie().length, 0);
  assert.deepEqual([...setters].sort(), ['login', 'logout', 'sliding']);
});
