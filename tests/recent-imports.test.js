const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

test('bounded recent-import proxy contract', async (t) => {
  let lastRequest;
  let upstreamStatus = 200;
  let payload;
  let rawBody;
  let redirect = false;
  let hits = 0;
  const upstream = http.createServer((req, res) => {
    hits += 1;
    lastRequest = { url: new URL(req.url, 'http://localhost'), key: req.headers['x-api-key'] };
    res.writeHead(redirect ? 302 : upstreamStatus, { 'Content-Type': 'application/json', ...(redirect ? { Location: '/leak' } : {}) });
    res.end(rawBody ?? JSON.stringify(payload));
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
  const route = '/api/radarr/history/recent-imports';
  function validPage(page = 1) {
    return { page, pageSize: 20, totalRecords: 2000, records: [{
      id: 999, movieId: 7, date: '2026-09-18T12:00:00Z', eventType: 'downloadFolderImported',
      sourceTitle: 'Unused release data', data: { importedPath: '/private/media/file.mkv' },
      movie: { id: 7, title: 'Fixture Movie', year: 2026, hasFile: true, movieFileId: 70,
        overview: 'Unused overview', path: '/private/media',
        movieFile: { id: 70, dateAdded: '2026-09-18T11:59:59Z', path: '/private/file.mkv' },
        images: [{ coverType: 'poster', url: '/MediaCover/7/poster.jpg', remoteUrl: 'https://cdn.example.test/poster.jpg' },
                 { coverType: 'fanart', remoteUrl: 'https://cdn.example.test/fanart.jpg' }] }
    }] };
  }
  await t.test('identifies version 1.08', async () => {
    assert.equal((await (await fetch(base + '/api/arrview/identify')).json()).version, '1.08');
  });
  await t.test('fixed bounded import query, credentials and base path; response allowlist', async () => {
    payload = validPage(2);
    const response = await fetch(base + route + '?page=2&pageSize=2000&eventType=1&sortDirection=ascending');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.totalRecords, 2000);
    assert.equal(lastRequest.url.pathname, '/radarr/api/v3/history');
    assert.equal(lastRequest.key, 'fixture-only');
    assert.deepEqual(Object.fromEntries(lastRequest.url.searchParams), {
      page: '2', pageSize: '20', eventType: '3', includeMovie: 'true', sortKey: 'date', sortDirection: 'descending'
    });
    assert.deepEqual(Object.keys(result.records[0]).sort(), ['date', 'eventType', 'movie', 'movieId']);
    assert.deepEqual(result.records[0].movie.movieFile, { id: 70, dateAdded: '2026-09-18T11:59:59Z' });
    assert.equal(result.records[0].movie.images.length, 1);
    assert.equal(result.records[0].movie.movieFileId, 70);
    for (const text of ['Unused', '/private', 'fixture-only', 'fanart']) assert.ok(!JSON.stringify(result).includes(text));
  });
  await t.test('rejects invalid or repeated page inputs before upstream', async () => {
    const previousHits = hits;
    for (const query of ['?page=0', '?page=4', '?page=1000', '?page=-1', '?page=1.5', '?page=1&page=2', '?page[0]=1']) {
      assert.equal((await fetch(base + route + query)).status, 400);
    }
    assert.equal(hits, previousHits);
  });
  await t.test('empty and removed-movie records remain valid responses', async () => {
    payload = { page: 1, pageSize: 20, totalRecords: 0, records: [] };
    assert.deepEqual(await (await fetch(base + route)).json(), payload);
    payload = validPage();
    payload.records[0].movie = null;
    assert.equal((await (await fetch(base + route)).json()).records[0].movie, null);
  });
  await t.test('rejects invalid page envelopes and ignored paging', async () => {
    for (const replacement of [{ page: 2 }, { pageSize: 2000 }, { totalRecords: -1 }, { records: [] },
                               { records: Array(21).fill(validPage().records[0]) }]) {
      payload = { ...validPage(), ...replacement };
      assert.equal((await fetch(base + route)).status, 502);
    }
  });
  await t.test('rejects oversized streamed and malformed upstream payloads', async () => {
    rawBody = JSON.stringify({ ...validPage(), padding: 'x'.repeat(512 * 1024) });
    assert.equal((await fetch(base + route)).status, 503);
    rawBody = '{"records":';
    assert.equal((await fetch(base + route)).status, 503);
    rawBody = undefined;
  });
  await t.test('retains HTTP errors, sanitizes failures and refuses redirects', async () => {
    payload = { message: 'private path and fixture-only key' };
    upstreamStatus = 401;
    const failure = await fetch(base + route);
    assert.equal(failure.status, 401);
    assert.deepEqual(await failure.json(), { error: 'Recent movie imports unavailable' });
    upstreamStatus = 404;
    assert.equal((await fetch(base + route)).status, 502, 'Upstream 404 must not look like a missing proxy feature');
    upstreamStatus = 200;
    redirect = true;
    const previousHits = hits;
    assert.equal((await fetch(base + route)).status, 503);
    assert.equal(hits, previousHits + 1, 'Do not follow redirects with API keys');
    redirect = false;
    config = {};
    assert.equal((await fetch(base + route)).status, 503);
  });
});
