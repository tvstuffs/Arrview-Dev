const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server-harness');
const { PASSWORD, AJAX, JSON_HEADERS, newRoot, seedAuth, loginCookie, startSeeded } = require('./helpers/auth-helpers');

const post = (s, p, body, headers = JSON_HEADERS) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const CLOSED_LINE = /^\[auth\] auth\.json could not be read \((.+)\); the login stays ON and no one can sign in\. To recover, follow the Recovery procedures in the README \(replace the password with a Docker one, or remove auth\.json and set a new password in Settings\)\.$/;

test('auth.json is created 0600 in the documented shape and leaves no temp file', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  assert.equal((await post(s, '/api/auth/password', { newPassword: 'storage password 1' })).status, 200);
  const stored = s.readAuth();
  assert.deepEqual(Object.keys(stored), ['version', 'password', 'sessionSecret', 'accessKey']);
  assert.equal(stored.version, 1);
  assert.deepEqual(Object.keys(stored.password), ['origin', 'algorithm', 'N', 'r', 'p', 'keylen', 'salt', 'hash']);
  assert.equal(stored.password.keylen, 64);
  assert.equal(Buffer.from(stored.sessionSecret, 'base64').length, 32);
  assert.match(stored.accessKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fs.statSync(s.authFile).mode & 0o777, 0o600);
  assert.deepEqual(s.tempFiles(), []);
  assert.equal(s.readAuthText(), JSON.stringify(stored, null, 2));
});

test('a failed write answers 500, keeps the old file and password, and leaves no temp file', async (t) => {
  const root = newRoot(t);
  const seeded = seedAuth(root);
  const before = fs.readFileSync(path.join(root, 'auth.json'), 'utf8');
  let fail = false;
  const s = await startServer(t, { root, fsOverrides: real => ({ ...real,
    renameSync(from, to) { if (fail && String(to).endsWith('auth.json')) throw new Error('disk full'); return real.renameSync(from, to); } }) });
  const cookie = await loginCookie(s.base);
  fail = true;
  const r = await post(s, '/api/auth/password', { currentPassword: PASSWORD, newPassword: 'brand new password' }, { ...AJAX, Cookie: cookie });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Could not save the password' });
  assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), before);
  assert.deepEqual(s.tempFiles(), []);
  fail = false;
  assert.equal((await post(s, '/api/auth/login', { password: PASSWORD })).status, 200);
  assert.equal((await fetch(s.base + '/api/config', { headers: { 'X-Api-Key': seeded.accessKey } })).status, 200);
});

test('a stale temp file is ignored and config routes never touch auth', async (t) => {
  const root = newRoot(t);
  const seeded = seedAuth(root);
  fs.writeFileSync(path.join(root, '.auth.json.0123456789abcdef.tmp'), 'junk');
  const config = { sonarr: { url: 'http://192.0.2.10:8989', apikey: 'abcdefghijkl' } };
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  const s = await startServer(t, { root });
  const bytes = fs.readFileSync(s.authFile, 'utf8');
  const key = { 'X-Api-Key': seeded.accessKey };
  const got = await (await fetch(s.base + '/api/config', { headers: key })).json();
  const text = JSON.stringify(got);
  assert.equal('auth' in got, false);
  for (const secret of [seeded.accessKey, seeded.record.hash, seeded.record.salt, seeded.secret.toString('base64')]) assert.equal(text.includes(secret), false);
  const saved = await post(s, '/api/config', got, { ...JSON_HEADERS, ...key });
  assert.equal(saved.status, 200);
  assert.equal(fs.readFileSync(s.authFile, 'utf8'), bytes);
  assert.ok(!/sessionSecret|accessKey|scrypt/.test(fs.readFileSync(s.configFile, 'utf8')));
  const withAuth = await post(s, '/api/config', { auth: {} }, { ...JSON_HEADERS, ...key });
  assert.equal(withAuth.status, 400);
  assert.equal((await withAuth.json()).error, 'Unknown config key: auth');
});

