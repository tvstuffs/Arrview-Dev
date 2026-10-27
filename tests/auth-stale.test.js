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
const keysOf = async (s, cookie) => (await (await fetch(s.base + '/api/auth/keys', { headers: { Cookie: cookie } })).json()).keys;

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
  // The password it carries is the new one, so the password check passes and the stale session is what refuses it.
  const lateBody = JSON.stringify({ currentPassword: 'changed password 1' });
  const late =new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, path: '/api/auth/keys', method: 'POST',
      headers: { ...AJAX, Cookie: cookie, 'Content-Length': String(lateBody.length) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.flushHeaders();
    setTimeout(() => req.end(lateBody), 600);
  });
  await pause(150);
  const changed = await post(s, '/api/auth/password', { currentPassword: s.seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: cookie });
  assert.equal(changed.status, 200);
  const fresh = cookieHeader(setCookies(changed)[0]);
  const result = await late;
  assert.equal(result.status, 401);
  assert.deepEqual(JSON.parse(result.body), { error: 'Authentication required', auth: true });
  assert.equal(result.body.includes('accessKey'), false);
  assert.deepEqual(s.readAuth().keys, []);
  assert.deepEqual(await keysOf(s, fresh), []);
});

test('queued key creation and logout-all behind a gated password change get 401 with no write', async (t) => {
  const gate = gatedCrypto();
  const s = await startSeeded(t, { wrapCrypto: gate.wrap });
  const cookie = await loginCookie(s.base);
  const hit = gate.arm();
  const change = post(s, '/api/auth/password', { currentPassword: s.seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: cookie });
  await hit;
  const headers = { ...AJAX, Cookie: cookie };
  // It carries the password the change is setting, so the password check passes and the stale session is what refuses it.
  const regen = post(s, '/api/auth/keys', { currentPassword: 'changed password 1' }, headers);
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
  assert.deepEqual(stored.keys, []);
  assert.equal(stored.sessions.length, 1);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: fresh } })).status, 200);
});

// Opens /api/events and reports whether the server ended the stream.
async function openStream(s, headers) {
  const response = await fetch(s.base + '/api/events', headers ? { headers } : undefined);
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
  const expectEnd = async (label, cookie, change, streamHeaders = cookie ? { Cookie: cookie } : undefined) => {
    const stream = await openStream(s, streamHeaders);
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
  const keyOne = await (await post(s, '/api/auth/keys', { currentPassword: 'second password 2' }, { ...AJAX, Cookie: cookie })).json();
  await expectEnd('key removed', cookie, () => post(s, '/api/auth/keys/remove', { id: keyOne.id }, { ...AJAX, Cookie: cookie }), { 'X-Api-Key': keyOne.accessKey });
  const keyTwo = await (await post(s, '/api/auth/keys', { currentPassword: 'second password 2' }, { ...AJAX, Cookie: cookie })).json();
  await expectEnd('all keys removed', cookie, () => post(s, '/api/auth/keys/remove-all', {}, { ...AJAX, Cookie: cookie }), { 'X-Api-Key': keyTwo.accessKey });
  await expectEnd('logout-all', cookie, () => post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: cookie }));
  cookie = await loginCookie(s.base, 'second password 2');
  await expectEnd('remove', cookie, () => post(s, '/api/auth/password/remove', { currentPassword: 'second password 2' }, { ...AJAX, Cookie: cookie }));
});

test('sign out ends only that session\'s event stream; a removed session or key loses access at once', async (t) => {
  const s = await startSeeded(t, { seedOptions: { sessions: [30 * 86400, 30 * 86400], keys: ['One', 'Two'] } });
  const [mine, theirs] = s.seeded.cookies;
  const mineStream = await openStream(s, { Cookie: mine });
  const theirStream = await openStream(s, { Cookie: theirs });
  const keyStream = await openStream(s, { 'X-Api-Key': s.seeded.accessKeys[1] });
  for (const stream of [mineStream, theirStream, keyStream]) t.after(stream.cancel);
  assert.equal((await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: mine })).status, 200);
  assert.equal(await endsWithin(mineStream), true);
  assert.equal(await endsWithin(theirStream, 400), false);
  assert.equal(await endsWithin(keyStream, 100), false);
  const removed = await post(s, '/api/auth/keys/remove', { id: s.seeded.keyIds[1] }, { ...AJAX, Cookie: theirs });
  assert.equal(removed.status, 200);
  assert.equal(await endsWithin(keyStream), true);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': s.seeded.accessKeys[1] } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': s.seeded.accessKeys[0] } })).status, 200);
  assert.equal(await endsWithin(theirStream, 100), false);
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
