const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('calendar proxy contract', async (t) => {
  let lastRequest;
  let upstreamStatus = 200;
  let payload = [{ id: 7, series: { id: 2, title: 'Fixture Show' } }];
  const upstream = http.createServer((req, res) => {
    lastRequest = { url: new URL(req.url, 'http://localhost'), key: req.headers['x-api-key'] };
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  let config = { sonarr: { url: `http://127.0.0.1:${upstream.address().port}/sonarr/`, apikey: 'fixture-only' } };
  const app = express();
  let server;
  app.listen = () => { server = http.createServer(app); return server.listen(0, '127.0.0.1'); };
  const factory = () => app;
  Object.assign(factory, express);
  const repo = path.resolve(__dirname, '..');
  vm.runInNewContext(fs.readFileSync(path.join(repo, 'server.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return factory;
      if (name === 'fs') return {
        ...fs,
        existsSync(file) { return file.endsWith('config.json') || fs.existsSync(file); },
        readFileSync(file, ...args) { return file.endsWith('config.json') ? JSON.stringify(config) : fs.readFileSync(file, ...args); },
      };
      return require(name);
    },
    __dirname: repo, process: { env: { PORT: '0' } }, console: { log() {} },
    setInterval, clearInterval, setTimeout, clearTimeout,
  });
  await new Promise(resolve => server.on('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const interval = '?start=2026-09-13T00:00:00Z&end=2026-09-28T00:00:00Z';
  await t.test('version identifies calendar-capable server', async () => {
    assert.equal((await (await fetch(base + '/api/arrview/identify')).json()).version, '1.07');
  });
  await t.test('forwards window, key, embedded series and monitored-only policy', async () => {
    const response = await fetch(base + '/api/sonarr/calendar' + interval);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
    assert.equal(lastRequest.url.pathname, '/sonarr/api/v3/calendar');
    assert.equal(lastRequest.key, 'fixture-only');
    assert.equal(lastRequest.url.searchParams.get('includeSeries'), 'true');
    assert.equal(lastRequest.url.searchParams.get('unmonitored'), 'false');
    assert.equal(lastRequest.url.searchParams.get('start'), '2026-09-13T00:00:00.000Z');
    assert.equal(lastRequest.url.searchParams.get('end'), '2026-09-28T00:00:00.000Z');
  });
  await t.test('invalid/missing/reversed/oversized and repeated ranges fail before upstream', async () => {
    lastRequest = undefined;
    for (const query of ['', '?start=bad&end=bad', '?start=2026-09-15&end=2026-09-13', '?start=2026-01-01&end=2026-12-31', interval + '&start=2026-09-14']) {
      assert.equal((await fetch(base + '/api/sonarr/calendar' + query)).status, 400);
    }
    assert.equal(lastRequest, undefined);
  });
  await t.test('empty upstream stays an empty list', async () => {
    payload = [];
    assert.deepEqual(await (await fetch(base + '/api/sonarr/calendar' + interval)).json(), []);
  });
  await t.test('upstream authentication errors are not empty success', async () => {
    upstreamStatus = 401;
    assert.equal((await fetch(base + '/api/sonarr/calendar' + interval)).status, 401);
  });
  await t.test('missing Sonarr reports unavailable', async () => {
    config = {};
    assert.equal((await fetch(base + '/api/sonarr/calendar' + interval)).status, 503);
  });
});
