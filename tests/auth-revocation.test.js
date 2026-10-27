// Revocation is durable and final: Sign out is not reported until its deletion is on disk (and a full queue cannot drop
// it), a credential that goes away while a password is being hashed gets nothing from the finished request, an expired
// session receives no event, and a Docker-password removal that could not be written does not claim success.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server-harness');
const { AJAX, DAY, newRoot, seedAuth, setCookies, startSeeded } = require('./helpers/auth-helpers');

const post = (s, p, body, headers) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = (s, headers) => fetch(s.base + '/api/config', { headers }).then(r => r.status);
const failRename = (state) => real => ({ ...real,
  renameSync(from, to) {
    if (state.fail && String(to).endsWith('auth.json')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return real.renameSync(from, to);
  } });

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

test('Sign out with a saturated queue is written anyway, answers only after the write, and survives a restart', async (t) => {
  const gate = gatedCrypto();
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY, 30 * DAY], keys: ['Kept'] });
  const [mine, holder, bystander] = seeded.cookies;
  const s = await startServer(t, { root, wrapCrypto: gate.wrap, env: { ARRVIEW_TRUSTED_PROXIES: '127.0.0.1' } });
  // The queue head is a password change that waits inside its hash.
  const hit = gate.arm();
  const change = post(s, '/api/auth/password', { currentPassword: seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: holder });
  await hit;
  // Sixteen more wait behind it, so the next optional write would be refused as busy (each from its own address, so the sign-in limiter does not cut them off).
  const fill = Array.from({ length: 20 }, (_, i) => post(s, '/api/auth/keys', { currentPassword: seeded.password }, { ...AJAX, Cookie: mine, 'X-Forwarded-For': `203.0.113.${i + 10}` }));
  await pause(300);
  const logout = post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: mine });
  const logoutHolder = post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: holder });
  let answered = false;
  logout.then(() => { answered = true; });
  await pause(300);
  assert.equal(answered, false, 'Sign out answered before its deletion was written');
  assert.equal(await status(s, { Cookie: mine }), 401, 'access ends at once, before the write');
  gate.release();
  const results = await Promise.all([change, logout, logoutHolder, ...fill]);
  const [changed, out, outHolder, ...filled] = results;
  assert.equal(out.status, 200);
  assert.equal(outHolder.status, 200);
  assert.equal(changed.status, 401);
  assert.equal(setCookies(changed).length, 0);
  assert.ok(filled.some(r => r.status === 503), 'the queue was never full');
  assert.ok(filled.every(r => r.status === 503 || r.status === 401));
  const stored = s.readAuth();
  assert.equal(stored.password.hash, seeded.record.hash, 'the password must not change');
  assert.equal(stored.sessions.length, 1);
  assert.equal(stored.keys.length, 1);
  await s.close();

  const again = await startServer(t, { root });
  assert.equal(await status(again, { Cookie: mine }), 401);
  assert.equal(await status(again, { Cookie: holder }), 401);
  assert.equal(await status(again, { Cookie: bystander }), 200);
});

test('Sign out whose write fails answers 500 with the reason logged; access is still gone in memory', async (t) => {
  const state = { fail: false };
  const root = newRoot(t);
  const seeded = seedAuth(root, undefined, { sessions: [30 * DAY, 30 * DAY] });
  const s = await startServer(t, { root, fsOverrides: failRename(state) });
  const before = fs.readFileSync(path.join(root, 'auth.json'), 'utf8');
  state.fail = true;
  const r = await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: seeded.cookie });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /could not be saved/);
  assert.ok(s.logs.includes('[auth] could not write auth.json (ENOSPC).'));
  assert.equal(await status(s, { Cookie: seeded.cookie }), 401);
  assert.equal(await status(s, { Cookie: seeded.cookies[1] }), 200);
  assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), before);
  assert.deepEqual(s.tempFiles(), []);
});

test('a Docker password removal that cannot be written fails closed and does not log a removal', async (t) => {
  const state = { fail: true };
  const root = newRoot(t);
  const seeded = seedAuth(root, 'docker password 1', { origin: 'docker' });
  const before = fs.readFileSync(path.join(root, 'auth.json'), 'utf8');
  const s = await startServer(t, { root, fsOverrides: failRename(state) });
  assert.equal(await status(s), 401);
  assert.equal(await status(s, { Cookie: seeded.cookie }), 401);
  assert.equal((await post(s, '/api/auth/login', { password: 'docker password 1' }, { 'Content-Type': 'application/json' })).status, 503);
  const lines = s.logs.filter(l => l.startsWith('[auth]'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[auth\] ARRVIEW_PASSWORD is no longer set, but auth\.json could not be updated \(ENOSPC\); the login stays ON and no one can sign in\./);
  assert.ok(!lines[0].includes('was removed'));
  assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), before);
  assert.deepEqual(s.tempFiles(), []);
});

