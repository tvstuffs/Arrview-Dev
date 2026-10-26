// Revocation is durable for retries and duplicates: a removal made in memory stays pending until a write succeeds, so
// two Sign outs for one cookie share the write, a retry (with the old cookie or none) writes again, and no restart
// brings a removed session or key back after a success. A failed Sign out carries no Set-Cookie.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server-harness');
const { AJAX, DAY, newRoot, seedAuth, setCookies } = require('./helpers/auth-helpers');

const post = (s, p, body, headers) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (s, headers) => fetch(s.base + '/api/config', { headers }).then(r => r.status);
const failRename = state => real => ({ ...real,
  renameSync(from, to) {
    if (state.fail && String(to).endsWith('auth.json')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return real.renameSync(from, to);
  } });

// A password hash that waits until released, to hold the auth queue (only the cost-131072 hash of a new password).
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

// Holds the queue with a password change by `holder` and returns what is needed to release it.
async function holdQueue(s, gate, seeded, holder) {
  const hit = gate.arm();
  const change = post(s, '/api/auth/password', { currentPassword: seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: holder });
  await hit;
  return { change };
}

for (const writeWorks of [false, true]) {
  test(`two Sign outs with one cookie while the queue is held share one write (${writeWorks ? 'it succeeds' : 'it fails'})`, async (t) => {
    const state = { fail: false };
    const gate = gatedCrypto();
    const root = newRoot(t);
    const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY, 30 * DAY], keys: [] });
    const [mine, holder, bystander] = seeded.cookies;
    const s = await startServer(t, { root, wrapCrypto: gate.wrap, fsOverrides: failRename(state) });
    const { change } = await holdQueue(s, gate, seeded, holder);
    const first = post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: mine });
    await pause(100);
    const second = post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: mine });
    const answered = [];
    first.then(r => answered.push(r.status));
    second.then(r => answered.push(r.status));
    await pause(300);
    assert.deepEqual(answered, [], 'a Sign out answered before the deletion was written');
    assert.equal(await status(s, { Cookie: mine }), 401, 'access ends at once, before the write');
    state.fail = !writeWorks;
    gate.release();
    const [a, b, held] = await Promise.all([first, second, change]);
    if (writeWorks) {
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(held.status, 200);
    } else {
      assert.equal(a.status, 500);
      assert.equal(b.status, 500);
      assert.equal(held.status, 500);
      for (const r of [a, b]) assert.equal(setCookies(r).length, 0, 'a failed Sign out must not set a cookie');
      assert.match((await a.json()).error, /try .*again.*Sign out everywhere.*sign in again/i);
    }
    await s.close();

    const again = await startServer(t, { root });
    if (writeWorks) {
      // The password change by the holder replaced every session, so all old cookies are gone.
      assert.equal(await status(again, { Cookie: mine }), 401);
      assert.equal(await status(again, { Cookie: bystander }), 401);
    } else {
      // Nothing was saved, so nothing was promised: the unchanged file still has the session.
      assert.equal(await status(again, { Cookie: mine }), 200);
    }
  });
}

test('two Sign outs with one cookie and no password change in the way: both wait for one durable write', async (t) => {
  const state = { fail: true };
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY], keys: [] });
  const s = await startServer(t, { root, fsOverrides: failRename(state) });
  const headers = { ...AJAX, Cookie: seeded.cookie };
  const [a, b] = await Promise.all([post(s, '/api/auth/logout', {}, headers), post(s, '/api/auth/logout', {}, headers)]);
  assert.equal(a.status, 500);
  assert.equal(b.status, 500);
  assert.equal(setCookies(a).length + setCookies(b).length, 0);
  state.fail = false;
  const [c, d] = await Promise.all([post(s, '/api/auth/logout', {}, headers), post(s, '/api/auth/logout', {}, headers)]);
  assert.equal(c.status, 200);
  assert.equal(d.status, 200);
  assert.equal(s.readAuth().sessions.length, 1);
  await s.close();
  const again = await startServer(t, { root });
  assert.equal(await status(again, { Cookie: seeded.cookie }), 401);
  assert.equal(await status(again, { Cookie: seeded.cookies[1] }), 200);
});

for (const [label, retryHeaders] of [
  ['the old cookie', cookie => ({ ...AJAX, Cookie: cookie })],
  ['no cookie at all', () => ({ ...AJAX })],
]) {
  test(`Sign out fails, storage recovers, a retry with ${label} writes again, and a restart cannot bring the session back`, async (t) => {
    const state = { fail: true };
    const root = newRoot(t);
    const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY], keys: [] });
    const s = await startServer(t, { root, fsOverrides: failRename(state) });
    const failed = await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: seeded.cookie });
    assert.equal(failed.status, 500);
    assert.equal(setCookies(failed).length, 0);
    assert.equal(s.readAuth().sessions.length, 2, 'the file is unchanged after the failure');
    state.fail = false;
    const retry = await post(s, '/api/auth/logout', {}, retryHeaders(seeded.cookie));
    assert.equal(retry.status, 200);
    assert.equal(s.readAuth().sessions.length, 1, 'the retry must write the deletion');
    await s.close();
    const again = await startServer(t, { root });
    assert.equal(await status(again, { Cookie: seeded.cookie }), 401);
    assert.equal(await status(again, { Cookie: seeded.cookies[1] }), 200);
  });
}

