const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('W3 series monitoring and history contracts', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-w0-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist/assets'), { recursive: true });
  for (const [file, body] of Object.entries({
    'index.html': '<html>shell</html>', 'manifest.webmanifest': '{}',
    'sw.js': '// worker', 'assets/index-hash.js': '// bundle',
  })) fs.writeFileSync(path.join(root, 'dist', file), body);
  let status = 200;
  let failMethod = null;
  const resource = { id: 42, title: 'Fixture', monitored: true, path: '/media/fixture', seasons: [{ seasonNumber: 1, monitored: true }] };
  const hits = [];
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = ''; for await (const chunk of req) body += chunk;
    hits.push({ method: req.method, url, key: req.headers['x-api-key'], body: body ? JSON.parse(body) : null });
    res.writeHead(req.method === failMethod ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.method === failMethod ? { message: 'Fixture unavailable' } : url.pathname.includes('/series/') ? resource : { history: { slots: [] } }));
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

  const monitor = (id = '42', body = { monitored: false }) => fetch(`${base}/api/sonarr/series/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  await t.test('monitor read-modify-write preserves metadata and ignores client overrides', async () => {
    assert.equal((await monitor('42', { monitored: false, path: 'malicious override' })).status, 200);
    assert.deepEqual(hits.map(h => h.method), ['GET', 'PUT']);
    assert.equal(hits[0].url.pathname, '/sonarr/api/v3/series/42');
    assert.equal(hits[1].key, 'fixture-only-secret');
    assert.deepEqual(hits[1].body, { ...resource, monitored: false });
  });
  await t.test('invalid monitor input makes no upstream call', async () => {
    hits.length = 0;
    for (const body of [{}, { monitored: 'false' }, { monitored: 0 }]) assert.equal((await monitor('42', body)).status, 400);
    assert.equal((await monitor('abc')).status, 400);
    assert.equal(hits.length, 0);
  });
  await t.test('read failures prevent writes; write failures stay failures', async () => {
    hits.length = 0; failMethod = 'GET';
    assert.equal((await monitor()).status, 503); assert.equal(hits.length, 1);
    failMethod = 'PUT'; assert.equal((await monitor()).status, 503);
    failMethod = null;
  });
  await t.test('history keeps default 15, forwards requested limit and bounds invalid inputs', async () => {
    for (const [query, expected] of [['', '15'], ['?limit=30', '30'], ['?limit=1000', '1000']]) {
      assert.equal((await fetch(base + '/api/sabnzbd/history' + query)).status, 200);
      assert.equal(hits.at(-1).url.searchParams.get('limit'), expected);
      assert.equal(hits.at(-1).url.searchParams.get('mode'), 'history');
    }
    hits.length = 0;
    for (const query of ['0','-1','1.5','1001','abc','15&limit=30']) assert.equal((await fetch(base + '/api/sabnzbd/history?limit=' + query)).status, 400);
    assert.equal(hits.length, 0);
  });
});
