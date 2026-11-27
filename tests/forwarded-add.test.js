const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Job 013, fix 4: the two adds send a body rebuilt from the listed add fields; the rest of the lookup object is dropped, and
// a missing or invalid required field is a 400 with nothing sent upstream (cases A1-A8, A-bounds). Rework 1 (D102): an
// optional field outside its rule is dropped, not refused, and the app applies its own default.

const KEY = 'fixture-only-key-1';
const INVALID = { error: 'Invalid add request' };

async function setup(t, routes = {}) {
  const up = await standIn(t, routes, { fallback: '{"id":1}' });
  const s = await startServer(t, { config: {
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY },
  } });
  return { s, up };
}

// The lookup objects as the apps answer them, then the body the way AddMediaModal's handleAdd builds it.
const showLookup = () => ({
  title: 'Some Show', tvdbId: 371980, year: 2022, overview: 'An overview.', images: [{ coverType: 'poster', url: '/p.jpg' }],
  statistics: { seasonCount: 2 }, path: '/tv/Some Show', ratings: { votes: 10, value: 8.5 }, genres: ['Drama'],
  network: 'Network', seasons: [{ seasonNumber: 0, monitored: false, statistics: { episodeCount: 1 } }, { seasonNumber: 1, monitored: true }],
  seriesType: 'standard', monitorNewItems: 'all', tags: [], id: 99,
});
const movieLookup = () => ({
  title: 'Some Movie', tmdbId: 693134, year: 2024, images: [{ coverType: 'poster', url: '/p.jpg' }], overview: 'An overview.',
  ratings: { imdb: { value: 8 } }, minimumAvailability: 'released', tags: [], studio: 'Studio', genres: ['Drama'],
});
const showBody = (extra = {}) => ({
  ...showLookup(), id: undefined, qualityProfileId: 1, rootFolderPath: '/tv', monitored: true, seasonFolder: true,
  addOptions: { searchForMissingEpisodes: false, monitor: 'all' }, ...extra,
});
const movieBody = (extra = {}) => ({
  ...movieLookup(), id: undefined, qualityProfileId: 1, rootFolderPath: '/movies', monitored: true,
  addOptions: { searchForMovie: false }, ...extra,
});

// Real lookup objects (Radarr 6.4.4, Sonarr 4.0.20), trimmed to the catalogue fields; posted the way handleAdd builds the body.
const realMovie = require('./fixtures/lookup-radarr.json');
const realShow = require('./fixtures/lookup-sonarr.json');

async function refused(s, up, path, body, label) {
  const r = await s.json('POST', path, body);
  assert.equal(r.status, 400, label);
  assert.deepEqual(await r.json(), INVALID, label);
  assert.equal(up.hits.length, 0, label);
}

// The add goes through, and the upstream body (the latest hit) does not carry `field`; returns that body.
async function droppedField(s, up, path, body, field, label) {
  const before = up.hits.length;
  const r = await s.json('POST', path, body);
  assert.equal(r.status, 200, label);
  assert.equal(up.hits.length, before + 1, label);
  const sent = JSON.parse(up.hits[before].body);
  assert.equal(field in sent, false, label);
  return sent;
}

test('A1 (013): the web app\'s Sonarr add reaches Sonarr with only the add fields', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/sonarr/series', showBody());
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.equal(up.hits[0].path, '/api/v3/series');
  assert.deepEqual(JSON.parse(up.hits[0].body), {
    tvdbId: 371980, title: 'Some Show', qualityProfileId: 1, rootFolderPath: '/tv', monitored: true,
    addOptions: { monitor: 'all', searchForMissingEpisodes: false }, seasonFolder: true,
    seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }],
    seriesType: 'standard', monitorNewItems: 'all', tags: [],
  });
});

