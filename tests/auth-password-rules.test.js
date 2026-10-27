const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vectors = require('./fixtures/password-vectors.json');
const { startSeeded, AJAX, JSON_HEADERS, newRoot } = require('./helpers/auth-helpers');
const { startServer } = require('./helpers/server-harness');

// The function is taken from the server.js text between its markers, so the public API is not widened.
const text = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const body = text.slice(text.indexOf('// validatePassword:begin'), text.indexOf('// validatePassword:end'));
const validatePassword = new Function(`${body}; return validatePassword;`)();

const expand = v => (v && typeof v === 'object' && 'repeat' in v ? v.repeat.repeat(v.times) : v);

test('every vector row gives the expected result in the server function', () => {
  assert.ok(vectors.length >= 30);
  for (const row of vectors) {
    const input = expand(row.input);
    const got = validatePassword(input, row.source);
    const label = `${row.source} ${JSON.stringify(typeof input === 'string' && input.length > 20 ? input.length : input)}`;
    assert.equal(got.ok, row.ok, label);
    if (row.ok) {
      if ('normalised' in row) assert.equal(got.value, row.normalised, label);
      if ('length' in row) assert.equal(got.value.length, row.length, label);
    } else assert.equal(got.reason, row.reason, label);
  }
});

test('composed and decomposed forms normalise alike, and a 1025 character string is refused unnormalised', () => {
  assert.equal(validatePassword('café café', 'settings').value, validatePassword('café café', 'settings').value);
  assert.equal(validatePassword('ﬁ'.repeat(1025), 'settings').reason, 'length');
});

test('Settings end to end: every settings row either answers the 400 text or signs in with the normalised string', async (t) => {
  const rows = vectors.filter(r => r.source === 'settings' && typeof expand(r.input) === 'string' && expand(r.input).length <= 1024);
  for (const row of rows) {
    const input = expand(row.input);
    const s = await startServer(t, { root: newRoot(t) });
    const r = await fetch(s.base + '/api/auth/password', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ newPassword: input }) });
    if (!row.ok) {
      assert.equal(r.status, 400, JSON.stringify(input.slice(0, 20)));
      assert.equal((await r.json()).error, row.reason === 'blank' ? "Password can't be only spaces" : 'Password must be 8 to 256 characters');
    } else {
      assert.equal(r.status, 200, JSON.stringify(input.slice(0, 20)));
      const login = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password: input }) });
      assert.equal(login.status, 200);
    }
    await s.close();
  }
});

test('the composed and decomposed forms both sign in', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  const set = await fetch(s.base + '/api/auth/password', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ newPassword: 'café café' }) });
  assert.equal(set.status, 200);
  for (const password of ['café café', 'café café']) {
    const r = await fetch(s.base + '/api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password }) });
    assert.equal(r.status, 200);
  }
});