test('a later successful auth write also makes the deletion durable, and a Sign out with nothing pending writes nothing', async (t) => {
  const state = { fail: true };
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY], keys: [] });
  const s = await startServer(t, { root, fsOverrides: failRename(state) });
  assert.equal((await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: seeded.cookie })).status, 500);
  state.fail = false;
  // Another session's key creation writes the whole current state, which no longer holds the signed-out session.
  assert.equal((await post(s, '/api/auth/keys', { currentPassword: seeded.password }, { ...AJAX, Cookie: seeded.cookies[1] })).status, 200);
  assert.equal(s.readAuth().sessions.length, 1);
  const before = fs.readFileSync(path.join(root, 'auth.json'), 'utf8');
  const nothing = await post(s, '/api/auth/logout', {}, { ...AJAX });
  assert.equal(nothing.status, 200);
  assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), before);
  await s.close();
  const again = await startServer(t, { root });
  assert.equal(await status(again, { Cookie: seeded.cookie }), 401);
});

for (const [label, retry] of [
  ['a Sign out with no cookie', (s) => post(s, '/api/auth/logout', {}, { ...AJAX })],
  ['a new sign-in', (s, seeded) => post(s, '/api/auth/login', { password: seeded.password }, { ...AJAX })],
]) {
  test(`Sign out everywhere: write fails, every session and key is refused at once, ${label} after recovery makes it durable`, async (t) => {
    const state = { fail: true };
    const root = newRoot(t);
    const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY], keys: ['One', 'Two'] });
    const s = await startServer(t, { root, fsOverrides: failRename(state) });
    const failed = await post(s, '/api/auth/logout-all', {}, { ...AJAX, Cookie: seeded.cookie });
    assert.equal(failed.status, 500);
    assert.equal(setCookies(failed).length, 0, 'a failed Sign out everywhere must not set a cookie');
    const text = (await failed.json()).error;
    assert.doesNotMatch(text, /save the password/i);
    assert.match(text, /signed out everywhere.*could not be saved.*try again/i);
    assert.equal(s.readAuth().sessions.length, 2, 'the file is unchanged after the failure');
    assert.equal(s.readAuth().keys.length, 2);
    for (const cookie of seeded.cookies) assert.equal(await status(s, { Cookie: cookie }), 401, 'every session is refused at once');
    for (const key of seeded.accessKeys) assert.equal(await status(s, { 'X-Api-Key': key }), 401, 'every key is refused at once');
    state.fail = false;
    const done = await retry(s, seeded);
    assert.equal(done.status, 200);
    assert.equal(s.readAuth().keys.length, 0, 'the retry must write the deletion');
    assert.ok(s.readAuth().sessions.length <= 1);
    await s.close();
    const again = await startServer(t, { root });
    for (const cookie of seeded.cookies) assert.equal(await status(again, { Cookie: cookie }), 401);
    for (const key of seeded.accessKeys) assert.equal(await status(again, { 'X-Api-Key': key }), 401);
  });
}

for (const [label, removeOnce, removeRetry] of [
  ['one key', (s, h, seeded) => post(s, '/api/auth/keys/remove', { id: seeded.keyIds[0] }, h), (s, h, seeded) => post(s, '/api/auth/keys/remove', { id: seeded.keyIds[0] }, h)],
  ['all keys', (s, h) => post(s, '/api/auth/keys/remove-all', {}, h), (s, h) => post(s, '/api/auth/keys/remove-all', {}, h)],
]) {
  test(`removing ${label}: write fails, then a retry after storage recovers is durable across a restart`, async (t) => {
    const state = { fail: false };
    const root = newRoot(t);
    const seeded = seedAuth(root, undefined, { sessions: [30 * DAY], keys: ['One', 'Two'] });
    const s = await startServer(t, { root, fsOverrides: failRename(state) });
    const headers = { ...AJAX, Cookie: seeded.cookie };
    state.fail = true;
    const failed = await removeOnce(s, headers, seeded);
    assert.equal(failed.status, 500);
    assert.match((await failed.json()).error, /try again/i);
    assert.equal(s.readAuth().keys.length, 2, 'the file is unchanged after the failure');
    const keyStatus = key => fetch(s.base + '/api/config', { headers: { 'X-Api-Key': key } }).then(r => r.status);
    assert.equal(await keyStatus(seeded.accessKeys[0]), 401, 'access ends at once');
    state.fail = false;
    const retry = await removeRetry(s, headers, seeded);
    assert.equal(retry.status, 200);
    assert.equal(s.readAuth().keys.length, label === 'one key' ? 1 : 0, 'the retry must write the removal');
    await s.close();
    const again = await startServer(t, { root });
    const againStatus = key => fetch(again.base + '/api/config', { headers: { 'X-Api-Key': key } }).then(r => r.status);
    assert.equal(await againStatus(seeded.accessKeys[0]), 401);
    assert.equal(await againStatus(seeded.accessKeys[1]), label === 'one key' ? 200 : 401);
  });
}
