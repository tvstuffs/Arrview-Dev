// Credentials are checked again after the body is read and inside the serial queue, so a request admitted with a cookie
// that a password change or Sign out everywhere has since revoked gets 401 and changes nothing. Also: every credential
// change ends the open event streams.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { startServer } = require('./helpers/server-harness');
const { AJAX, newRoot, setCookies, cookieHeader, loginCookie, startSeeded } = require('./helpers/auth-helpers');

const post = (s, path, body, headers) => fetch(s.base + path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const accessKeyOf = async (s, cookie) => (await (await fetch(s.base + '/api/auth/access-key', { headers: { Cookie: cookie } })).json()).accessKey;

// A password hash that waits until released (only the 131072-cost hash of a new password; test seeds use N=1024).
function gatedCrypto() {
  const gate = { armed: false, release: null, hit: null };
  gate.wrap = real => ({
    ...real,
    scrypt(password, salt, keylen, opts, cb) {
      if (!gate.armed || opts.N !== 131072) return real.scrypt(password, salt, keylen, opts, cb);
      gate.armed = false;
      gate.hit();
      return gate.released.then(() => real.scrypt(password, salt, keylen, opts, cb));
    },
  });
  gate.arm = () => {
    gate.armed = true;
    gate.released = new Promise(resolve => { gate.release = resolve; });
    return new Promise(resolve => { gate.hit = resolve; });
  };
  return gate;
}

test('a request body that arrives after a password change is refused with 401 and changes nothing', async (t) => {
  const s = await startSeeded(t);
  const cookie = await loginCookie(s.base);
  const url = new URL(s.base);
  const late = new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: '/api/auth/access-key/regenerate', method: 'POST',
      headers: { ...AJAX, Cookie: cookie, 'Content-Length': '2' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.flushHeaders();
    setTimeout(() => req.end('{}'), 600);
  });
  await pause(150);
  const changed = await post(s, '/api/auth/password', { currentPassword: s.seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: cookie });
  assert.equal(changed.status, 200);
  const fresh = cookieHeader(setCookies(changed)[0]);
  const keyAfterChange = await accessKeyOf(s, fresh);
  const result = await late;
  assert.equal(result.status, 401);
  assert.deepEqual(JSON.parse(result.body), { error: 'Authentication required', auth: true });
  assert.equal(result.body.includes('accessKey'), false);
  assert.equal(s.readAuth().accessKey, keyAfterChange);
  assert.equal(await accessKeyOf(s, fresh), keyAfterChange);
});

test('queued regenerate and logout-all behind a gated password change get 401 with no write and no rotation', async (t) => {
  const gate = gatedCrypto();
  const s = await startSeeded(t, { wrapCrypto: gate.wrap });
  const cookie = await loginCookie(s.base);
  const hit = gate.arm();
  const change = post(s, '/api/auth/password', { currentPassword: s.seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: cookie });
  await hit;
  const headers = { ...AJAX, Cookie: cookie };
  const regen = post(s, '/api/auth/access-key/regenerate', {}, headers);
  const all = post(s, '/api/auth/logout-all', {}, headers);
  await pause(250);
  gate.release();
  const [changed, regenerated, loggedOut] = await Promise.all([change, regen, all]);
  assert.equal(changed.status, 200);
  const fresh = cookieHeader(setCookies(changed)[0]);
  for (const r of [regenerated, loggedOut]) {
    assert.equal(r.status, 401);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { error: 'Authentication required', auth: true });
    assert.equal(text.includes('accessKey'), false);
    assert.equal(setCookies(r).length, 0);
  }
  const stored = s.readAuth();
  const key = await accessKeyOf(s, fresh);
  assert.equal(stored.accessKey, key);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: fresh } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key } })).status, 200);
});

