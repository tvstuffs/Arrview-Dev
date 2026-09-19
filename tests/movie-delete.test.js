const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('movie removal proxy contract', async (t) => {
  let lastRequest;
  let upstreamStatus = 200;
  let upstreamBody = '';
  let hits = 0;
  const upstream = http.createServer((req, res) => {
    hits += 1;
    lastRequest = { method: req.method, url: new URL(req.url, 'http://localhost'), key: req.headers['x-api-key'] };
    res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
    res.end(upstreamBody);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  let config = { radarr: { url: `http://127.0.0.1:${upstream.address().port}/radarr/`, apikey: 'fixture-only' } };
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
  const route = '/api/radarr/movie/42';
  const remove = (query = '', id = '42') => fetch(`${base}/api/radarr/movie/${id}${query}`, { method: 'DELETE' });

  await t.test('deleteFiles=true reaches Radarr with its own exclusion flag name', async () => {
    const response = await remove('?deleteFiles=true');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.equal(lastRequest.method, 'DELETE');
    assert.equal(lastRequest.url.pathname, '/radarr/api/v3/movie/42');
    assert.equal(lastRequest.key, 'fixture-only');
    assert.deepEqual(Object.fromEntries(lastRequest.url.searchParams),
                     { deleteFiles: 'true', addImportExclusion: 'false' });
  });
  await t.test('anything other than deleteFiles=true keeps files and never sends the Sonarr flag', async () => {
    for (const query of ['', '?deleteFiles=false', '?deleteFiles=1', '?deleteFiles=TRUE', '?deleteFiles=true&deleteFiles=false']) {
      assert.equal((await remove(query)).status, 200, query);
      assert.equal(lastRequest.url.searchParams.get('deleteFiles'), 'false', query);
      assert.equal(lastRequest.url.searchParams.get('addImportExclusion'), 'false', query);
      assert.equal(lastRequest.url.searchParams.has('addImportListExclusion'), false, query);
    }
  });
  await t.test('empty 200 and 204 upstream bodies are still success', async () => {
    for (const status of [200, 204]) {
      upstreamStatus = status;
      upstreamBody = '';
      const response = await remove('?deleteFiles=true');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true });
    }
    upstreamStatus = 200;
  });
  await t.test('rejects non-numeric movie ids before any upstream traffic', async () => {
    const previousHits = hits;
    for (const id of ['abc', '4.2', '-1', '42x', 'monitor', '%20']) {
      assert.equal((await remove('?deleteFiles=true', id)).status, 400, id);
    }
    assert.equal(hits, previousHits);
  });
  await t.test('upstream failures keep their status and Radarr message', async () => {
    upstreamStatus = 404;
    upstreamBody = JSON.stringify({ message: 'NotFound' });
    let response = await remove('?deleteFiles=true');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'NotFound' });
    upstreamStatus = 500;
    upstreamBody = 'not json';
    response = await remove('?deleteFiles=true');
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.ok(!body.error.includes('fixture-only'));
    upstreamStatus = 200;
    upstreamBody = '';
  });
  await t.test('unconfigured Radarr is 503 without upstream traffic', async () => {
    const previousHits = hits;
    config = {};
    const response = await remove('?deleteFiles=true');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Radarr not configured' });
    assert.equal(hits, previousHits);
  });
  assert.equal(route, '/api/radarr/movie/42');
});
