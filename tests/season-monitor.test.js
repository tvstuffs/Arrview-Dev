const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

// PUT /api/sonarr/series/:id/season/:season { monitored }: a season's monitoring as Sonarr's own season bookmark sets it, the
// season's flag and every episode in it. Sonarr moves the episodes along with the flag only when the flag changes
// (SeriesService.UpdateSeries, read at tag v4.0.20.3014), so a season whose flag is already right while some of its episodes are
// not is completed through PUT /api/v3/episode/monitor. The fake below does what Sonarr does.

const KEY = 'fixture-only-key-1';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const seriesFixture = () => ({
  id: 7, title: 'Fixture Show', path: '/media/tv/Fixture Show', qualityProfileId: 4, seasonFolder: true, monitored: true, tags: [3, 9],
  seriesType: 'standard', somethingNew: { kept: 'as it came' },
  seasons: [
    { seasonNumber: 0, monitored: false, statistics: { episodeCount: 0 } },
    { seasonNumber: 1, monitored: true, statistics: { episodeCount: 2 } },
    { seasonNumber: 2, monitored: false, statistics: { episodeCount: 0 } },
    { seasonNumber: 3, monitored: true, statistics: { episodeCount: 2 } },
  ],
});
const episodesFixture = () => [
  { id: 100, seriesId: 7, seasonNumber: 0, episodeNumber: 1, monitored: false },
  { id: 101, seriesId: 7, seasonNumber: 1, episodeNumber: 1, monitored: true },
  { id: 102, seriesId: 7, seasonNumber: 1, episodeNumber: 2, monitored: true },
  { id: 201, seriesId: 7, seasonNumber: 2, episodeNumber: 1, monitored: false },
  { id: 202, seriesId: 7, seasonNumber: 2, episodeNumber: 2, monitored: false },
  { id: 203, seriesId: 7, seasonNumber: 2, episodeNumber: 3, monitored: false },
  // Season 3: the flag is set, and two of its four episodes were unmonitored one by one.
  { id: 301, seriesId: 7, seasonNumber: 3, episodeNumber: 1, monitored: false },
  { id: 302, seriesId: 7, seasonNumber: 3, episodeNumber: 2, monitored: false },
  { id: 303, seriesId: 7, seasonNumber: 3, episodeNumber: 3, monitored: true },
  { id: 304, seriesId: 7, seasonNumber: 3, episodeNumber: 4, monitored: true },
];

