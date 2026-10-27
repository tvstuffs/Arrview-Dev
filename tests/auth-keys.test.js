// App keys: one per app or script, stored only as digests, with a name, a created date and a last-used date.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { PASSWORD, AJAX, DAY, nowSec, newRoot, seedAuth, startSeeded } = require('./helpers/auth-helpers');

const post = (s, path, body, headers) => fetch(s.base + path, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const list = async (s, cookie) => (await (await fetch(s.base + '/api/auth/keys', { headers: { Cookie: cookie } })).json());
const create = async (s, cookie, body) => (await post(s, '/api/auth/keys', { currentPassword: PASSWORD, ...body }, { ...AJAX, Cookie: cookie })).json();
const status = (s, key) => fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key } }).then(r => r.status);

test('a key takes an optional plain-text name of at most 40 characters, default App key', async (t) => {
  const s = await startSeeded(t, { seedOptions: { keys: [] } });
  const headers = { ...AJAX, Cookie: s.seeded.cookie };
  const names = [[{}, 'App key'], [{ name: '' }, 'App key'], [{ name: '   ' }, 'App key'], [{ name: null }, 'App key'],
    [{ name: '  Sonarr script  ' }, 'Sonarr script'], [{ name: 'x'.repeat(40) }, 'x'.repeat(40)], [{ name: '<b>Phone</b> & co' }, '<b>Phone</b> & co']];
  for (const [body, expected] of names) {
    const r = await post(s, '/api/auth/keys', { ...body, currentPassword: PASSWORD }, headers);
    assert.equal(r.status, 200, JSON.stringify(body));
    const made = await r.json();
    assert.equal(made.name, expected);
    assert.match(made.accessKey, /^[A-Za-z0-9_-]{43}$/);
  }
  for (const name of ['x'.repeat(41), 'bad\nname', 'tab\tname', 5, {}, []]) {
    const r = await post(s, '/api/auth/keys', { name, currentPassword: PASSWORD }, headers);
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.equal((await r.json()).error, 'Name must be 40 characters or fewer, with no control characters');
  }
  // The password route takes the same name.
  const viaToken = await post(s, '/api/auth/token', { password: PASSWORD, name: 'Cron job' }, { 'Content-Type': 'application/json' });
  assert.equal((await viaToken.json()).name, 'Cron job');
  assert.equal((await post(s, '/api/auth/token', { password: PASSWORD, name: 'x'.repeat(41) }, { 'Content-Type': 'application/json' })).status, 400);
  const keys = (await list(s, s.seeded.cookie)).keys;
  assert.equal(keys.length, names.length + 1);
  assert.ok(keys.every(k => Object.keys(k).sort().join() === 'created,id,lastUsed,name'));
});

test('making a key from a browser needs the current password: missing is 400, wrong is 403 and counted, right makes the key', async (t) => {
  const s = await startSeeded(t, { seedOptions: { keys: [] }, env: { ARRVIEW_TRUSTED_PROXIES: '127.0.0.1' } });
  const headers = { ...AJAX, Cookie: s.seeded.cookie, 'X-Forwarded-For': '203.0.113.7' };
  for (const body of [{}, { currentPassword: '' }, { currentPassword: 5 }, { name: 'Phone' }]) {
    const r = await post(s, '/api/auth/keys', body, headers);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await r.json()).error, 'Current password is required');
  }
  assert.deepEqual(s.readAuth().keys, [], 'a valid cookie without a password makes no key');
  // Wrong passwords: 403, no key, and each one counts toward the sign-in limit (ten block the address).
  const t0 = Date.now();
  const wrong = await post(s, '/api/auth/keys', { currentPassword: 'not the password' }, headers);
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error, 'Current password is incorrect');
  assert.ok(Date.now() - t0 >= 450);
  for (let i = 0; i < 9; i++) assert.equal((await post(s, '/api/auth/keys', { currentPassword: 'not the password' }, headers)).status, 403);
  const blocked = await post(s, '/api/auth/keys', { currentPassword: PASSWORD }, headers);
  assert.equal(blocked.status, 429);
  assert.deepEqual(s.readAuth().keys, []);
  // Another address is another bucket: the right password makes the key.
  const made = await post(s, '/api/auth/keys', { name: 'Phone', currentPassword: PASSWORD }, { ...AJAX, Cookie: s.seeded.cookie, 'X-Forwarded-For': '203.0.113.8' });
  assert.equal(made.status, 200);
  assert.equal(await status(s, (await made.json()).accessKey), 200);
  assert.equal(s.readAuth().keys.length, 1);
});

