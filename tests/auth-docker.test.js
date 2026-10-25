const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vectors = require('./fixtures/password-vectors.json');
const { startServer } = require('./helpers/server-harness');
const { PASSWORD, AJAX, JSON_HEADERS, newRoot, seedAuth, setCookies, cookieHeader, loginCookie } = require('./helpers/auth-helpers');

const post = (s, p, body, headers = JSON_HEADERS) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const expand = v => (v && typeof v === 'object' && 'repeat' in v ? v.repeat.repeat(v.times) : v);
const DOCKER = 'docker password 1';
const authLines = s => s.logs.filter(l => l.startsWith('[auth]'));
const tempFile = (t, contents) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-secret-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, contents);
  return file;
};
const signIn = (s, password) => post(s, '/api/auth/login', { password });
async function failsClosed(s, needle) {
  assert.equal((await fetch(s.base + '/api/config')).status, 401);
  assert.equal((await signIn(s, DOCKER)).status, 503);
  assert.ok(authLines(s).some(l => l.includes(needle)), `${needle} in ${JSON.stringify(authLines(s))}`);
}

test('Docker password wins over a Settings record, is read-only, and is never stored in clear', async (t) => {
  const root = newRoot(t);
  seedAuth(root, 'settings password 1');
  const s = await startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER } });
  assert.equal((await signIn(s, 'settings password 1')).status, 401);
  const ok = await signIn(s, DOCKER);
  assert.equal(ok.status, 200);
  const cookie = cookieHeader(setCookies(ok)[0]);
  const status = await (await fetch(s.base + '/api/auth/status', { headers: { Cookie: cookie } })).json();
  assert.equal(status.source, 'docker');
  const headers = { ...AJAX, Cookie: cookie };
  for (const [p, body] of [['/api/auth/password', { currentPassword: DOCKER, newPassword: 'another password' }], ['/api/auth/password/remove', { currentPassword: DOCKER }]]) {
    const r = await post(s, p, body, headers);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "The password is set by the Docker configuration and can't be changed here");
  }
  assert.equal(s.readAuth().password.origin, 'docker');
  assert.ok(!s.readAuthText().includes(DOCKER));
  assert.ok(!s.logs.join('\n').includes(DOCKER));
  assert.equal((await post(s, '/api/auth/logout-all', {}, headers)).status, 200);
  assert.ok(authLines(s).includes('[auth] the Docker password changed; everyone is signed out.'));
});

test('ARRVIEW_PASSWORD: the shared vectors', async (t) => {
  for (const row of vectors.filter(r => r.source === 'docker-env' && typeof expand(r.input) === 'string')) {
    const input = expand(row.input);
    const s = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD: input } });
    if (row.ok) {
      assert.equal((await fetch(s.base + '/api/config')).status, 401);
      assert.equal((await signIn(s, row.normalised ?? input)).status, 200);
    } else {
      await failsClosed(s, row.reason === 'blank' ? 'ARRVIEW_PASSWORD is empty.' : 'ARRVIEW_PASSWORD must be 8 to 256 characters.');
    }
    await s.close();
  }
});

test('ARRVIEW_PASSWORD_FILE: the shared vectors and the file edge cases', async (t) => {
  for (const row of vectors.filter(r => r.source === 'docker-file' && typeof expand(r.input) === 'string')) {
    const input = expand(row.input);
    const s = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD_FILE: tempFile(t, input) } });
    if (row.ok) assert.equal((await signIn(s, row.normalised ?? input)).status, 200, JSON.stringify(input.slice(0, 20)));
    else await failsClosed(s, row.reason === 'blank' ? 'ARRVIEW_PASSWORD_FILE is empty.' : 'ARRVIEW_PASSWORD_FILE must be 8 to 256 characters.');
    await s.close();
  }
  const missing = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD_FILE: '/nonexistent/arrview-secret' } });
  await failsClosed(missing, 'ARRVIEW_PASSWORD_FILE is unreadable.');
  const emptyPath = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD_FILE: '' } });
  await failsClosed(emptyPath, 'ARRVIEW_PASSWORD_FILE is unreadable.');
  const emptyFile = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD_FILE: tempFile(t, '') } });
  await failsClosed(emptyFile, 'ARRVIEW_PASSWORD_FILE is empty.');
  const both = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD: DOCKER, ARRVIEW_PASSWORD_FILE: tempFile(t, DOCKER) } });
  await failsClosed(both, 'ARRVIEW_PASSWORD and ARRVIEW_PASSWORD_FILE are both set; set only one.');
  assert.ok(!both.logs.join('\n').includes(DOCKER));
  const blank = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD: '' } });
  await failsClosed(blank, 'ARRVIEW_PASSWORD is empty.');
});

