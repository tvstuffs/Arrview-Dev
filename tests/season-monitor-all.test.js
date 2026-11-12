const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer } = require('./helpers/server-harness');

// PUT /api/sonarr/series/:id/seasons { monitored }: every main season of a show in one press, as the season route does it for one:
// the season's flag and every episode in it. Season 0 (the specials) is left as it is, as Sonarr's own "All Episodes" leaves it.
// Turning it on also turns the show's own flag on when it is off, because Sonarr grabs nothing for an unmonitored series; turning
// it off leaves that flag as it was. Sonarr moves a season's episodes along with the flag only when the flag changes
// (SeriesService.UpdateSeries, read at tag v4.0.20.3014), so what is still different afterwards is set through
// PUT /api/v3/episode/monitor, in one call. The fake below does what Sonarr does.

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
    // A season Sonarr knows about that has no episodes yet: only its flag can be set.
    { seasonNumber: 4, monitored: false, statistics: { episodeCount: 0 } },
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

// A Sonarr for one series. options: cascade (false: an older or different Sonarr that leaves the episodes alone), fail ({ 'PUT
// /api/v3/series/7': [500, { message: 'boom' }] }). Tests change `fake.series` and `fake.episodes` before the request.
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
      return send(200, fake.episodes.filter(ep => season === null || ep.seasonNumber === Number(season)));
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
  fake.flags = () => fake.series.seasons.map(s => s.monitored);
  return fake;
}

async function setup(t, options) {
  const sonarr = await fakeSonarr(t, options);
  const s = await startServer(t, { config: { sonarr: { url: sonarr.url, apikey: KEY } } });
  const put = (path, body, headers = JSON_HEADERS) => fetch(`${s.base}${path}`, { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { sonarr, s, put };
}

test('monitoring every season: one series update that keeps every other field, one read of the episodes, and the ones still unmonitored set in one call', async t => {
  const { sonarr, put } = await setup(t);
  const before = seriesFixture();
  const r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 4 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  // Only the flags that differed change (seasons 2 and 4), and season 0 and every other field are as they came.
  assert.deepEqual(sonarr.hits[1].body, { ...before, seasons: before.seasons.map(season => (season.seasonNumber === 2 || season.seasonNumber === 4 ? { ...season, monitored: true } : season)) });
  // The episodes of every season are read at once, not season by season.
  assert.deepEqual(sonarr.hits[2].query, { seriesId: '7' });
  // Sonarr moved season 2's episodes with its flag; season 3's flag was already set, so its two unmonitored episodes are set here.
  assert.deepEqual(sonarr.hits[3].body, { episodeIds: [301, 302], monitored: true });
  assert.deepEqual(sonarr.monitored(1), [true, true]);
  assert.deepEqual(sonarr.monitored(2), [true, true, true]);
  assert.deepEqual(sonarr.monitored(3), [true, true, true, true]);
  // The specials are left as they are, and so is the show's own flag.
  assert.deepEqual(sonarr.monitored(0), [false]);
  assert.equal(sonarr.series.seasons[0].monitored, false);
  assert.equal(sonarr.series.monitored, true);
  assert.deepEqual(sonarr.flags(), [false, true, true, true, true]);
  assert.ok(sonarr.hits.every(hit => hit.key === KEY));
});

test('monitoring every season also turns the show\'s own flag on when it is off, in the same series update', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.series.monitored = false;
  const r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 4 });
  assert.deepEqual(sonarr.names().filter(name => name === 'PUT /api/v3/series/7'), ['PUT /api/v3/series/7']);
  assert.equal(sonarr.series.monitored, true);
  assert.deepEqual(sonarr.flags(), [false, true, true, true, true]);
});

test('with every season flag already set and the show unmonitored, the show\'s flag alone is written', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.series.monitored = false;
  sonarr.series.seasons.forEach(season => { if (season.seasonNumber > 0) season.monitored = true; });
  const before = JSON.parse(JSON.stringify(sonarr.series));
  assert.equal((await put('/api/sonarr/series/7/seasons', { monitored: true })).status, 200);
  assert.deepEqual(sonarr.hits[1].body, { ...before, monitored: true });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  assert.deepEqual(sonarr.hits[3].body, { episodeIds: [201, 202, 203, 301, 302], monitored: true });
});