// Opens /api/events and reports whether the server ended the stream.
async function openStream(s, cookie) {
  const response = await fetch(s.base + '/api/events', cookie ? { headers: { Cookie: cookie } } : undefined);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const ended = (async () => {
    try {
      for (;;) { if ((await reader.read()).done) return true; }
    } catch (_) { return true; }
  })();
  return { ended, cancel: () => reader.cancel().catch(() => {}) };
}
const endsWithin = (stream, ms = 3000) => Promise.race([stream.ended, pause(ms).then(() => false)]);

test('every credential change ends a fresh event stream', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  const expectEnd = async (label, cookie, change) => {
    const stream = await openStream(s, cookie);
    t.after(stream.cancel);
    const r = await change();
    assert.equal(r.status, 200, label);
    assert.equal(await endsWithin(stream), true, `${label}: stream still open`);
    return r;
  };
  const first = await expectEnd('first password', null, () => post(s, '/api/auth/password', { newPassword: 'first password 1' }, { 'Content-Type': 'application/json' }));
  let cookie = cookieHeader(setCookies(first)[0]);
  const changed = await expectEnd('change', cookie, () => post(s, '/api/auth/password', { currentPassword: 'first password 1', newPassword: 'second password 2' }, { ...AJAX, Cookie: cookie }));
  cookie = cookieHeader(setCookies(changed)[0]);
  await expectEnd('regenerate', cookie, () => post(s, '/api/auth/access-key/regenerate', {}, { ...AJAX, Cookie: cookie }));
  await expectEnd('logout-all', cookie, () => post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: cookie }));
  cookie = await loginCookie(s.base, 'second password 2');
  await expectEnd('remove', cookie, () => post(s, '/api/auth/password/remove', { currentPassword: 'second password 2' }, { ...AJAX, Cookie: cookie }));
});

// A request admitted anonymously while the login is off, with its body held back until the login has come on.
function heldRequest(s, method, path, body) {
  const url = new URL(s.base);
  let release;
  const done = new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString() }));
      res.on('close', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.flushHeaders();
    release = () => req.end(body);
  });
  return { done, release: () => release() };
}
const configText = s => (fs.existsSync(s.configFile) ? fs.readFileSync(s.configFile, 'utf8') : null);
const setFirstPassword = (s, password) => post(s, '/api/auth/password', { newPassword: password }, { 'Content-Type': 'application/json' });

for (const [label, prepare] of [
  ['first password', async () => {}],
  ['remove then re-enable', async (s) => {
    const first = await setFirstPassword(s, 'first password 1');
    assert.equal(first.status, 200);
    const cookie = cookieHeader(setCookies(first)[0]);
    const removed = await post(s, '/api/auth/password/remove', { currentPassword: 'first password 1' }, { ...AJAX, Cookie: cookie });
    assert.equal(removed.status, 200);
  }],
]) {
  test(`a config write admitted while the login was off is refused after it comes on (${label})`, async (t) => {
    const s = await startServer(t, { root: newRoot(t) });
    await prepare(s);
    const before = configText(s);
    const held = heldRequest(s, 'POST', '/api/config', JSON.stringify({ sonarr: { url: 'http://upstream.invalid', apiKey: 'x' } }));
    await pause(150);
    assert.equal((await setFirstPassword(s, 'enabled password 1')).status, 200);
    held.release();
    const result = await held.done;
    assert.equal(result.status, 401);
    assert.deepEqual(JSON.parse(result.body), { error: 'Authentication required', auth: true });
    assert.equal(configText(s), before);
  });

  test(`an event stream admitted while the login was off is refused after it comes on (${label})`, async (t) => {
    const s = await startServer(t, { root: newRoot(t) });
    await prepare(s);
    const held = heldRequest(s, 'GET', '/api/events', '{}');
    await pause(150);
    assert.equal((await setFirstPassword(s, 'enabled password 1')).status, 200);
    held.release();
    const result = await Promise.race([held.done, pause(3000).then(() => null)]);
    assert.ok(result, 'the held request never answered');
    assert.equal(result.status, 401);
    assert.equal(result.type.includes('text/event-stream'), false);
    assert.deepEqual(JSON.parse(result.body), { error: 'Authentication required', auth: true });
  });
}