test('a changed value signs everyone out, an unchanged one does not, removing the variable turns the login off', async (t) => {
  const root = newRoot(t);
  const first = await startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER } });
  assert.ok(authLines(first).includes('[auth] login is ON: password set by the Docker configuration.'));
  assert.ok(!authLines(first).some(l => l.includes('changed')));
  const cookie = await loginCookie(first.base, DOCKER);
  const key = (await (await post(first, '/api/auth/token', { password: DOCKER })).json()).accessKey;
  await first.close();

  const same = await startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER } });
  assert.equal((await fetch(same.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(same.base + '/api/config', { headers: { 'X-Api-Key': key } })).status, 200);
  await same.close();

  const changed = await startServer(t, { root, env: { ARRVIEW_PASSWORD: 'a different docker pass' } });
  assert.ok(authLines(changed).includes('[auth] the Docker password changed; everyone is signed out.'));
  assert.equal((await fetch(changed.base + '/api/config', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await fetch(changed.base + '/api/config', { headers: { 'X-Api-Key': key } })).status, 401);
  assert.equal((await signIn(changed, 'a different docker pass')).status, 200);
  assert.deepEqual([changed.readAuth().sessions.length, changed.readAuth().keys.length], [1, 0]);
  await changed.close();

  // The variable is gone: the Docker password goes with every session and key, the login is off, one line says why.
  const removed = await startServer(t, { root });
  const lines = authLines(removed);
  assert.equal(lines.filter(l => l === '[auth] ARRVIEW_PASSWORD is no longer set, so the Docker password was removed and the login is OFF.').length, 1);
  assert.equal(lines.length, 1);
  assert.equal((await fetch(removed.base + '/api/config')).status, 200);
  const status = await (await fetch(removed.base + '/api/auth/status')).json();
  assert.deepEqual([status.required, status.source], [false, 'none']);
  assert.deepEqual(removed.readAuth(), { version: 2, password: null, sessions: [], keys: [] });
  await removed.close();

  // A password set in Settings is not affected by the missing variable.
  const settingsRoot = newRoot(t);
  const seeded = seedAuth(settingsRoot, 'settings password 1');
  const kept = await startServer(t, { root: settingsRoot });
  assert.equal((await fetch(kept.base + '/api/config')).status, 401);
  assert.equal((await fetch(kept.base + '/api/config', { headers: { Cookie: seeded.cookie } })).status, 200);
  assert.ok(authLines(kept).includes('[auth] login is ON (password set in Settings).'));
});

test('with ARRVIEW_PASSWORD and ARRVIEW_PASSWORD_FILE both unset, a stored docker password is removed; a broken file or a bad variable is left alone', async (t) => {
  const root = newRoot(t);
  seedAuth(root, DOCKER, { origin: 'docker' });
  const s = await startServer(t, { root });
  assert.equal((await fetch(s.base + '/api/config')).status, 200);
  assert.equal(s.readAuth().password, null);
  // Both variables set is an error, not "unset": the login stays on and the file is not touched.
  const both = newRoot(t);
  seedAuth(both, DOCKER, { origin: 'docker' });
  const before = fs.readFileSync(path.join(both, 'auth.json'), 'utf8');
  const closed = await startServer(t, { root: both, env: { ARRVIEW_PASSWORD: DOCKER, ARRVIEW_PASSWORD_FILE: tempFile(t, DOCKER) } });
  assert.equal((await fetch(closed.base + '/api/config')).status, 401);
  assert.equal(fs.readFileSync(path.join(both, 'auth.json'), 'utf8'), before);
});

test('ARRVIEW_AUTH=off wins, an unrecognised value is ignored without being printed', async (t) => {
  const root = newRoot(t);
  fs.writeFileSync(path.join(root, 'auth.json'), '{broken');
  const s = await startServer(t, { root, env: { ARRVIEW_AUTH: ' OFF ', ARRVIEW_PASSWORD: DOCKER } });
  assert.equal((await fetch(s.base + '/api/config')).status, 200);
  assert.ok(authLines(s).includes('[auth] login is OFF: ARRVIEW_AUTH=off is set (any password is ignored).'));
  const status = await (await fetch(s.base + '/api/auth/status')).json();
  assert.deepEqual([status.required, status.source, status.authDisabledByDocker], [false, 'none', true]);
  for (const [p, body] of [['/api/auth/password', { newPassword: 'whatever password' }], ['/api/auth/password/remove', { currentPassword: 'x' }], ['/api/auth/logout-all', {}]]) {
    const r = await post(s, p, body);
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "The login is turned off by the Docker configuration (ARRVIEW_AUTH=off) and can't be changed here");
  }
  assert.equal((await fetch(s.base + '/api/auth/keys')).status, 409);
  assert.equal((await post(s, '/api/auth/keys', {})).status, 409);
  assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), '{broken');
  assert.equal(fs.readdirSync(root).includes('.auth.json'), false);

  const odd = await startServer(t, { root: newRoot(t), env: { ARRVIEW_AUTH: 'sekret-value-1' } });
  assert.ok(authLines(odd).includes('[auth] ARRVIEW_AUTH has an unrecognised value and is ignored.'));
  assert.ok(!odd.logs.join('\n').includes('sekret-value-1'));
  assert.equal((await fetch(odd.base + '/api/config')).status, 200);
});