for (const [label, ends] of [
  ['signs out', async (s, cookie, setNow) => assert.equal((await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: cookie })).status, 200)],
  ['expires', async (s, cookie, setNow) => setNow(200)],
]) {
  test(`a session that ${label} while a new password is being hashed gets 401, no cookie and no change`, async (t) => {
    let now = Date.now();
    const gate = gatedCrypto();
    const root = newRoot(t);
    const seeded = seedAuth(root, undefined, { sessions: [100] });
    const s = await startServer(t, { root, wrapCrypto: gate.wrap, clock: () => now });
    const hit = gate.arm();
    const change = post(s, '/api/auth/password', { currentPassword: seeded.password, newPassword: 'changed password 1' }, { ...AJAX, Cookie: seeded.cookie });
    await hit;
    const finished = ends(s, seeded.cookie, secs => { now += secs * 1000; });
    await pause(100);
    gate.release();
    const [r] = await Promise.all([change, finished]);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'Authentication required', auth: true });
    assert.equal(setCookies(r).length, 0);
    assert.equal(s.readAuth().password.hash, seeded.record.hash);
    assert.equal(await status(s, { Cookie: seeded.cookie }), 401);
  });
}

test('the same holds for removing the password and for a key creation after a signed-out session', async (t) => {
  const s = await startSeeded(t, { seedOptions: { sessions: [30 * DAY, 30 * DAY] } });
  const [a, b] = s.seeded.cookies;
  assert.equal((await post(s, '/api/auth/logout', {}, { ...AJAX, Cookie: a })).status, 200);
  assert.equal((await post(s, '/api/auth/keys', { currentPassword: s.seeded.password }, { ...AJAX, Cookie: a })).status, 401);
  assert.equal((await post(s, '/api/auth/password/remove', { currentPassword: s.seeded.password }, { ...AJAX, Cookie: a })).status, 401);
  assert.notEqual(s.readAuth().password, null);
  assert.equal(await status(s, { Cookie: b }), 200);
});

// Reads an event stream into text.
async function openStream(s, headers) {
  const response = await fetch(s.base + '/api/events', { headers });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seen = { text: '', ended: false };
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen.text += decoder.decode(value);
      }
    } catch (_) { /* reset */ }
    seen.ended = true;
  })();
  return { seen, cancel: () => reader.cancel().catch(() => {}) };
}

test('an expired session gets no event after expiry, even before the next ping; a live one still does', async (t) => {
  let now = Date.now();
  const root = newRoot(t);
  // Both have more than 29 days left, so opening a stream does not slide their expiry.
  const seeded = seedAuth(root, undefined, { sessions: [29.5 * DAY, 30 * DAY], keys: [] });
  const s = await startServer(t, { root, clock: () => now });
  const [shortLived, longLived] = seeded.cookies;
  const dying = await openStream(s, { Cookie: shortLived });
  const living = await openStream(s, { Cookie: longLived });
  t.after(dying.cancel);
  t.after(living.cancel);
  await pause(100);
  now += 29.7 * DAY * 1000; // the first session is now past its expiry; no ping has run
  const hook = await post(s, '/api/webhooks/sonarr', { eventType: 'Grab', series: { id: 1, title: 'Show' }, episodes: [] }, { 'Content-Type': 'application/json' });
  assert.equal(hook.status, 200);
  await pause(300);
  assert.match(living.seen.text, /event: sonarr/);
  assert.doesNotMatch(dying.seen.text, /event: sonarr/);
  assert.equal(dying.seen.ended, true);
  assert.equal(living.seen.ended, false);
});

test('key names reject every Unicode control character, C1 included', async (t) => {
  const s = await startSeeded(t, { seedOptions: { keys: [] } });
  const headers = { ...AJAX, Cookie: s.seeded.cookie };
  for (const bad of ['a\u0085b', 'a\u0080b', 'a\u009fb', 'a\u007fb', 'a\u0000b', 'a\nb', 'a\tb']) {
    const r = await post(s, '/api/auth/keys', { name: bad, currentPassword: s.seeded.password }, headers);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await post(s, '/api/auth/keys', { name: 'Café ¡', currentPassword: s.seeded.password }, headers)).status, 200);
  assert.equal((await post(s, '/api/auth/token', { password: s.seeded.password, name: 'a\u0085b' }, AJAX)).status, 400);
});
