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
  const refused = err => [err, err.cause].some(e => e && e.code === 'ARRVIEW_REDIRECT_REFUSED');
  const hop = href => { const u = new URL(href); return { href, protocol: u.protocol, hostname: u.hostname }; };
  assert.throws(() => out.beforeRedirect(hop('http://host.example/x'), { headers: {}, statusCode: 302 }), refused);
  assert.doesNotThrow(() => out.beforeRedirect(hop('https://host.example/x'), { headers: {}, statusCode: 302 }));
  // RISK-1 (round 1): the decision reads the logical URL, not the transport fields a forward proxy rewrites.
  assert.throws(() => out.beforeRedirect({ href: 'http://host.example/x', protocol: 'https:', hostname: 'host.example' },
    { headers: {}, statusCode: 302 }), refused, 'an https-looking transport does not hide an http destination');
  assert.doesNotThrow(() => out.beforeRedirect({ href: 'https://host.example/x', protocol: 'http:', hostname: 'proxy.example' },
    { headers: {}, statusCode: 302 }), 'a proxy transport address does not refuse a same-host https destination');
  assert.throws(() => out.beforeRedirect({ href: 'https://other.example/x', protocol: 'https:', hostname: 'host.example' },
    { headers: {}, statusCode: 302 }), refused, 'a same-host transport does not let another destination host through');
  assert.throws(() => out.beforeRedirect({ protocol: 'https:', hostname: 'host.example' }, { headers: {}, statusCode: 302 }),
    refused, 'a hop without a logical URL is refused');
});

// RISK-1 (round 1): through a forward proxy (here HTTP_PROXY), axios rewrites the hop's hostname/protocol to the proxy's before the
// guard runs. The guard must judge the logical destination. A loopback forward proxy records every absolute URL it is asked for.
async function forwardProxy(t, host) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, key: req.headers['x-api-key'] });
    let dest;
    try { dest = new URL(req.url); } catch (_) { res.writeHead(400); return res.end(); }
    const up = http.request(dest, { method: req.method, headers: req.headers }, upRes => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise(resolve => server.listen(0, host, resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const saved = {};
  for (const name of ['http_proxy', 'HTTP_PROXY', 'no_proxy', 'NO_PROXY']) saved[name] = process.env[name];
  const proxyUrl = `http://${host}:${server.address().port}`;
  process.env.http_proxy = proxyUrl;
  process.env.HTTP_PROXY = proxyUrl;
  delete process.env.no_proxy;
  delete process.env.NO_PROXY;
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  return { hits };
}

test('R-proxy1: behind a forward proxy on another host name, a same-host redirect is still followed', async t => {
  const up = await standIn(t, { '/api/v3/movie': redirectTo('/api/v3/movie-moved'), '/api/v3/movie-moved': { body: '[]' } });
  const s = await startServer(t, { config: { radarr: { url: up.url, apikey: KEY } } });
  const proxy = await forwardProxy(t, 'localhost');
  const r = await fetch(s.base + '/api/radarr/movies');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);
  assert.deepEqual(up.hits.map(h => h.path), ['/api/v3/movie', '/api/v3/movie-moved']);
  // Both hops really went through the proxy (otherwise this case proves nothing).
  assert.deepEqual(proxy.hits.map(h => new URL(h.url).pathname), ['/api/v3/movie', '/api/v3/movie-moved']);
});

test('R-proxy2: behind a forward proxy sharing the service\'s host name, a cross-host redirect is stopped and nothing reaches the other host', async t => {
  const other = await target(t);
  const up = await standIn(t, { '/api/v3/series': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: { sonarr: { url: up.url, apikey: KEY } } });
  const proxy = await forwardProxy(t, '127.0.0.1');
  const r = await fetch(s.base + '/api/sonarr/series');
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: SENTENCE });
  assert.deepEqual(other.hits, []);
  // The proxy was used for the first hop and was never asked for the other host, so it forwarded neither a request nor the key.
  assert.deepEqual(proxy.hits.map(h => h.url), [`${up.url}/api/v3/series`]);
  assert.ok(proxy.hits.every(h => new URL(h.url).hostname === '127.0.0.1'));
  assert.deepEqual(up.hits.map(h => h.path), ['/api/v3/series']);
});

test('R-proxy3: behind a forward proxy, the Test button redirected to another host is stopped and the typed key goes nowhere new', async t => {
  const other = await target(t);
  const up = await standIn(t, { '/api/v3/system/status': redirectTo(`${other.url}/captured`) });
  const s = await startServer(t, { config: {} });
  const proxy = await forwardProxy(t, '127.0.0.1');
  const r = await s.json('POST', '/api/test/sonarr', { url: up.url, apikey: TYPED });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: SENTENCE });
  assert.deepEqual(other.hits, []);
  assert.ok(proxy.hits.length >= 1, 'the proxy was used');
  assert.ok(proxy.hits.every(h => new URL(h.url).hostname !== 'localhost'));
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
