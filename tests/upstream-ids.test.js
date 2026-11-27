const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Every path parameter that goes into an upstream URL or query is digits only (^\d{1,10}$), checked before any request; query
// values sent upstream are single strings, and the ids among them digits only. Cases P1-P6 and Q1-Q2 from the 2026-11-24 scan: on
// 4bc9d46 an encoded slash or question mark in an id reached another Sonarr or Radarr endpoint with the stored key.

const KEY = 'fixture-only-key-1';
const INVALID_ID = { error: 'Invalid id' };

async function setup(t) {
  const up = await standIn(t);
  const hydra = await standIn(t, {}, { fallback: '{"channel":{"item":[]}}' });
  const s = await startServer(t, { config: {
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY }, nzbhydra: { url: hydra.url, apikey: KEY },
  } });
  return { s, up, hydra };
}
const call = (s, method, url) => (method === 'GET' ? fetch(s.base + url)
  : s.json(method, url, method === 'PUT' ? { monitored: true } : undefined));

test('P1: GET /api/sonarr/command/1%2F..%2F..%2Fseries is a 400 and reaches nothing', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'GET', '/api/sonarr/command/1%2F..%2F..%2Fseries');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), INVALID_ID);
  assert.equal(up.hits.length, 0);
});

test('P2: DELETE /api/sonarr/series/1%2F..%2F..%2Fdownloadclient%2F9 is a 400 and reaches nothing', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'DELETE', '/api/sonarr/series/1%2F..%2F..%2Fdownloadclient%2F9');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), INVALID_ID);
  assert.equal(up.hits.length, 0);
});

test('P3: DELETE /api/sonarr/episodefile/1%2F..%2F..%2Fnotification%2F3 is a 400 and reaches nothing', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'DELETE', '/api/sonarr/episodefile/1%2F..%2F..%2Fnotification%2F3');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), INVALID_ID);
  assert.equal(up.hits.length, 0);
});

test('P4: DELETE /api/radarr/moviefile/1%2F..%2F..%2Frootfolder%2F1 is a 400 and reaches nothing', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'DELETE', '/api/radarr/moviefile/1%2F..%2F..%2Frootfolder%2F1');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), INVALID_ID);
  assert.equal(up.hits.length, 0);
});

test('P5: GET /api/sonarr/command/1%3Fx%3Dy is a 400 and reaches nothing', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'GET', '/api/sonarr/command/1%3Fx%3Dy');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), INVALID_ID);
  assert.equal(up.hits.length, 0);
});

test('P6: DELETE /api/radarr/movie/1%2F..%2F..%2Frootfolder%2F1 stays a 400 (control)', async t => {
  const { s, up } = await setup(t);
  const r = await call(s, 'DELETE', '/api/radarr/movie/1%2F..%2F..%2Frootfolder%2F1');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Invalid movie id' });
  assert.equal(up.hits.length, 0);
});

// Each route, with a template for the id, the message it answers, and what a valid id (42) sends upstream today.
const ROUTES = [
  { method: 'GET', url: id => `/api/sonarr/series/${id}/episodes`, error: INVALID_ID,
    ok: { method: 'GET', path: '/api/v3/episode', query: { seriesId: '42', includeImages: 'true' } } },
  { method: 'GET', url: id => `/api/sonarr/command/${id}`, error: INVALID_ID,
    ok: { method: 'GET', path: '/api/v3/command/42', query: {} } },
  { method: 'DELETE', url: id => `/api/sonarr/episodefile/${id}`, error: INVALID_ID,
    ok: { method: 'DELETE', path: '/api/v3/episodefile/42', query: {} } },
  { method: 'DELETE', url: id => `/api/sonarr/series/${id}`, error: INVALID_ID,
    ok: { method: 'DELETE', path: '/api/v3/series/42', query: { deleteFiles: 'false', addImportListExclusion: 'false' } } },
  { method: 'DELETE', url: id => `/api/radarr/moviefile/${id}`, error: INVALID_ID,
    ok: { method: 'DELETE', path: '/api/v3/moviefile/42', query: {} } },
  { method: 'DELETE', url: id => `/api/radarr/movie/${id}`, error: { error: 'Invalid movie id' },
    ok: { method: 'DELETE', path: '/api/v3/movie/42', query: { deleteFiles: 'false', addImportExclusion: 'false' } } },
  { method: 'PUT', url: id => `/api/sonarr/series/${id}`, error: { error: 'A numeric series id and boolean monitored are required' },
    ok: { method: 'GET', path: '/api/v3/series/42', query: {} } },
  { method: 'PUT', url: id => `/api/sonarr/series/${id}/season/1`,
    error: { error: 'A numeric series id, a season number and boolean monitored are required' },
    ok: { method: 'GET', path: '/api/v3/series/42', query: {} } },
  { method: 'PUT', url: id => `/api/sonarr/series/42/season/${id}`,
    error: { error: 'A numeric series id, a season number and boolean monitored are required' },
    ok: { method: 'GET', path: '/api/v3/series/42', query: {} } },
  { method: 'PUT', url: id => `/api/sonarr/series/${id}/seasons`, error: { error: 'A numeric series id and boolean monitored are required' },
    ok: { method: 'GET', path: '/api/v3/series/42', query: {} } },
];

