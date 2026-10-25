// The first-run choice on a new install: set a password or continue without one. Nothing else becomes public.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { AJAX, JSON_HEADERS, newRoot, seedAuth, setCookies, cookieHeader } = require('./helpers/auth-helpers');

const post = (s, p, body, headers = JSON_HEADERS) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const pending = async (s, headers) => (await (await fetch(s.base + '/api/auth/status', { headers })).json()).setupPending;
const EMPTY = { version: 2, password: null, sessions: [], keys: [] };

test('a new install reports setup pending, and nothing is written until a choice is made', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  assert.equal(await pending(s), true);
  assert.equal(fs.existsSync(s.authFile), false);
  assert.equal(fs.existsSync(s.configFile), false);
  assert.equal((await fetch(s.base + '/api/config')).status, 200, 'with no password the app is open, as before');
});

test('continue without a password writes auth.json with no password, and the screen never comes back', async (t) => {
  const root = newRoot(t);
  const s = await startServer(t, { root });
  const r = await post(s, '/api/auth/setup/skip', {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true });
  assert.deepEqual(s.readAuth(), EMPTY);
  assert.equal(fs.statSync(s.authFile).mode & 0o777, 0o600);
  assert.equal(await pending(s), false);
  assert.equal((await post(s, '/api/auth/setup/skip', {})).status, 409);
  await s.close();
  const again = await startServer(t, { root });
  assert.equal(await pending(again), false);
  assert.equal((await fetch(again.base + '/api/config')).status, 200);
  // The Security card can still set a password later.
  assert.equal((await post(again, '/api/auth/password', { newPassword: 'later password 1' })).status, 200);
});

test('setting a password on the first-run screen signs this browser in and ends the screen', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  const r = await post(s, '/api/auth/password', { newPassword: 'first run password' });
  assert.equal(r.status, 200);
  const cookie = cookieHeader(setCookies(r)[0]);
  assert.equal((await fetch(s.base + '/api/config', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(s.base + '/api/config')).status, 401);
  const status = await (await fetch(s.base + '/api/auth/status', { headers: { Cookie: cookie } })).json();
  assert.equal(status.setupPending, false);
  assert.equal((await post(s, '/api/auth/setup/skip', {}, { ...AJAX, Cookie: cookie })).status, 409);
  assert.equal(s.readAuth().password.origin, 'settings');
});

test('existing installs never see the screen: a config.json, an auth.json, a Docker password or ARRVIEW_AUTH=off', async (t) => {
  const config = { sonarr: { url: 'http://192.0.2.10:8989', apikey: 'abcdefghijkl' } };
  const withConfig = await startServer(t, { root: newRoot(t), config });
  assert.equal(await pending(withConfig), false);
  assert.equal((await post(withConfig, '/api/auth/setup/skip', {})).status, 409);
  assert.equal(fs.existsSync(withConfig.authFile), false);

  const withFile = newRoot(t);
  fs.writeFileSync(path.join(withFile, 'auth.json'), JSON.stringify(EMPTY));
  assert.equal(await pending(await startServer(t, { root: withFile })), false);

  const docker = await startServer(t, { root: newRoot(t), env: { ARRVIEW_PASSWORD: 'docker password 1' } });
  assert.deepEqual(await (await fetch(docker.base + '/api/auth/status')).json(), { required: true, signedIn: false });
  const login = await post(docker, '/api/auth/login', { password: 'docker password 1' });
  assert.equal(await pending(docker, { Cookie: cookieHeader(setCookies(login)[0]) }), false);
  assert.equal((await post(docker, '/api/auth/setup/skip', {})).status, 401);

  const off = await startServer(t, { root: newRoot(t), env: { ARRVIEW_AUTH: 'off' } });
  assert.equal(await pending(off), false);
  assert.equal((await post(off, '/api/auth/setup/skip', {})).status, 409);
  assert.equal(fs.existsSync(off.authFile), false);

  const seededRoot = newRoot(t);
  seedAuth(seededRoot);
  const seeded = await startServer(t, { root: seededRoot });
  assert.deepEqual(await (await fetch(seeded.base + '/api/auth/status')).json(), { required: true, signedIn: false });
});

test('a config.json created while the screen is pending ends it', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  assert.equal(await pending(s), true);
  fs.writeFileSync(s.configFile, JSON.stringify({}));
  assert.equal(await pending(s), false);
  assert.equal((await post(s, '/api/auth/setup/skip', {})).status, 409);
});

test('with the login on, the status route says nothing about setup and the skip route is protected', async (t) => {
  const root = newRoot(t);
  seedAuth(root);
  const s = await startServer(t, { root });
  const anonymous = await (await fetch(s.base + '/api/auth/status')).json();
  assert.deepEqual(Object.keys(anonymous), ['required', 'signedIn']);
  assert.equal((await post(s, '/api/auth/setup/skip', {})).status, 401);
  assert.deepEqual(s.readAuth().password.origin, 'settings');
});