test('a valid Docker password heals a corrupt auth.json', async (t) => {
  const root = newRoot(t);
  fs.writeFileSync(path.join(root, 'auth.json'), '[]');
  const s = await startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER } });
  assert.equal((await signIn(s, DOCKER)).status, 200);
  assert.equal(s.readAuth().version, 2);
  assert.ok(authLines(s).includes('[auth] the Docker password changed; everyone is signed out.'));
});

test('start-up is asynchronous: nothing listens before the Docker reconciliation, and no scryptSync is used', async (t) => {
  const root = newRoot(t);
  seedAuth(root, 'settings password 1');
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const handle = {};
  const wrapCrypto = real => ({ ...real,
    scryptSync() { throw new Error('scryptSync must not be called'); },
    scrypt(pw, salt, keylen, opts, cb) { calls.push(opts); gate.then(() => real.scrypt(pw, salt, keylen, opts, cb)); } });
  const started = startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER }, wrapCrypto, handle });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(handle.listenCalls(), 0);
  assert.ok(!handle.logs.some(l => l.startsWith('[auth] login is ON')));
  release();
  const s = await started;
  assert.equal(s.listenCalls(), 1);
  assert.ok(authLines(s).includes('[auth] login is ON: password set by the Docker configuration.'));
  assert.equal((await signIn(s, 'settings password 1')).status, 401);
  assert.equal((await signIn(s, DOCKER)).status, 200);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(o => o.maxmem === 268435456));
});

test('a stored docker record is verified with its stored parameters; a record that fails validation is replaced', async (t) => {
  const root = newRoot(t);
  const seeded = seedAuth(root, DOCKER, { origin: 'docker', N: 2048 });
  const calls = [];
  const wrapCrypto = real => ({ ...real, scrypt(pw, salt, keylen, opts, cb) { calls.push({ N: opts.N, r: opts.r, p: opts.p, maxmem: opts.maxmem, keylen }); return real.scrypt(pw, salt, keylen, opts, cb); } });
  const s = await startServer(t, { root, env: { ARRVIEW_PASSWORD: DOCKER }, wrapCrypto });
  assert.deepEqual(calls, [{ N: 2048, r: 8, p: 1, maxmem: 268435456, keylen: 64 }]);
  assert.ok(!authLines(s).some(l => l.includes('changed')));
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': seeded.accessKey } })).status, 200);
  await s.close();

  const bad = newRoot(t);
  const record = JSON.parse(JSON.stringify(seedAuth(bad, DOCKER, { origin: 'docker' }).record));
  const file = JSON.parse(fs.readFileSync(path.join(bad, 'auth.json'), 'utf8'));
  file.password.N = 1000;
  fs.writeFileSync(path.join(bad, 'auth.json'), JSON.stringify(file));
  const calls2 = [];
  const t2 = await startServer(t, { root: bad, env: { ARRVIEW_PASSWORD: DOCKER },
    wrapCrypto: real => ({ ...real, scrypt(pw, salt, keylen, opts, cb) { calls2.push(opts.N); return real.scrypt(pw, salt, keylen, opts, cb); } }) });
  assert.deepEqual(calls2, [131072]);
  assert.ok(authLines(t2).includes('[auth] the Docker password changed; everyone is signed out.'));
  assert.equal(record.origin, 'docker');
});

test('no Docker password: no scrypt at start and listen still comes after start-up; a failing scrypt fails closed', async (t) => {
  const calls = [];
  const wrapCrypto = real => ({ ...real, scrypt(...args) { calls.push(1); return real.scrypt(...args); } });
  const open = await startServer(t, { root: newRoot(t), wrapCrypto });
  assert.equal(calls.length, 0);
  assert.equal(open.listenCalls(), 1);
  assert.ok(open.logs.includes('[auth] login is OFF (no password set).'));

  const failing = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD: DOCKER },
    wrapCrypto: real => ({ ...real, scrypt(pw, salt, keylen, opts, cb) { cb(new Error('boom')); } }) });
  assert.equal(failing.listenCalls(), 1);
  assert.ok(failing.logs.some(l => l.startsWith('[auth] start-up failed (') && l.endsWith('the login stays ON and no one can sign in.')));
  assert.equal((await fetch(failing.base + '/api/config')).status, 401);
  assert.equal((await signIn(failing, DOCKER)).status, 503);
});

