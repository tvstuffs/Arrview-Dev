// The emergency controls (Sign out everywhere, Remove key, Remove all keys) work while the password-check queue is full:
// they revoke in memory at once and share the one reserved write, so a flood of password checks cannot block them.
// Ordinary password checks still get 503, and an unauthenticated call is still refused before any of this.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { AJAX, DAY, newRoot, seedAuth, setCookies } = require('./helpers/auth-helpers');

const post = (s, p, body, headers) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (s, headers) => fetch(s.base + '/api/config', { headers }).then(r => r.status);

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

// Opens /api/events and reports whether the server ended the stream.
async function openStream(s, headers) {
  const response = await fetch(s.base + '/api/events', { headers });
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

// Holds a password change from `holder` inside its hash, then queues 20 password checks from distinct addresses.
async function fillQueue(s, gate, seeded, holder, filler) {
  const hit = gate.arm();
  const change = post(s, '/api/auth/password', { currentPassword: seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: holder });
  await hit;
  const fill = Array.from({ length: 20 }, (_, i) => post(s, '/api/auth/keys', { currentPassword: seeded.password }, { ...AJAX, Cookie: filler, 'X-Forwarded-For': `203.0.113.${i + 10}` }));
  await pause(300);
  return { change, fill };
}

test('with the queue full, Remove key, Remove all keys and Sign out everywhere succeed; a sign-in still gets 503', async (t) => {
  const gate = gatedCrypto();
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY, 30 * DAY, 30 * DAY], keys: ['One', 'Two', 'Three'] });
  const [keyRemover, allKeysRemover, everywhere, holder] = seeded.cookies;
  const [keyOne, keyTwo, keyThree] = seeded.accessKeys;
  const s = await startServer(t, { root, wrapCrypto: gate.wrap, env: { ARRVIEW_TRUSTED_PROXIES: '127.0.0.1' } });
  const { change, fill } = await fillQueue(s, gate, seeded, holder, keyRemover);

  // An ordinary password check is still refused for a full queue.
  const login = await post(s, '/api/auth/login', { password: seeded.password }, { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.7' });
  assert.equal(login.status, 503);
  assert.equal(login.headers.get('retry-after'), '2');
  assert.deepEqual(await login.json(), { error: 'The server is busy. Try again in a moment.' });

  const oneStream = await openStream(s, { 'X-Api-Key': keyOne });
  const twoStream = await openStream(s, { 'X-Api-Key': keyTwo });
  const sessionStream = await openStream(s, { Cookie: holder });
  for (const stream of [oneStream, twoStream, sessionStream]) t.after(stream.cancel);

  const removeOne = post(s, '/api/auth/keys/remove', { id: seeded.keyIds[0] }, { ...AJAX, Cookie: keyRemover });
  await pause(200);
  assert.equal(await status(s, { 'X-Api-Key': keyOne }), 401, 'the removed key is refused before the queue drains');
  assert.equal(await endsWithin(oneStream), true, 'the removed key\'s event stream ends at once');
  assert.equal(await status(s, { 'X-Api-Key': keyTwo }), 200);

  const removeAll = post(s, '/api/auth/keys/remove-all', {}, { ...AJAX, Cookie: allKeysRemover });
  await pause(200);
  assert.equal(await status(s, { 'X-Api-Key': keyTwo }), 401);
  assert.equal(await status(s, { 'X-Api-Key': keyThree }), 401);
  assert.equal(await endsWithin(twoStream), true);
  assert.equal(await status(s, { Cookie: holder }), 200, 'removing keys leaves sessions alone');

  const all = post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: everywhere });
  await pause(200);
  for (const cookie of seeded.cookies) assert.equal(await status(s, { Cookie: cookie }), 401, 'every session is refused at once');
  assert.equal(await endsWithin(sessionStream), true);

  gate.release();
  const [changed, removedOne, removedAll, loggedOut, ...filled] = await Promise.all([change, removeOne, removeAll, all, ...fill]);
  assert.equal(removedOne.status, 200);
  assert.deepEqual(await removedOne.json(), { success: true, removed: 1 });
  assert.equal(removedAll.status, 200);
  assert.deepEqual(await removedAll.json(), { success: true, removed: 2 });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(await loggedOut.json(), { success: true });
  assert.equal(changed.status, 401, 'the held change finds its session gone');
  assert.equal(setCookies(changed).length, 0);
  assert.ok(filled.some(r => r.status === 503), 'the queue was never full');
  assert.ok(filled.every(r => r.status === 503 || r.status === 401));
  const stored = s.readAuth();
  assert.equal(stored.password.hash, seeded.record.hash);
  assert.deepEqual(stored.sessions, []);
  assert.deepEqual(stored.keys, []);
  await s.close();

  const again = await startServer(t, { root });
  for (const cookie of seeded.cookies) assert.equal(await status(again, { Cookie: cookie }), 401);
  for (const key of seeded.accessKeys) assert.equal(await status(again, { 'X-Api-Key': key }), 401);
});

test('with the queue full, the three routes without credentials answer 401 and revoke nothing', async (t) => {
  const gate = gatedCrypto();
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY], keys: ['One'] });
  const [filler, holder] = seeded.cookies;
  const s = await startServer(t, { root, wrapCrypto: gate.wrap, env: { ARRVIEW_TRUSTED_PROXIES: '127.0.0.1' } });
  const { change, fill } = await fillQueue(s, gate, seeded, holder, filler);
  for (const [p, body] of [['/api/auth/logout-all', {}], ['/api/auth/keys/remove', { id: seeded.keyIds[0] }], ['/api/auth/keys/remove-all', {}]]) {
    const r = await post(s, p, body, { ...AJAX });
    assert.equal(r.status, 401, p);
    assert.deepEqual(await r.json(), { error: 'Authentication required', auth: true }, p);
  }
  assert.equal(await status(s, { Cookie: filler }), 200);
  assert.equal(await status(s, { 'X-Api-Key': seeded.accessKey }), 200);
  gate.release();
  const [changed] = await Promise.all([change, ...fill]);
  assert.equal(changed.status, 200);
});

test('the three routes with an app key get 403, and with the login off or ARRVIEW_AUTH=off get 409', async (t) => {
  const routes = [['/api/auth/logout-all', {}], ['/api/auth/keys/remove', { id: '0123456789abcdef' }], ['/api/auth/keys/remove-all', {}]];
  const root = newRoot(t);
  const seeded = seedAuth(root);
  const s = await startServer(t, { root });
  for (const [p, body] of routes) {
    const r = await post(s, p, body, { ...AJAX, 'X-Api-Key': seeded.accessKey });
    assert.equal(r.status, 403, p);
    assert.deepEqual(await r.json(), { error: 'Sign in with a browser to do this' }, p);
  }
  assert.equal(await status(s, { 'X-Api-Key': seeded.accessKey }), 200, 'nothing was revoked');
  const open = await startServer(t, { root: newRoot(t) });
  for (const [p, body] of routes) assert.equal((await post(open, p, body, { ...AJAX })).status, 409, p);
  const disabled = await startServer(t, { root: newRoot(t), env: { ARRVIEW_AUTH: 'off' } });
  for (const [p, body] of routes) assert.equal((await post(disabled, p, body, { ...AJAX })).status, 409, p);
});
