const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { AJAX, JSON_HEADERS, newRoot, setCookies, cookieHeader, trackingFetch } = require('./helpers/auth-helpers');

test('no response, header or log line leaks a password, hash, salt, secret, cookie value or key', async (t) => {
  const s = await startServer(t, { root: newRoot(t) });
  const f = trackingFetch();
  const call = (method, p, body, headers = JSON_HEADERS) => f(s.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const pw1 = 'first secret phrase 1', pw2 = 'second secret phrase 2';
  const cookies = [];
  const keep = r => { for (const c of setCookies(r)) cookies.push(c.value); return r; };

  const first = keep(await call('POST', '/api/auth/password', { newPassword: pw1 }));
  let cookie = cookieHeader(setCookies(first)[0]);
  const keys = [];
  const withCookie = () => ({ ...AJAX, Cookie: cookie });
  keep(await call('POST', '/api/auth/login', { password: 'wrong secret phrase' }));
  keep(await call('POST', '/api/auth/login', { password: pw1 }));
  const token = await call('POST', '/api/auth/token', { password: pw1, name: 'Script' });
  keys.push((await token.json()).accessKey);
  keys.push((await (await call('POST', '/api/auth/keys', { name: 'Phone' }, withCookie())).json()).accessKey);
  const listed = await call('GET', '/api/auth/keys', undefined, { Cookie: cookie });
  assert.equal(listed.status, 200);
  const beforeChange = s.readAuthText();
  assert.equal(JSON.parse(beforeChange).keys.length, 2);
  await call('GET', '/api/config', undefined, { Cookie: cookie });
  await call('POST', '/api/config', {}, withCookie());
  await call('GET', '/api/config');
  await call('GET', '/api/auth/status', undefined, { Cookie: cookie });
  const changed = keep(await call('POST', '/api/auth/password', { currentPassword: pw1, newPassword: pw2 }, withCookie()));
  cookie = cookieHeader(setCookies(changed)[0]);
  // The file while signed in holds digests only: take it before the logout-all that empties it.
  const live = s.readAuthText();
  keep(await call('POST', '/api/auth/logout-all', {}, withCookie()));
  const another = keep(await call('POST', '/api/auth/login', { password: pw2 }));
  const anotherKey = (await (await call('POST', '/api/auth/keys', {}, { ...AJAX, Cookie: cookieHeader(setCookies(another)[0]) })).json()).accessKey;
  keys.push(anotherKey);
  const liveToo = s.readAuthText();
  for (let i = 0; i < 11; i++) await call('POST', '/api/auth/login', { password: 'wrong secret phrase' });

  const stored = s.readAuth();
  const secrets = [pw1, pw2, 'wrong secret phrase', stored.password.hash, stored.password.salt, ...cookies, ...keys].filter(Boolean);
  const creating = new Set(['/api/auth/token', '/api/auth/keys']);
  const cookieRoutes = new Set(['/api/auth/login', '/api/auth/password', '/api/auth/logout', '/api/auth/logout-all', '/api/config']);
  for (const r of f.seen) {
    const route = new URL(r.url).pathname;
    for (const secret of secrets) {
      if (!creating.has(route) || !keys.includes(secret)) assert.ok(!r.body.includes(secret), `${route} body leaks a secret`);
      for (const [name, value] of r.headers) if (name !== 'set-cookie') assert.ok(!value.includes(secret), `${route} header ${name}`);
      if (!cookieRoutes.has(route)) for (const c of r.setCookies) assert.ok(!c.includes(secret), `${route} sets a cookie`);
    }
  }
  // Neither the log nor auth.json ever holds a session token or key (only their digests).
  const tokens = [...cookies, ...keys].filter(Boolean);
  assert.ok(tokens.length >= 4);
  for (const text of [beforeChange, live, liveToo, s.readAuthText()]) for (const token of tokens) assert.ok(!text.includes(token), 'auth.json holds a token');
  assert.ok(JSON.parse(liveToo).keys.length === 1 && JSON.parse(liveToo).sessions.length === 1);
  for (const line of s.logs) for (const secret of secrets) assert.ok(!line.includes(secret), line);
  assert.ok(s.logs.some(l => /^\[auth\] sign-in failed from 127\.0\.0\.1 route=login$/.test(l)));
  assert.ok(s.logs.some(l => /^\[auth\] too many failed attempts from 127\.0\.0\.1; blocked for \d+ s$/.test(l)));
  // Only a creating response carries a key, and it is the same shape on both routes.
  for (const r of f.seen.filter(r => creating.has(new URL(r.url).pathname) && r.method === 'POST' && r.status === 200)) {
    const body = JSON.parse(r.body);
    assert.deepEqual(Object.keys(body).sort(), ['accessKey', 'created', 'id', 'name']);
  }
  // The list never carries a key.
  const list = f.seen.find(r => new URL(r.url).pathname === '/api/auth/keys' && r.method === 'GET');
  assert.deepEqual(Object.keys(JSON.parse(list.body).keys[0]).sort(), ['created', 'id', 'lastUsed', 'name']);
});