test('unmonitoring every season clears their flags and episodes, and leaves the specials and the show\'s own flag as they were', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.episodes.find(ep => ep.id === 100).monitored = true;
  const r = await put('/api/sonarr/series/7/seasons', { monitored: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: false, seasons: 4 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode']);
  assert.deepEqual(sonarr.flags(), [false, false, false, false, false]);
  for (const season of [1, 2, 3]) assert.ok(sonarr.monitored(season).every(flag => flag === false), `season ${season}`);
  assert.deepEqual(sonarr.monitored(0), [true]);
  assert.equal(sonarr.series.monitored, true);

  // An unmonitored show stays unmonitored: only monitoring turns the show's flag on.
  const other = await setup(t);
  other.sonarr.series.monitored = false;
  assert.equal((await other.put('/api/sonarr/series/7/seasons', { monitored: false })).status, 200);
  assert.equal(other.sonarr.series.monitored, false);
});

test('a Sonarr that leaves the episodes alone when a flag changes is completed through the episode route, for every season at once', async t => {
  const { sonarr, put } = await setup(t, { cascade: false });
  assert.equal((await put('/api/sonarr/series/7/seasons', { monitored: true })).status, 200);
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  assert.deepEqual(sonarr.hits[3].body, { episodeIds: [201, 202, 203, 301, 302], monitored: true });
  assert.deepEqual(sonarr.monitored(0), [false]);
});

test('the number of requests to Sonarr does not depend on the number of seasons', async t => {
  const many = async options => {
    const ctx = await setup(t, options);
    ctx.sonarr.series.seasons = [{ seasonNumber: 0, monitored: false }];
    ctx.sonarr.episodes = [{ id: 1, seriesId: 7, seasonNumber: 0, episodeNumber: 1, monitored: false }];
    for (let season = 1; season <= 27; season++) {
      ctx.sonarr.series.seasons.push({ seasonNumber: season, monitored: false });
      for (let episode = 1; episode <= 3; episode++) ctx.sonarr.episodes.push({ id: season * 10 + episode, seriesId: 7, seasonNumber: season, episodeNumber: episode, monitored: false });
    }
    return ctx;
  };
  let { sonarr, put } = await many();
  let r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 27 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode']);
  assert.equal(sonarr.episodes.filter(ep => ep.seasonNumber > 0 && ep.monitored).length, 81);

  ({ sonarr, put } = await many({ cascade: false }));
  r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7', 'GET /api/v3/episode', 'PUT /api/v3/episode/monitor']);
  assert.equal(sonarr.hits[3].body.episodeIds.length, 81);
  assert.equal(sonarr.episodes.find(ep => ep.seasonNumber === 0).monitored, false);
});

test('every season already as asked answers success and writes nothing', async t => {
  const { sonarr, put } = await setup(t);
  sonarr.series.seasons.forEach(season => { if (season.seasonNumber > 0) season.monitored = true; });
  sonarr.episodes.forEach(ep => { if (ep.seasonNumber > 0) ep.monitored = true; });
  const r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { success: true, monitored: true, seasons: 4 });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'GET /api/v3/episode']);
});

test('what is not a series id or a boolean is refused before Sonarr is asked', async t => {
  const { sonarr, put } = await setup(t);
  for (const [path, body] of [
    ['/api/sonarr/series/abc/seasons', { monitored: true }],
    ['/api/sonarr/series/-7/seasons', { monitored: true }],
    ['/api/sonarr/series/7.5/seasons', { monitored: true }],
    ['/api/sonarr/series/7/seasons', { monitored: 'true' }],
    ['/api/sonarr/series/7/seasons', { monitored: 1 }],
    ['/api/sonarr/series/7/seasons', {}],
    ['/api/sonarr/series/7/seasons', [true]],
  ]) {
    const r = await put(path, body);
    assert.equal(r.status, 400, `${path} ${JSON.stringify(body)}`);
    assert.deepEqual(await r.json(), { error: 'A numeric series id and boolean monitored are required' });
  }
  // Not JSON at all: the guard in front of every /api route answers.
  assert.equal((await put('/api/sonarr/series/7/seasons', 'monitored=true', { 'Content-Type': 'text/plain' })).status, 415);
  assert.deepEqual(sonarr.hits, []);
});

test('a series with no main season is a 404 and nothing is written', async t => {
  let { sonarr, put } = await setup(t);
  sonarr.series.seasons = [{ seasonNumber: 0, monitored: false }];
  let r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'No seasons found' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);

  ({ sonarr, put } = await setup(t));
  delete sonarr.series.seasons;
  r = await put('/api/sonarr/series/7/seasons', { monitored: false });
  assert.equal(r.status, 404);
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);
});

test('Sonarr\'s own refusals pass through, and a failure after the flags were set says what was and was not done', async t => {
  let { sonarr, put } = await setup(t, { fail: { 'GET /api/v3/series/7': [404, { message: 'NotFound' }] } });
  let r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'NotFound' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7']);

  ({ sonarr, put } = await setup(t, { fail: { 'PUT /api/v3/series/7': [500, { message: 'boom' }] } }));
  r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'boom' });
  assert.deepEqual(sonarr.names(), ['GET /api/v3/series/7', 'PUT /api/v3/series/7']);

  ({ sonarr, put } = await setup(t, { cascade: false, fail: { 'PUT /api/v3/episode/monitor': [500, { message: 'database is locked' }] } }));
  r = await put('/api/sonarr/series/7/seasons', { monitored: true });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'The seasons were set to monitored, but not all of their episodes: database is locked' });

  ({ sonarr, put } = await setup(t, { fail: { 'GET /api/v3/episode': [503, {}] } }));
  r = await put('/api/sonarr/series/7/seasons', { monitored: false });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /^The seasons were set to unmonitored, but not all of their episodes: /);
});

test('without Sonarr set up the route answers 503 and asks nothing', async t => {
  const s = await startServer(t, { config: {} });
  const r = await fetch(`${s.base}/api/sonarr/series/7/seasons`, { method: 'PUT', headers: JSON_HEADERS, body: '{"monitored":true}' });
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: 'Sonarr not configured' });
});