const secureCookie = async (s, headers) => {
  const r = await post(s, '/api/auth/login', { password: PASSWORD }, { ...JSON_HEADERS, ...headers });
  assert.equal(r.status, 200);
  return 'secure' in setCookies(r)[0].attrs;
};
async function proxied(t, list) {
  const root = newRoot(t);
  seedAuth(root);
  return startServer(t, { root, env: list === undefined ? {} : { ARRVIEW_TRUSTED_PROXIES: list } });
}

test('trusted proxies: default trusts nothing; listed peers are believed', async (t) => {
  const none = await proxied(t);
  assert.equal(await secureCookie(none, { 'X-Forwarded-Proto': 'https' }), false);
  for (const list of ['127.0.0.1', '127.0.0.0/8', '::ffff:127.0.0.1', '192.0.2.1, 127.0.0.1,', '2001:db8::/32', '::/96']) {
    if (list === '2001:db8::/32' || list === '::/96') {
      // Accepted (not rejected as covering the IPv4-mapped block); the IPv4 loopback peer is not in these ranges.
      const s = await proxied(t, list);
      assert.ok(authLines(s).some(l => /^\[auth\] trusting X-Forwarded-For/.test(l)), list);
      assert.equal(await secureCookie(s, { 'X-Forwarded-Proto': 'https' }), false, list);
      await s.close();
      continue;
    }
    const s = await proxied(t, list);
    assert.equal(await secureCookie(s, { 'X-Forwarded-Proto': 'https' }), true, list);
    assert.equal(await secureCookie(s, { 'X-Forwarded-Proto': 'http' }), false, list);
    assert.ok(authLines(s).some(l => /^\[auth\] trusting X-Forwarded-For and X-Forwarded-Proto from \d+ proxy entries\.$/.test(l)));
    await s.close();
  }
  const other = await proxied(t, '192.0.2.1');
  assert.equal(await secureCookie(other, { 'X-Forwarded-Proto': 'https' }), false);
});

test('trusted proxies: any invalid entry trusts nothing', async (t) => {
  for (const bad of ['banana', '192.0.2.0/33', '0.0.0.0/0', '::/0', '127.0.0.1, banana',
    '::ffff:192.0.2.1/96', '::FFFF:192.0.2.1/96', '0:0:0:0:0:ffff:192.0.2.1/96', '::ffff:c000:201/96', '::ffff:192.0.2.1/64',
    '::/80', '::/64', '::/1', '0::/8', '0:0:0:0:0:fff0::/76', '0000:0000:0000:0000:0000:0000::/080',
    // IPv4-compatible dotted-tail entries: refused with the log line (they used to stop start-up), bare, CIDR and in a list.
    '::192.0.2.1', '::192.0.2.1/96', '0:0:0:0:0:0:192.0.2.1', '127.0.0.1, ::192.0.2.1', '::192.0.2.1, 127.0.0.1', '192.0.2.1, ::192.0.2.1/96, 127.0.0.1']) {
    const s = await proxied(t, bad);
    assert.equal(await secureCookie(s, { 'X-Forwarded-Proto': 'https' }), false, bad);
    assert.ok(authLines(s).some(l => l.startsWith('[auth] ARRVIEW_TRUSTED_PROXIES has an invalid entry "') && l.endsWith('no proxy is trusted.')), bad);
    await s.close();
  }
});

test('trusted proxies: an entry Express cannot compile still starts the server, trusts nothing, and logs only the final state', async (t) => {
  for (const list of ['64:ff9b::192.0.2.1/96', '127.0.0.1, 64:ff9b::192.0.2.1/96']) {
    const s = await proxied(t, list);
    assert.equal(await secureCookie(s, { 'X-Forwarded-Proto': 'https' }), false, list);
    const lines = authLines(s);
    assert.ok(lines.includes('[auth] ARRVIEW_TRUSTED_PROXIES could not be used; no proxy is trusted.'), list);
    assert.equal(lines.some(l => /trusting X-Forwarded/.test(l)), false, list);
    await s.close();
  }
});

test('X-Forwarded-For is the limiter key only from a trusted peer', async (t) => {
  const guess = (s, ip) => post(s, '/api/auth/login', { password: 'wrong password!' }, { ...JSON_HEADERS, 'X-Forwarded-For': ip });
  const untrusted = await proxied(t);
  const codes = await Promise.all(Array.from({ length: 12 }, (_, i) => guess(untrusted, `203.0.113.${i + 1}`))).then(rs => rs.map(r => r.status));
  assert.equal(codes.filter(c => c === 429).length, 2);
  const trusted = await proxied(t, '127.0.0.1');
  const codes2 = await Promise.all(Array.from({ length: 12 }, (_, i) => guess(trusted, `203.0.113.${i + 1}`))).then(rs => rs.map(r => r.status));
  assert.equal(codes2.filter(c => c === 429).length, 0);
});