test('A2 (013): the web app\'s Radarr add reaches Radarr with only the add fields', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/radarr/movie', movieBody());
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.equal(up.hits[0].path, '/api/v3/movie');
  assert.deepEqual(JSON.parse(up.hits[0].body), {
    tmdbId: 693134, qualityProfileId: 1, rootFolderPath: '/movies', monitored: true, addOptions: { searchForMovie: false },
    title: 'Some Movie', minimumAvailability: 'released', tags: [],
  });
});

test('A3 (013): a Sonarr add without title and a Radarr add without tmdbId are refused', async t => {
  const { s, up } = await setup(t);
  await refused(s, up, '/api/sonarr/series', showBody({ title: undefined }), 'sonarr no title');
  await refused(s, up, '/api/sonarr/series', showBody({ title: null }), 'sonarr null title');
  await refused(s, up, '/api/sonarr/series', showBody({ tvdbId: undefined }), 'sonarr no tvdbId');
  await refused(s, up, '/api/radarr/movie', movieBody({ tmdbId: undefined }), 'radarr no tmdbId');
  await refused(s, up, '/api/radarr/movie', movieBody({ addOptions: undefined }), 'radarr no addOptions');
  await refused(s, up, '/api/radarr/movie', [movieBody()], 'radarr array body');
});

test('A4 (013): a Sonarr add with addOptions.monitor other than all is refused', async t => {
  const { s, up } = await setup(t);
  await refused(s, up, '/api/sonarr/series',
    showBody({ addOptions: { searchForMissingEpisodes: false, monitor: 'none' } }), 'monitor none');
  await refused(s, up, '/api/sonarr/series',
    showBody({ addOptions: { monitor: 'all', searchForMissingEpisodes: 'false' } }), 'search flag string');
});

test('A5 (013 r2): an invalid season is dropped, the valid ones are kept, and no valid season drops the field', async t => {
  const { s, up } = await setup(t);
  await droppedField(s, up, '/api/sonarr/series', showBody({ seasons: [{ seasonNumber: '1', monitored: true }] }), 'seasons',
    'string season');
  await droppedField(s, up, '/api/sonarr/series', showBody({ seasons: [{ seasonNumber: 10000, monitored: true }] }), 'seasons',
    'season 10000');
  await droppedField(s, up, '/api/sonarr/series', showBody({ seasons: 'all' }), 'seasons', 'not a list');
  await droppedField(s, up, '/api/sonarr/series', showBody({ seasons: [] }), 'seasons', 'empty list');
  const r = await s.json('POST', '/api/sonarr/series', showBody({ seasons: [
    { seasonNumber: 1, monitored: true }, { seasonNumber: '2', monitored: true }, null, { seasonNumber: 3, monitored: 'yes' },
    { seasonNumber: 4, monitored: false, statistics: {} },
  ] }));
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(up.hits.at(-1).body).seasons,
    [{ seasonNumber: 1, monitored: true }, { seasonNumber: 4, monitored: false }]);
});

test('A6 (013): a quality profile id given as text is refused on both routes', async t => {
  const { s, up } = await setup(t);
  await refused(s, up, '/api/sonarr/series', showBody({ qualityProfileId: '1' }), 'sonarr');
  await refused(s, up, '/api/radarr/movie', movieBody({ qualityProfileId: '1' }), 'radarr');
});

test('A7 (013 r2): an unknown series type is dropped and the add goes through', async t => {
  const { s, up } = await setup(t);
  const sent = await droppedField(s, up, '/api/sonarr/series', showBody({ seriesType: 'weird' }), 'seriesType', 'seriesType');
  assert.equal(sent.tvdbId, 371980);
  assert.equal(sent.title, 'Some Show');
});

test('A8 (013): Sonarr\'s own validation message still reaches the client (control)', async t => {
  const answer = { status: 400, body: '[{"propertyName":"RootFolderPath","errorMessage":"Root folder \'/etc\' does not exist"}]' };
  const { s, up } = await setup(t, { 'POST /api/v3/series': answer });
  const r = await s.json('POST', '/api/sonarr/series', showBody({ rootFolderPath: '/etc' }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: "Root folder '/etc' does not exist" });
  assert.equal(up.hits.length, 1);
});

