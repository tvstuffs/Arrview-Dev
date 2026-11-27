const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Job 013, fix 2: the two release grabs send a body rebuilt from guid, indexerId and the app's own ids; everything else is
// dropped, and a bad request is a 400 with nothing sent upstream (cases G1-G6, G-null).

const KEY = 'fixture-only-key-1';
const INVALID = { error: 'Invalid release' };
const GUID = 'https://indexer.example/details/abc123';

async function setup(t, routes = {}) {
  const up = await standIn(t, routes, { fallback: '{}' });
  const s = await startServer(t, { config: {
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY },
  } });
  return { s, up };
}

// A release as Sonarr's release search answers it, with the route's `_source` added and the two override fields.
const sonarrRelease = () => ({
  guid: GUID, indexerId: 3, title: 'Some.Show.S01E02.1080p', quality: { quality: { id: 7, name: 'WEBDL-1080p' } },
  languages: [{ id: 1, name: 'English' }], rejections: [], episodeIds: [12], seriesId: 4, episodeId: 12, size: 1234,
  indexer: 'Indexer', protocol: 'usenet', approved: true, _source: 'sonarr', shouldOverride: true, downloadClientId: 9,
});
const radarrRelease = () => ({
  guid: GUID, indexerId: 3, title: 'Some.Movie.2024.1080p', quality: { quality: { id: 7, name: 'WEBDL-1080p' } },
  languages: [{ id: 1, name: 'English' }], rejections: [], movieId: 2, size: 1234, indexer: 'Indexer', protocol: 'usenet',
  approved: true, _source: 'radarr', shouldOverride: true, downloadClientId: 9,
});

async function refused(s, up, service, body, label) {
  const r = await s.json('POST', `/api/${service}/release`, body);
  assert.equal(r.status, 400, label);
  assert.deepEqual(await r.json(), INVALID, label);
  assert.equal(up.hits.length, 0, label);
}

test('G1 (013): a whole Sonarr release reaches Sonarr as only guid, indexerId, seriesId and episodeId', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/sonarr/release', sonarrRelease());
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.equal(up.hits[0].path, '/api/v3/release');
  assert.deepEqual(JSON.parse(up.hits[0].body), { guid: GUID, indexerId: 3, seriesId: 4, episodeId: 12 });
});

test('G2 (013): a whole Radarr release reaches Radarr as only guid, indexerId and movieId', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('POST', '/api/radarr/release', radarrRelease());
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.deepEqual(JSON.parse(up.hits[0].body), { guid: GUID, indexerId: 3, movieId: 2 });
});

test('G3 (013): a missing, over-long or multi-line guid is refused; 2000 characters is accepted', async t => {
  const { s, up } = await setup(t);
  for (const service of ['sonarr', 'radarr']) {
    const { guid, ...noGuid } = sonarrRelease();
    await refused(s, up, service, noGuid, `${service} no guid`);
    await refused(s, up, service, { guid: 'g'.repeat(2001), indexerId: 3 }, `${service} 2001`);
    await refused(s, up, service, { guid: 'a\nb', indexerId: 3 }, `${service} newline`);
    await refused(s, up, service, { guid: 'a\u0085b', indexerId: 3 }, `${service} C1`);
    await refused(s, up, service, { guid: '', indexerId: 3 }, `${service} empty`);
    await refused(s, up, service, [{ guid: GUID, indexerId: 3 }], `${service} array body`);
  }
  const r = await s.json('POST', '/api/sonarr/release', { guid: 'g'.repeat(2000), indexerId: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(up.hits[0].body), { guid: 'g'.repeat(2000), indexerId: 3 });
});

test('G4 (013): an indexerId that is not a whole number of 1 or more is refused; 1 is accepted', async t => {
  const { s, up } = await setup(t);
  for (const service of ['sonarr', 'radarr']) {
    for (const indexerId of ['5', 0, 1.5, null, -1]) {
      await refused(s, up, service, { guid: GUID, indexerId }, `${service} ${JSON.stringify(indexerId)}`);
    }
  }
  const r = await s.json('POST', '/api/radarr/release', { guid: GUID, indexerId: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(up.hits[0].body), { guid: GUID, indexerId: 1 });
});

test('G5 (013): an app id of the wrong type is refused', async t => {
  const { s, up } = await setup(t);
  await refused(s, up, 'sonarr', { ...sonarrRelease(), seriesId: 'x' }, 'sonarr seriesId');
  await refused(s, up, 'sonarr', { ...sonarrRelease(), episodeId: 0 }, 'sonarr episodeId');
  await refused(s, up, 'radarr', { ...radarrRelease(), movieId: 'x' }, 'radarr movieId');
});

test('G6 (013): the upstream 404 still reaches the client as before (control)', async t => {
  const notFound = { status: 404, body: '{"message":"Couldn\'t find requested release in cache, try searching again"}' };
  const { s, up } = await setup(t, { 'POST /api/v3/release': notFound });
  for (const service of ['sonarr', 'radarr']) {
    const r = await s.json('POST', `/api/${service}/release`, { guid: GUID, indexerId: 3 });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'Request failed with status code 404' });
  }
  assert.equal(up.hits.length, 2);
});

test('G-null (013): null app ids count as absent and are dropped with the extra fields', async t => {
  const { s, up } = await setup(t);
  let r = await s.json('POST', '/api/sonarr/release', { guid: GUID, indexerId: 3, seriesId: null, episodeId: null, extra: 1 });
  assert.equal(r.status, 200);
  r = await s.json('POST', '/api/radarr/release', { guid: GUID, indexerId: 3, movieId: null, extra: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(up.hits.map(h => JSON.parse(h.body)), [{ guid: GUID, indexerId: 3 }, { guid: GUID, indexerId: 3 }]);
});