test('remove one key and remove all; a removed key is refused at once and only that key is lost', async (t) => {
  const s = await startSeeded(t, { seedOptions: { keys: ['A', 'B', 'C'] } });
  const headers = { ...AJAX, Cookie: s.seeded.cookie };
  const [a, b, c] = s.seeded.accessKeys;
  for (const key of [a, b, c]) assert.equal(await status(s, key), 200);
  const removed = await post(s, '/api/auth/keys/remove', { id: s.seeded.keyIds[1] }, headers);
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { success: true, removed: 1 });
  assert.deepEqual([await status(s, a), await status(s, b), await status(s, c)], [200, 401, 200]);
  assert.deepEqual((await list(s, s.seeded.cookie)).keys.map(k => k.name), ['A', 'C']);
  assert.deepEqual(s.readAuth().keys.map(k => k.name), ['A', 'C']);
  assert.equal((await post(s, '/api/auth/keys/remove', { id: s.seeded.keyIds[1] }, headers)).status, 404);
  for (const body of [{}, { id: 5 }, { id: 'nope' }]) assert.equal((await post(s, '/api/auth/keys/remove', body, headers)).status, 400);
  const all = await post(s, '/api/auth/keys/remove-all', {}, headers);
  assert.deepEqual(await all.json(), { success: true, removed: 2 });
  assert.deepEqual([await status(s, a), await status(s, c)], [401, 401]);
  assert.deepEqual(s.readAuth().keys, []);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: s.seeded.cookie } })).status, 200, 'sessions stay');
});

test('a key cannot create, list or remove keys; sign out everywhere and a password change remove every key', async (t) => {
  const s = await startSeeded(t, { seedOptions: { sessions: [30 * DAY, 30 * DAY], keys: ['A', 'B'] } });
  const key = s.seeded.accessKey;
  const keyHeaders = { 'Content-Type': 'application/json', 'X-Api-Key': key };
  assert.equal((await fetch(s.base + '/api/auth/keys', { headers: { 'X-Api-Key': key } })).status, 403);
  for (const p of ['/api/auth/keys', '/api/auth/keys/remove', '/api/auth/keys/remove-all']) assert.equal((await post(s, p, { id: s.seeded.keyIds[0] }, keyHeaders)).status, 403, p);
  const [mine] = s.seeded.cookies;
  assert.equal((await post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: mine })).status, 200);
  assert.deepEqual([await status(s, s.seeded.accessKeys[0]), await status(s, s.seeded.accessKeys[1])], [401, 401]);
  assert.deepEqual(s.readAuth().sessions, []);
  assert.deepEqual(s.readAuth().keys, []);

  const t2 = await startSeeded(t, { seedOptions: { sessions: [30 * DAY, 30 * DAY], keys: ['A'] } });
  const [c1, c2] = t2.seeded.cookies;
  const changed = await post(t2, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'a brand new password' }, { ...AJAX, Cookie: c1 });
  assert.equal(changed.status, 200);
  assert.equal((await fetch(t2.base + '/api/config', { headers: { Cookie: c1 } })).status, 401);
  assert.equal((await fetch(t2.base + '/api/config', { headers: { Cookie: c2 } })).status, 401);
  assert.equal(await status(t2, t2.seeded.accessKey), 401);
  assert.equal(t2.readAuth().sessions.length, 1);
  assert.deepEqual(t2.readAuth().keys, []);
});

test('"last used" is written at most once a day', async (t) => {
  let now = Date.now();
  const root = newRoot(t);
  const seeded = seedAuth(root, PASSWORD, { keys: ['A', 'B'] });
  const s = await startServer(t, { root, clock: () => now });
  const lastUsed = i => s.readAuth().keys[i].lastUsed;
  assert.equal(lastUsed(0), null);
  assert.equal(await status(s, seeded.accessKeys[0]), 200);
  await pause(150);
  assert.equal(lastUsed(0), Math.floor(now / 1000));
  assert.equal(lastUsed(1), null, 'an unused key stays unused');
  const bytes = s.readAuthText();
  now += 3600 * 1000;
  for (let i = 0; i < 5; i++) assert.equal(await status(s, seeded.accessKeys[0]), 200);
  await pause(150);
  assert.equal(s.readAuthText(), bytes, 'no write within the day');
  now += DAY * 1000;
  assert.equal(await status(s, seeded.accessKeys[0]), 200);
  await pause(150);
  assert.equal(lastUsed(0), Math.floor(now / 1000));
  assert.ok(lastUsed(0) > nowSec() - 1);
});

test('keys and sessions are compared as digests: a token that is only a digest of a stored one does not work', async (t) => {
  const s = await startSeeded(t);
  const stored = s.readAuth();
  assert.equal(await status(s, stored.keys[0].digest), 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: `arrview_session=${stored.sessions[0].digest}` } })).status, 401);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: `arrview_session=${stored.sessions[0].digest.slice(0, 43)}` } })).status, 401);
  assert.equal(await status(s, s.seeded.accessKey), 200);
});