// A Sonarr for one series. options: cascade (false: an older or different Sonarr that leaves the episodes alone), allEpisodes (true:
// the episode list ignores seasonNumber), fail ({ 'PUT /api/v3/series/7': [500, { message: 'boom' }] }).
async function fakeSonarr(t, options = {}) {
  const fake = { series: seriesFixture(), episodes: episodesFixture(), hits: [], fail: options.fail || {} };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://sonarr.invalid');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : null;
    const name = `${req.method} ${url.pathname}`;
    fake.hits.push({ name, query: Object.fromEntries(url.searchParams), key: req.headers['x-api-key'], body });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers['x-api-key'] !== KEY) return send(401, {});
    if (fake.fail[name]) return send(...fake.fail[name]);
    if (name === 'GET /api/v3/series/7') return send(200, fake.series);
    if (name === 'PUT /api/v3/series/7') {
      if (options.cascade !== false) {
        for (const season of body.seasons) {
          const stored = fake.series.seasons.find(s => s.seasonNumber === season.seasonNumber);
          if (stored && stored.monitored !== season.monitored) {
            fake.episodes.filter(ep => ep.seasonNumber === season.seasonNumber).forEach(ep => { ep.monitored = season.monitored; });
          }
        }
      }
      fake.series = body;
      return send(202, body);
    }
    if (name === 'GET /api/v3/episode') {
      const season = url.searchParams.get('seasonNumber');
      return send(200, fake.episodes.filter(ep => options.allEpisodes || season === null || ep.seasonNumber === Number(season)));
    }
    if (name === 'PUT /api/v3/episode/monitor') {
      fake.episodes.filter(ep => body.episodeIds.includes(ep.id)).forEach(ep => { ep.monitored = body.monitored; });
      return send(202, []);
    }
    return send(404, { message: 'NotFound' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.names = () => fake.hits.map(h => h.name);
  fake.monitored = season => fake.episodes.filter(ep => ep.seasonNumber === season).map(ep => ep.monitored);
  return fake;
}

async function setup(t, options) {
  const sonarr = await fakeSonarr(t, options);
  const s = await startServer(t, { config: { sonarr: { url: sonarr.url, apikey: KEY } } });
  const put = (path, body, headers = JSON_HEADERS) => fetch(`${s.base}${path}`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { sonarr, s, put };
}

test('monitoring a season sets its flag in a series update that keeps every other field, and Sonarr moves the episodes', async t => {
  const { sonarr, put } = await setup(t);
  const before = seriesFixture();
  const r = await put('/api/sonarr/series/7/season/2', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true });
  // Read, update, read the season's episodes; nothing left to set, because Sonarr moved them with the flag.
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode']);
  const sent = sonarr.hits[1].body;
  assert.deepEqual(sent, { ...before, seasons: before.seasons.map(season => (season.seasonNumber === 2 ? { ...season, monitored: true } : season)) });
  assert.deepEqual(sonarr.hits[2].query, { seriesId: '7', seasonNumber: '2' });
  assert.deepEqual(sonarr.monitored(2), [true, true, true]);
  // The other seasons are as they were.
  assert.deepEqual(sonarr.monitored(0), [false]);
  assert.deepEqual(sonarr.monitored(1), [true, true]);
  assert.deepEqual(sonarr.monitored(3), [false, false, true, true]);
  assert.ok(sonarr.hits.every(hit => hit.key === KEY));
});

test('a season whose flag is already set while some episodes are not: no series update, and the episodes that differ are set in one call', async t => {
  const { sonarr, put } = await setup(t);
  const r = await put('/api/sonarr/series/7/season/3', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  assert.deepEqual(sonarr.hits[2].body, { episodeIds: [301, 302], monitored: true });
  assert.deepEqual(sonarr.monitored(3), [true, true, true, true]);
  assert.deepEqual(sonarr.series, seriesFixture());
});

test('unmonitoring a season clears its flag and its episodes, and only that season', async t => {
  const { sonarr, put } = await setup(t);
  const r = await put('/api/sonarr/series/7/season/3', { monitored: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: false });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode']);
  assert.equal(sonarr.series.seasons.find(season => season.seasonNumber === 3).monitored, false);
  assert.deepEqual(sonarr.monitored(3), [false, false, false, false]);
  assert.deepEqual(sonarr.monitored(1), [true, true]);
  assert.equal(sonarr.series.monitored, true);
});

test('a Sonarr that leaves the episodes alone when the flag changes is completed through the episode route', async t => {
  const { sonarr, put } = await setup(t, { cascade: false });
  assert.equal((await put('/api/sonarr/series/7/season/2', { monitored: true })).status, 200);
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  assert.deepEqual(sonarr.hits[3].body, { episodeIds: [201, 202, 203], monitored: true });
  assert.deepEqual(sonarr.monitored(2), [true, true, true]);
});

test('an episode list that ignores the season still changes only the season that was asked for', async t => {
  const { sonarr, put } = await setup(t, { allEpisodes: true });
  assert.equal((await put('/api/sonarr/series/7/season/3', { monitored: true })).status, 200);
  assert.deepEqual(sonarr.hits.at(-1).body, { episodeIds: [301, 302], monitored: true });
  assert.deepEqual(sonarr.monitored(0), [false]);
  assert.deepEqual(sonarr.monitored(2), [false, false, false]);
});

test('a season that is already as asked answers success and writes nothing', async t => {
  const { sonarr, put } = await setup(t);
  const r = await put('/api/sonarr/series/7/season/1', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'GET /api/v3/episode']);
});

test('what is not a series id, a season number or a boolean is refused before Sonarr is asked', async t => {
  const { sonarr, put } = await setup(t);
  for (const [path, body] of [
    ['/api/sonarr/series/abc/season/2', { monitored: true }],
    ['/api/sonarr/series/7/season/two', { monitored: true }],
    ['/api/sonarr/series/7/season/-1', { monitored: true }],
    ['/api/sonarr/series/7/season/1.5', { monitored: true }],
    ['/api/sonarr/series/7/season/2', { monitored: 'true' }],
    ['/api/sonarr/series/7/season/2', { monitored: 1 }],
    ['/api/sonarr/series/7/season/2', {}],
    ['/api/sonarr/series/7/season/2', [true]],
  ]) {
    const r = await put(path, body);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.deepEqual(await r.json(), { error: 'A numeric series id, a season number and boolean monitored are required' });
  }
  // Not JSON at all: the guard in front of every /api route answers.
  assert.equal((await put('/api/sonarr/series/7/season/2', 'monitored=true', { 'Content-Type': 'text/plain' })).status, 415);
  assert.deepEqual(sonarr.hits, []);
});

test('a season the series does not have is a 404 and nothing is written', async t => {
  const { sonarr, put } = await setup(t);
  const r = await put('/api/sonarr/series/7/season/9', { monitored: true });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Season 9 not found' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);
});

test('Sonarr\'s own refusals pass through, and a failure after the flag was set says what was and was not done', async t => {
  let { sonarr, put } = await setup(t, { fail: { 'GET /api/v3/series/7': [404, { message: 'NotFound' }] } });
  let r = await put('/api/sonarr/series/7/season/2', { monitored: true });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'NotFound' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);

  ({ sonarr, put } = await setup(t, { fail: { 'PUT /api/v3/series/7': [500, { message: 'boom' }] } }));
  r = await put('/api/sonarr/series/7/season/2', { monitored: true });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'boom' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7']);

  ({ sonarr, put } = await setup(t, { cascade: false, fail: { 'PUT /api/v3/episode/monitor': [500, { message: 'database is locked' }] } }));
  r = await put('/api/sonarr/series/7/season/2', { monitored: true });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Season 2 was set to monitored, but not all of its episodes: database is locked' });

  ({ sonarr, put } = await setup(t, { fail: { 'GET /api/v3/episode': [503, {}] } }));
  r = await put('/api/sonarr/series/7/season/3', { monitored: false });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /^Season 3 was set to unmonitored, but not all of its episodes: /);
});

test('without Sonarr set up the route answers 503 and asks nothing', async t => {
  const s = await startServer(t, { config: {} });
  const r = await fetch(`${s.base}/api/sonarr/series/7/season/2`, { method: 'PUT', headers: JSON_HEADERS, body: '{"monitored":true}' });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Sonarr not configured' });
});

test('identify lists the seasonMonitor capability, so a client can tell that the route exists', async t => {
  const s = await startServer(t, { config: {} });
  const identity = await (await fetch(`${s.base}/api/arrview/identify`)).json();
  assert.ok(identity.capabilities.includes('seasonMonitor'));
  assert.equal(identity.capabilities.at(-1), 'auth');
});