test('P-all: every route with an upstream id refuses anything but 1 to 10 digits, before any request', async t => {
  const { s, up } = await setup(t);
  for (const route of ROUTES) {
    for (const id of ['abc', '1%2F2', '12345678901', '1%3Fx%3D1', '-1', '1.5', '%201']) {
      const r = await call(s, route.method, route.url(id));
      assert.equal(r.status, 400, `${route.method} ${route.url(id)}`);
      assert.deepEqual(await r.json(), route.error, `${route.method} ${route.url(id)}`);
    }
  }
  assert.deepEqual(up.hits, []);
});

test('P-ok: a valid id still reaches the upstream at today\'s path and query', async t => {
  const { s, up } = await setup(t);
  for (const route of ROUTES) {
    const before = up.hits.length;
    await call(s, route.method, route.url('42'));
    const first = up.hits[before];
    assert.ok(first, `${route.method} ${route.url('42')} sent nothing`);
    assert.deepEqual({ method: first.method, path: first.path, query: first.query }, route.ok, route.url('42'));
  }
  // The longest id allowed: 10 digits.
  const before = up.hits.length;
  await call(s, 'GET', '/api/sonarr/command/1234567890');
  assert.equal(up.hits[before].path, '/api/v3/command/1234567890');
});

test('Q1: query values sent upstream must be single strings', async t => {
  const { s, up, hydra } = await setup(t);
  for (const [url, error] of [
    ['/api/sonarr/release?episodeId=1&episodeId=2', INVALID_ID],
    ['/api/sonarr/release?episodeId[a]=1', INVALID_ID],
    ['/api/sonarr/release?episodeId=5&seriesTitle[x]=y', { error: 'Invalid query' }],
    ['/api/sonarr/release?episodeId=5&season[]=1', { error: 'Invalid query' }],
    ['/api/sonarr/release?episodeId=5&episode=1&episode=2', { error: 'Invalid query' }],
    ['/api/radarr/release?movieId=1&movieId=2', INVALID_ID],
    ['/api/radarr/release?movieId=7&title[a]=b', { error: 'Invalid query' }],
    ['/api/radarr/release?movieId=7&year[]=2001', { error: 'Invalid query' }],
    ['/api/sonarr/lookup?term[a]=1', { error: 'Invalid query' }],
    ['/api/radarr/lookup?term=a&term=b', { error: 'Invalid query' }],
    ['/api/nzbhydra/search?q[]=x', { error: 'Invalid query' }],
    ['/api/nzbhydra/search?q=x&cat[a]=1', { error: 'Invalid query' }],
  ]) {
    const r = await fetch(s.base + url);
    assert.equal(r.status, 400, url);
    assert.deepEqual(await r.json(), error, url);
  }
  assert.deepEqual(up.hits, []);
  assert.deepEqual(hydra.hits, []);
});

test('Q2: the release ids are digits only', async t => {
  const { s, up } = await setup(t);
  for (const url of ['/api/sonarr/release?episodeId=abc', '/api/radarr/release?movieId=1%2F2', '/api/sonarr/release?episodeId=12345678901',
    '/api/radarr/release?movieId=']) {
    const r = await fetch(s.base + url);
    assert.equal(r.status, 400, url);
    assert.deepEqual(await r.json(), INVALID_ID, url);
  }
  assert.deepEqual(up.hits, []);
});

test('Q-ok: the web app\'s own queries reach the upstream as today', async t => {
  const { s, up, hydra } = await setup(t);
  let r = await fetch(s.base + '/api/sonarr/release?episodeId=5&seriesTitle=Show&season=1&episode=2');
  assert.equal(r.status, 200);
  r = await fetch(s.base + '/api/radarr/release?movieId=7&title=Movie&year=');
  assert.equal(r.status, 200);
  await fetch(s.base + '/api/sonarr/lookup?term=Show');
  await fetch(s.base + '/api/radarr/lookup?term=Movie');
  assert.deepEqual(up.hits.map(h => [h.method, h.path, h.query]), [
    ['GET', '/api/v3/release', { episodeId: '5' }],
    ['GET', '/api/v3/release', { movieId: '7' }],
    ['GET', '/api/v3/series/lookup', { term: 'Show' }],
    ['GET', '/api/v3/movie/lookup', { term: 'Movie' }],
  ]);
  // Both fell back to NZBHydra (the stand-in found nothing), with the same search as before.
  assert.deepEqual(hydra.hits.map(h => h.query.q), ['Show S01E02', 'Movie']);
  r = await fetch(s.base + '/api/nzbhydra/search?q=Show&cat=5000');
  assert.equal(r.status, 200);
  assert.deepEqual(hydra.hits.at(-1).query, { t: 'search', q: 'Show', o: 'json', apikey: KEY, cat: '5000' });
});