test('A-bounds (013 r2): the limits of the add fields; required ones refuse, optional ones are dropped', async t => {
  const { s, up } = await setup(t);
  await refused(s, up, '/api/sonarr/series', showBody({ title: 't'.repeat(501) }), 'title 501');
  await refused(s, up, '/api/sonarr/series', showBody({ rootFolderPath: '/tv\n' }), 'root newline');
  const SHOWS = '/api/sonarr/series';
  const MOVIES = '/api/radarr/movie';
  await droppedField(s, up, MOVIES, movieBody({ title: 't'.repeat(501) }), 'title', 'radarr title 501');
  await droppedField(s, up, SHOWS, showBody({ tags: Array.from({ length: 101 }, (_, i) => i + 1) }), 'tags', 'tags 101');
  await droppedField(s, up, MOVIES, movieBody({ tags: [0] }), 'tags', 'radarr tag 0');
  await droppedField(s, up, SHOWS,
    showBody({ seasons: Array.from({ length: 501 }, (_, i) => ({ seasonNumber: i, monitored: true })) }), 'seasons', 'seasons 501');
  await droppedField(s, up, MOVIES, movieBody({ minimumAvailability: 'tba' }), 'minimumAvailability', 'tba');
  await droppedField(s, up, SHOWS, showBody({ languageProfileId: 0 }), 'languageProfileId', 'languageProfileId 0');
  await droppedField(s, up, SHOWS, showBody({ monitorNewItems: 'some' }), 'monitorNewItems', 'monitorNewItems');
  await droppedField(s, up, SHOWS, showBody({ seasonFolder: 'yes' }), 'seasonFolder', 'seasonFolder');
  const cutoff = await droppedField(s, up, SHOWS,
    showBody({ addOptions: { monitor: 'all', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: 'yes' } }), 'nothing',
    'cutoff flag');
  assert.deepEqual(cutoff.addOptions, { monitor: 'all', searchForMissingEpisodes: false });
  const before = up.hits.length;
  const r = await s.json('POST', '/api/sonarr/series', showBody({ title: 't'.repeat(500), seasons: null, languageProfileId: 1 }));
  assert.equal(r.status, 200);
  const sent = JSON.parse(up.hits[before].body);
  assert.equal(sent.title.length, 500);
  assert.equal(sent.languageProfileId, 1);
  assert.equal('seasons' in sent, false);
});

test('A-real-radarr (013 r2): a real Radarr lookup with minimumAvailability tba is added without that field', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/radarr/movie', {
    ...realMovie, id: undefined, qualityProfileId: 4, rootFolderPath: '/movies', monitored: true,
    addOptions: { searchForMovie: true },
  });
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.deepEqual(JSON.parse(up.hits[0].body), {
    tmdbId: 693134, qualityProfileId: 4, rootFolderPath: '/movies', monitored: true, addOptions: { searchForMovie: true },
    title: 'Dune: Part Two', tags: [],
  });
});

test('A-real-sonarr (013 r2): a real Sonarr lookup is added with its valid fields', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/sonarr/series', {
    ...realShow, id: undefined, qualityProfileId: 4, rootFolderPath: '/tv', monitored: true, seasonFolder: true,
    addOptions: { searchForMissingEpisodes: true, monitor: 'all' },
  });
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.deepEqual(JSON.parse(up.hits[0].body), {
    tvdbId: 371980, title: 'Severance', qualityProfileId: 4, rootFolderPath: '/tv', monitored: true,
    addOptions: { monitor: 'all', searchForMissingEpisodes: true }, seasonFolder: true, seriesType: 'standard',
    languageProfileId: 1, monitorNewItems: 'all', tags: [],
    seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: true }],
  });
});
