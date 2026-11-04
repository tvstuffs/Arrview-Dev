// A missing data folder (CONFIG_DIR) is reported truthfully and never created: one start-up line, a Docker-password line
// that says nobody can sign in, and sign-in, Settings Save and first-run errors that name the data folder. A normal
// folder logs nothing new.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers/server-harness');
const { AJAX, JSON_HEADERS, newRoot, setCookies } = require('./helpers/auth-helpers');

const post = (s, p, body, headers = JSON_HEADERS) => fetch(s.base + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
const authStatus = async s => (await fetch(s.base + '/api/auth/status')).json();
const dataLine = dir => `[data] the data folder ${dir} does not exist or is not a folder, so settings, passwords and sign-ins cannot be saved. Mount a volume at ${dir} (see the README).`;
const dockerLine = dir => `[auth] could not write auth.json (ENOENT); the Docker password is in force, but nobody can sign in until the data folder ${dir} exists and is writable (mount a volume there, see the README).`;
const SIGN_IN_TEXT = 'Could not sign in because ArrView cannot save to its data folder. See the ArrView log.';
const PASSWORD_TEXT = 'Could not save the password because ArrView cannot save to its data folder.';
const SETTINGS_TEXT = 'Could not save settings because ArrView cannot save to its data folder.';
const CONFIG = { sonarr: { url: 'http://127.0.0.1:8989', apikey: 'a-fixture-key' } };
const leftovers = root => fs.readdirSync(root).filter(f => f !== 'dist');

test('missing data folder with a Docker password: both start-up lines, sign-in names the data folder, nothing created', async (t) => {
  const root = newRoot(t);
  const missing = path.join(root, 'data');
  const s = await startServer(t, { root, env: { CONFIG_DIR: missing, ARRVIEW_PASSWORD: 'docker password 1' } });
  assert.equal(s.logs.filter(l => l === dataLine(missing)).length, 1);
  assert.equal(s.logs.filter(l => l.startsWith('[data]')).length, 1);
  assert.ok(s.logs.includes(dockerLine(missing)), s.logs.join('\n'));
  assert.ok(s.logs.includes('[auth] login is ON: password set by the Docker configuration.'));
  const st = await authStatus(s);
  assert.equal(st.required, true);
  assert.equal(st.signedIn, false);

  const right = await post(s, '/api/auth/login', { password: 'docker password 1' });
  assert.equal(right.status, 500);
  assert.deepEqual(await right.json(), { error: SIGN_IN_TEXT });
  assert.equal(setCookies(right).length, 0);
  assert.ok(s.logs.includes('[auth] could not write auth.json (ENOENT).'));
  const wrong = await post(s, '/api/auth/login', { password: 'not the password' });
  assert.equal(wrong.status, 401);
  assert.equal(fs.existsSync(missing), false, 'the data folder must never be created');
  assert.deepEqual(leftovers(root), []);
});

test('missing data folder on a first run: Set a password, Continue without and Settings Save name the data folder', async (t) => {
  const root = newRoot(t);
  const missing = path.join(root, 'data');
  const s = await startServer(t, { root, env: { CONFIG_DIR: missing } });
  assert.equal(s.logs.filter(l => l === dataLine(missing)).length, 1);
  assert.equal((await authStatus(s)).setupPending, true);

  const set = await post(s, '/api/auth/password', { newPassword: 'first password 1' });
  assert.equal(set.status, 500);
  assert.deepEqual(await set.json(), { error: PASSWORD_TEXT });
  assert.equal(setCookies(set).length, 0);
  const st = await authStatus(s);
  assert.equal(st.required, false, 'the login stayed off');
  assert.equal(st.source, 'none');

  const skip = await post(s, '/api/auth/setup/skip', {}, AJAX);
  assert.equal(skip.status, 500);
  assert.deepEqual(await skip.json(), { error: PASSWORD_TEXT });
  assert.equal(setCookies(skip).length, 0);

  const saved = await post(s, '/api/config', CONFIG);
  assert.equal(saved.status, 500);
  assert.deepEqual(await saved.json(), { error: SETTINGS_TEXT });
  assert.equal(setCookies(saved).length, 0);

  assert.equal(fs.existsSync(missing), false, 'the data folder must never be created');
  assert.deepEqual(leftovers(root), []);
});

test('missing data folder with ARRVIEW_AUTH=off still logs the data line once', async (t) => {
  const root = newRoot(t);
  const missing = path.join(root, 'data');
  const s = await startServer(t, { root, env: { CONFIG_DIR: missing, ARRVIEW_AUTH: 'off' } });
  assert.equal(s.logs.filter(l => l.startsWith('[data]')).length, 1);
  assert.equal(fs.existsSync(missing), false);
});

test('a data folder that is a file gets the data line', async (t) => {
  const root = newRoot(t);
  const file = path.join(root, 'not-a-folder');
  fs.writeFileSync(file, '');
  const s = await startServer(t, { root, env: { CONFIG_DIR: file } });
  assert.deepEqual(s.logs.filter(l => l.startsWith('[data]')), [dataLine(file)]);
});

test('an existing data folder logs no [data] line (the default, and CONFIG_DIR set to a folder)', async (t) => {
  const plain = await startServer(t, { root: newRoot(t) });
  assert.deepEqual(plain.logs.filter(l => l.startsWith('[data]')), []);
  const root = newRoot(t);
  const folder = path.join(root, 'data');
  fs.mkdirSync(folder);
  const s = await startServer(t, { root, env: { CONFIG_DIR: folder, ARRVIEW_PASSWORD: 'docker password 1' } });
  assert.deepEqual(s.logs.filter(l => l.startsWith('[data]')), []);
  assert.ok(!s.logs.some(l => l.includes('could not write auth.json')));
  assert.equal((await post(s, '/api/auth/login', { password: 'docker password 1' })).status, 200);
});
