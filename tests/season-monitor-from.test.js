const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

// PUT /api/sonarr/series/:id/seasons { monitored: true, fromSeason: N }: "Monitor latest season only" for a continuing show. Every main
// season from N on is monitored (its flag and its episodes: the latest season, and any season Sonarr lists after it before its episodes
// exist, so the show is still followed), every main season before N is unmonitored the same way, season 0 (the specials) is left as it
// is, and the show's own flag is turned on when it is off (Sonarr grabs nothing for an unmonitored series). As for every season at
// once: one series update for the flags that differ, one read of the episodes, and then at most one episode call per direction for
// the episodes Sonarr did not move with their season's flag. The fake below does what Sonarr 4 does (see season-monitor-all.test.js).

const KEY = 'fixture-only-key-1';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const seriesFixture = () => ({
  id: 7, title: 'Fixture Show', status: 'continuing', monitored: true, qualityProfileId: 4, tags: [3], somethingNew: { kept: 'as it came' },
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
    // Season 2: the flag is off, but one episode was monitored one by one.
    { seasonNumber: 2, monitored: false },
    // Season 3, the latest with episodes: the flag is on, but two of its episodes were unmonitored one by one.
    { seasonNumber: 3, monitored: true },
    // Season 4: announced, no episodes yet; only its flag can be set.
    { seasonNumber: 4, monitored: false },
  ],
});
const episodesFixture = () => [
  { id: 100, seriesId: 7, seasonNumber: 0, episodeNumber: 1, monitored: true },
  { id: 101, seriesId: 7, seasonNumber: 1, episodeNumber: 1, monitored: true },
  { id: 102, seriesId: 7, seasonNumber: 1, episodeNumber: 2, monitored: true },
  { id: 201, seriesId: 7, seasonNumber: 2, episodeNumber: 1, monitored: false },
  { id: 202, seriesId: 7, seasonNumber: 2, episodeNumber: 2, monitored: true },
  { id: 301, seriesId: 7, seasonNumber: 3, episodeNumber: 1, monitored: true },
  { id: 302, seriesId: 7, seasonNumber: 3, episodeNumber: 2, monitored: false },
  { id: 303, seriesId: 7, seasonNumber: 3, episodeNumber: 3, monitored: false },
];

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
      // Sonarr moves a season's episodes along with its flag only when the flag changes.
      for (const season of body.seasons) {
        const stored = fake.series.seasons.find(s => s.seasonNumber === season.seasonNumber);
        if (stored && stored.monitored !== season.monitored) {
          fake.episodes.filter(ep => ep.seasonNumber === season.seasonNumber).forEach(ep => { ep.monitored = season.monitored; });
        }
      }
      fake.series = body;
      return send(202, body);
    }
    if (name === 'GET /api/v3/episode') return send(200, fake.episodes);
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
  fake.flags = () => fake.series.seasons.map(s => s.monitored);
  return fake;
}

async function setup(t, options) {
  const sonarr = await fakeSonarr(t, options);
  const s = await startServer(t, { config: { sonarr: { url: sonarr.url, apikey: KEY } } });
  const put = body => fetch(`${s.base}/api/sonarr/series/7/seasons`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });
  return { sonarr, s, put };
}

test('from the latest season: the earlier seasons off, the latest and the announced one after it on, the specials alone', async t => {
  const { sonarr, put } = await setup(t);
  const before = seriesFixture();
  const r = await put({ monitored: true, fromSeason: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 4, fromSeason: 3 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor', 'PUT /api/v3/episode/monitor']);
  // One series update with only the flags that differ (season 1 off, season 4 on); season 0 and every other field as they came.
  assert.deepEqual(sonarr.hits[1].body, { ...before, seasons: before.seasons.map(season =>
    (season.seasonNumber === 1 ? { ...season, monitored: false } : season.seasonNumber === 4 ? { ...season, monitored: true } : season)) });
  assert.deepEqual(sonarr.hits[2].query, { seriesId: '7' });
  // Sonarr moved season 1's episodes with its flag; the episodes it did not move are set here, one call per direction.
  assert.deepEqual(sonarr.hits[3].body, { episodeIds: [302, 303], monitored: true });
  assert.deepEqual(sonarr.hits[4].body, { episodeIds: [202], monitored: false });
  assert.deepEqual(sonarr.flags(), [false, false, false, true, true]);
  assert.deepEqual(sonarr.monitored(1), [false, false]);
  assert.deepEqual(sonarr.monitored(2), [false, false]);
  assert.deepEqual(sonarr.monitored(3), [true, true, true]);
  assert.deepEqual(sonarr.monitored(0), [true], 'the specials are left as they were');
  assert.equal(sonarr.series.monitored, true);
  assert.ok(sonarr.hits.every(hit => hit.key === KEY));
});

test('from the latest season also turns the show\'s own flag on when it is off, in the same series update', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.series.monitored = false;
  const r = await put({ monitored: true, fromSeason: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(sonarr.names().filter(name => name === 'PUT /api/v3/series/7'), ['PUT /api/v3/series/7']);
  assert.equal(sonarr.series.monitored, true);
  assert.deepEqual(sonarr.flags(), [false, false, false, true, true], 'and the seasons as fromSeason asks, not every season');
});

test('a show already monitored from that season on answers success and writes nothing', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.series.seasons = sonarr.series.seasons.map(s => (s.seasonNumber === 0 ? s : { ...s, monitored: s.seasonNumber >= 3 }));
  sonarr.episodes = sonarr.episodes.map(ep => (ep.seasonNumber === 0 ? ep : { ...ep, monitored: ep.seasonNumber >= 3 }));
  const r = await put({ monitored: true, fromSeason: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 4, fromSeason: 3 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'GET /api/v3/episode']);
});

test('a fromSeason that is not a season number of 1 or more, or one sent with monitored false, is refused before Sonarr is asked', async t => {
  const { sonarr, put } = await setup(t);
  for (const body of [{ monitored: true, fromSeason: 0 }, { monitored: true, fromSeason: -2 }, { monitored: true, fromSeason: 2.5 },
    { monitored: true, fromSeason: '3' }, { monitored: true, fromSeason: null }, { monitored: false, fromSeason: 3 }]) {
    const r = await put(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(await r.json(), { error: 'fromSeason must be a season number of 1 or more, sent with monitored true' });
  }
  assert.deepEqual(sonarr.hits, []);
});

test('a fromSeason the show does not have is a 404 and nothing is written', async t => {
  const { sonarr, put } = await setup(t);
  const r = await put({ monitored: true, fromSeason: 9 });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Season 9 not found' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);
});

test('a failure after the flags were set says what was and was not done', async t => {
  const { put } = await setup(t, { fail: { 'PUT /api/v3/episode/monitor': [500, { message: 'database is locked' }] } });
  const r = await put({ monitored: true, fromSeason: 3 });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'Season 3 on was set to monitored and the earlier seasons to unmonitored, but not all of their episodes: database is locked' });
});

test('identify says the server takes fromSeason', async t => {
  const s = await startServer(t, { config: {} });
  const identify = await (await fetch(`${s.base}/api/arrview/identify`)).json();
  assert.ok(identify.capabilities.includes('seasonMonitorFrom'));
});
