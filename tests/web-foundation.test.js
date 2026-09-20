const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('W0 web foundation contract', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-w0-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
  for (const [file, body] of Object.entries({
    'index.html': '<html>shell</html>', 'manifest.webmanifest': '{}',
    'sw.js': '// worker', 'assets/index-hash.js': '// bundle',
  })) fs.writeFileSync(path.join(root, 'dist', file), body);
  let status = 200;
  let invalid = false;
  const hits = [];
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    hits.push({ url, key: req.headers['x-api-key'] });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(invalid ? { error: 'fixture-only-secret' } :
      url.searchParams.get('t') === 'caps' ? { caps: { server: { title: 'fixture' } } } : { version: '4.0' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const config = Object.fromEntries(['sonarr', 'radarr', 'sabnzbd', 'nzbhydra'].map(service => [service, {
    url: `http://127.0.0.1:${upstream.address().port}/${service}/`, apikey: 'fixture-only-secret',
    ...(service === 'sabnzbd' ? { sabPath: '/api' } : {}),
  }]));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config));
  const app = express();
  let server;
  app.listen = () => { server = http.createServer(app); return server.listen(0, '127.0.0.1'); };
  const factory = () => app;
  Object.assign(factory, express);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
    require: name => name === 'express' ? factory : require(name),
    __dirname: root, process: { env: { PORT: '0' } }, console: { log() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
  });
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await t.test('health is uncached liveness, even without config or upstreams', async () => {
    fs.renameSync(path.join(root, 'config.json'), path.join(root, 'saved.json'));
    const response = await fetch(base + '/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', version: '1.10.2' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(hits.length, 0);
    fs.renameSync(path.join(root, 'saved.json'), path.join(root, 'config.json'));
  });
  await t.test('event stream announces retry and can disconnect cleanly', async () => {
    const controller = new AbortController();
    const response = await fetch(base + '/api/events', { signal: controller.signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader();
    const chunk = await reader.read();
    assert.match(new TextDecoder().decode(chunk.value), /retry: 5000/);
    await reader.cancel(); controller.abort();
  });
  await t.test('pings use status/version/caps and forward credentials, never libraries', async () => {
    for (const service of Object.keys(config)) {
      const response = await fetch(`${base}/api/${service}/ping`);
      assert.equal(response.status, 200, service);
      assert.deepEqual(await response.json(), { status: 'ok' });
      const hit = hits.at(-1);
      if (['sonarr', 'radarr'].includes(service)) {
        assert.equal(hit.url.pathname, `/${service}/api/v3/system/status`);
        assert.equal(hit.key, 'fixture-only-secret');
      } else {
        assert.equal(hit.url.searchParams.get('apikey'), 'fixture-only-secret');
        assert.equal(hit.url.searchParams.get(service === 'sabnzbd' ? 'mode' : 't'), service === 'sabnzbd' ? 'version' : 'caps');
      }
    }
    assert.equal(hits.length, 4);
  });
  await t.test('upstream rejection and HTTP-200 API errors fail without leaking credentials', async () => {
    for (const service of Object.keys(config)) {
      for (const code of [401, 500, 200]) {
        status = code;
        invalid = code === 200;
        const response = await fetch(`${base}/api/${service}/ping`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'Service unavailable' });
      }
    }
    status = 200; invalid = false;
  });
  await t.test('missing config and unknown services do not call upstream', async () => {
    const before = hits.length;
    fs.writeFileSync(path.join(root, 'config.json'), '{}');
    for (const service of Object.keys(config)) assert.equal((await fetch(`${base}/api/${service}/ping`)).status, 503);
    assert.equal((await fetch(base + '/api/unknown/ping')).status, 404);
    assert.equal(hits.length, before);
  });
  await t.test('hashed assets immutable for one year; shell/manifest/SW revalidate', async () => {
    const asset = await fetch(base + '/assets/index-hash.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    for (const route of ['/', '/index.html', '/manifest.webmanifest', '/sw.js', '/shows']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('cache-control'), 'no-cache', route);
    }
  });
  await t.test('missing files and API routes are 404, not HTML fallback', async () => {
    for (const route of ['/missing.webmanifest', '/missing-sw.js', '/assets/missing.js', '/api/missing', '/api']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404, route);
      assert.deepEqual(await response.json(), { error: 'Not found' });
      assert.ok(!response.headers.get('cache-control').includes('immutable'));
    }
  });
});
