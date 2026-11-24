const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const axios = require('axios');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// D94: one guard on the shared axios follows a redirect only to the same host name, and never from https to http. Cases R1-R5 from
// the 2026-11-24 scan: on 4bc9d46 a service that answered 302 to another host had ArrView send that host the stored key. The other
// host here is `localhost` against the stand-in's `127.0.0.1`, as in the maintainer's harness.

const KEY = 'fixture-only-key-1';
const TYPED = 'fixture-only-typed-key';
const MARKER = Symbol.for('arrview.redirectGuard');
const SENTENCE = "The service redirected ArrView to another address, so the request was stopped. Use the service's own address in Settings.";

// The redirect target: another host name, counting what it receives.
async function target(t) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ path: req.url, key: req.headers['x-api-key'] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"version":"9.9.9","appName":"Sonarr"}');
  });
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { hits, port: server.address().port, url: `http://localhost:${server.address().port}` };
}
const redirectTo = location => ({ status: 302, headers: { Location: location }, body: '' });

test('R1: a library read redirected to another host name is stopped, and that host receives nothing', async t => {
  const other = await target(t);
  const up = await standIn(t, { '/api/v3/series': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  const r = await fetch(s.base + '/api/sonarr/series');
  assert.equal(r.status, 503);
  const text = await r.text();
  assert.deepEqual(JSON.parse(text), { error: SENTENCE });
  assert.deepEqual(other.hits, []);
  // R-msg: the answer names neither the other address nor the library's own wording.
  for (const leak of [String(other.port), 'localhost', 'Redirected request failed']) assert.ok(!text.includes(leak), leak);
});

test('R2: the Test button, redirected to another host name, is stopped the same way', async t => {
  const other = await target(t);
  const up = await standIn(t, { '/api/v3/system/status': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: {} });
  const r = await s.json('POST', '/api/test/sonarr', { url: up.url, apikey: TYPED });
  assert.equal(r.status, 503);
  const text = await r.text();
  assert.deepEqual(JSON.parse(text), { error: SENTENCE });
  assert.deepEqual(other.hits, []);
  for (const leak of [String(other.port), 'localhost', 'Redirected request failed']) assert.ok(!text.includes(leak), leak);
});

test('R3: the status ping does not follow redirects at all (control)', async t => {
  const other = await target(t);
  const up = await standIn(t, { '/api/v3/system/status': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  const r = await fetch(s.base + '/api/sonarr/ping');
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Service unavailable' });
  assert.deepEqual(other.hits, []);
});

test('R4: a redirect on the same host is still followed (control)', async t => {
  const up = await standIn(t, { '/api/v3/movie': redirectTo('/api/v3/movie-moved'), '/api/v3/movie-moved': { body: '[]' } });
  const s = await startServer(t, { config: { radarr: { url: up.url, apikey: KEY } } });
  const r = await fetch(s.base + '/api/radarr/movies');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
  assert.deepEqual(up.hits.map(h => h.path), ['/api/v3/movie', '/api/v3/movie-moved']);
});

test('R5: the decision: same host name only, never https to http', async t => {
  await startServer(t);
  const guard = axios[MARKER];
  assert.ok(guard && typeof guard.allowed === 'function', 'the guard marker is installed');
  const { allowed } = guard;
  const at = (protocol, hostname) => ({ protocol, hostname });
  assert.equal(allowed(at('https:', 'host.example'), at('http:', 'host.example')), false);
  assert.equal(allowed(at('http:', 'host.example'), at('http:', 'other.example')), false);
  assert.equal(allowed(at('http:', '127.0.0.1'), at('http:', 'localhost')), false);
  assert.equal(allowed(at('https:', 'host.example'), at('https:', 'other.example')), false);
  assert.equal(allowed(at('http:', 'host.example'), at('http:', 'host.example')), true);
  assert.equal(allowed(at('http:', 'host.example'), at('https:', 'host.example')), true);
  assert.equal(allowed(at('https:', 'HOST.example'), at('https:', 'host.example')), true);
  assert.equal(allowed(at('http:', '[::1]'), at('http:', '::1')), true);
  assert.equal(allowed(at('http:', 'host.example'), at('http:', 'host.example.')), false);
});

test('R-https: a redirect from a same-host https service to http is stopped too', async t => {
  // The https case cannot be served here without certificates, so the rule is driven through the guard's own hook: a config that
  // started on https and a hop that goes to http on the same host must throw before any request is made.
  await startServer(t);
  const config = { url: 'https://host.example/api/v3/series', method: 'get', headers: {} };
  const handlers = axios.interceptors.request.handlers.filter(Boolean);
  let out = config;
  for (const h of handlers) out = await h.fulfilled(out);
  assert.equal(typeof out.beforeRedirect, 'function');
  assert.throws(() => out.beforeRedirect({ protocol: 'http:', hostname: 'host.example' }, { headers: {}, statusCode: 302 }),
    err => [err, err.cause].some(e => e && e.code === 'ARRVIEW_REDIRECT_REFUSED'));
  assert.doesNotThrow(() => out.beforeRedirect({ protocol: 'https:', hostname: 'host.example' }, { headers: {}, statusCode: 302 }));
});

test('R-msg: the R1 and R2 answers name neither the other address nor the library\'s wording', async t => {
  const other = await target(t);
  const up = await standIn(t, {
    '/api/v3/series': redirectTo(`${other.url}/captured`), '/api/v3/system/status': redirectTo(`${other.url}/captured`),
  });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  const answers = [await (await fetch(s.base + '/api/sonarr/series')).text(),
    await (await s.json('POST', '/api/test/sonarr', { url: up.url, apikey: TYPED })).text()];
  for (const text of answers) {
    assert.deepEqual(JSON.parse(text), { error: SENTENCE });
    for (const leak of [String(other.port), 'localhost', 'Redirected request failed', '/captured']) assert.ok(!text.includes(leak), leak);
  }
  assert.deepEqual(other.hits, []);
});

test('R-idem: a second evaluation installs nothing more, and the guard still holds', async t => {
  await startServer(t);
  const requests = axios.interceptors.request.handlers.filter(Boolean).length;
  const responses = axios.interceptors.response.handlers.filter(Boolean).length;
  const guard = axios[MARKER];
  assert.ok(guard);
  await startServer(t);
  assert.equal(axios.interceptors.request.handlers.filter(Boolean).length, requests);
  assert.equal(axios.interceptors.response.handlers.filter(Boolean).length, responses);
  assert.equal(axios[MARKER], guard);

  const other = await target(t);
  const up = await standIn(t, { '/api/v3/series': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  assert.equal((await fetch(s.base + '/api/sonarr/series')).status, 503);
  assert.deepEqual(other.hits, []);
});