test('restart keeps sessions and the key', async (t) => {
  const root = newRoot(t);
  seedAuth(root);
  const first = await startServer(t, { root });
  const cookie = await loginCookie(first.base);
  const key = (await (await fetch(first.base + '/api/auth/access-key', { headers: { Cookie: cookie } })).json()).accessKey;
  await first.close();
  const second = await startServer(t, { root });
  assert.equal((await fetch(second.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(second.base + '/api/config', { headers: { 'X-Api-Key': key } })).status, 200);
});

test('corrupt files fail closed with the log line and no secret; ARRVIEW_AUTH=off leaves them alone', async (t) => {
  const good = (() => { const r = newRoot(t); seedAuth(r); return JSON.parse(fs.readFileSync(path.join(r, 'auth.json'), 'utf8')); })();
  const variants = {
    'invalid JSON': '{nope',
    array: '[]',
    'version 2': JSON.stringify({ ...good, version: 2 }),
    'bad parameter': JSON.stringify({ ...good, password: { ...good.password, N: 1000 } }),
    'huge cost': JSON.stringify({ ...good, password: { ...good.password, N: 262144, r: 16 } }),
    'missing secret': JSON.stringify({ ...good, sessionSecret: null }),
    'short hash': JSON.stringify({ ...good, password: { ...good.password, hash: 'AAAA' } }),
    'bad key': JSON.stringify({ ...good, accessKey: 'short' }),
  };
  for (const [name, text] of Object.entries(variants)) {
    const root = newRoot(t);
    fs.writeFileSync(path.join(root, 'auth.json'), text);
    const s = await startServer(t, { root });
    assert.equal((await fetch(s.base + '/api/config')).status, 401, name);
    assert.equal((await post(s, '/api/auth/login', { password: PASSWORD })).status, 503, name);
    assert.equal((await (await fetch(s.base + '/api/arrview/identify')).json()).auth, true, name);
    const line = s.logs.filter(l => l.startsWith('[auth]'));
    assert.equal(line.length, 1, name);
    assert.match(line[0], CLOSED_LINE, name);
    for (const secret of [good.sessionSecret, good.accessKey, good.password.hash, good.password.salt]) assert.ok(!line[0].includes(secret));
    assert.equal(fs.readFileSync(path.join(root, 'auth.json'), 'utf8'), text);
    await s.close();

    const root2 = newRoot(t);
    fs.writeFileSync(path.join(root2, 'auth.json'), text);
    const off = await startServer(t, { root: root2, env: { ARRVIEW_AUTH: 'off' } });
    assert.equal((await fetch(off.base + '/api/config')).status, 200, name);
    assert.equal(fs.readFileSync(path.join(root2, 'auth.json'), 'utf8'), text);
    await off.close();
  }
  // a directory where the file should be is unreadable
  const root = newRoot(t);
  fs.mkdirSync(path.join(root, 'auth.json'));
  const s = await startServer(t, { root });
  assert.equal((await fetch(s.base + '/api/config')).status, 401);
  assert.match(s.logs.find(l => l.startsWith('[auth]')), /\(EISDIR\)/);
});

test('an upgraded install gets no auth.json', async (t) => {
  const root = newRoot(t);
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ sonarr: { url: 'http://192.0.2.10:8989', apikey: 'abcdefghijkl' } }));
  const s = await startServer(t, { root });
  assert.equal(fs.existsSync(s.authFile), false);
  assert.ok(s.logs.includes('[auth] login is OFF (no password set).'));
});

test('source scan: scrypt parameters, no scryptSync, no cookie package, no new dependency', () => {
  const text = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.equal(text.split('scryptSync').length - 1, 0);
  assert.match(text, /N: 131072, r: 8, p: 1, keylen: 64/);
  assert.match(text, /SCRYPT_MAXMEM = 268435456/);
  assert.ok(!/require\('cookie'\)/.test(text));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['axios', 'bonjour-service', 'concurrently', 'express']);
});
