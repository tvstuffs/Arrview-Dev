const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Job 013, fix 3: the two monitor routes send exactly the id list and the monitored flag; anything else is dropped, and a wrong
// shape is a 400 with nothing sent upstream (cases M1-M6).

const KEY = 'fixture-only-key-1';
const INVALID = { error: 'Invalid monitor request' };
const ROUTES = [
  ['/api/sonarr/episode/monitor', 'episodeIds', '/api/v3/episode/monitor'],
  ['/api/radarr/movie/monitor', 'movieIds', '/api/v3/movie/editor'],
];

async function setup(t) {
  const up = await standIn(t, {}, { fallback: '{}' });
  const s = await startServer(t, { config: {
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY },
  } });
  return { s, up };
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function refused(s, up, path, body, label) {
  const r = await s.json('PUT', path, body);
  assert.equal(r.status, 400, label);
  assert.deepEqual(await r.json(), INVALID, label);
  assert.equal(up.hits.length, 0, label);
}

test('M1 (013): Sonarr receives only the episode ids and the flag', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('PUT', '/api/sonarr/episode/monitor',
    { episodeIds: [1, 2], monitored: false, rootFolderPath: '/x', moveFiles: true });
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.equal(up.hits[0].method, 'PUT');
  assert.equal(up.hits[0].path, '/api/v3/episode/monitor');
  assert.equal(up.hits[0].body, '{"episodeIds":[1,2],"monitored":false}');
});

test('M2 (013): Radarr\'s editor receives only the movie ids and the flag', async t => {
  const { s, up } = await setup(t);
  const r = await s.json('PUT', '/api/radarr/movie/monitor', { movieIds: [3], monitored: true, rootFolderPath: '/x',
    moveFiles: true, qualityProfileId: 1, minimumAvailability: 'released', tags: [1] });
  assert.equal(r.status, 200);
  assert.equal(up.hits.length, 1);
  assert.equal(up.hits[0].path, '/api/v3/movie/editor');
  assert.equal(up.hits[0].body, '{"movieIds":[3],"monitored":true}');
});

test('M3 (013): an empty list, a string id or 10001 ids are refused on both routes', async t => {
  const { s, up } = await setup(t);
  for (const [path, field] of ROUTES) {
    for (const ids of [[], ['1'], range(1, 10001), [0], 'x']) {
      await refused(s, up, path, { [field]: ids, monitored: false }, `${path} ${JSON.stringify(ids).slice(0, 40)}`);
    }
    // The other route's field name is not accepted in place of this one's.
    const other = field === 'episodeIds' ? 'movieIds' : 'episodeIds';
    await refused(s, up, path, { [other]: [1], monitored: false }, `${path} ${other}`);
  }
});

test('M4 (013): a monitored flag that is not a boolean is refused on both routes', async t => {
  const { s, up } = await setup(t);
  for (const [path, field] of ROUTES) {
    await refused(s, up, path, { [field]: [1], monitored: 'false' }, `${path} "false"`);
    await refused(s, up, path, { [field]: [1] }, `${path} missing`);
  }
});

test('M5 (013): an empty or non-object body is refused on both routes', async t => {
  const { s, up } = await setup(t);
  for (const [path] of ROUTES) {
    await refused(s, up, path, {}, `${path} {}`);
    await refused(s, up, path, [1], `${path} array`);
  }
});

test('M6 (013): the web app\'s own bodies still work (control)', async t => {
  const { s, up } = await setup(t);
  let r = await s.json('PUT', '/api/sonarr/episode/monitor', { episodeIds: [12], monitored: false });
  assert.equal(r.status, 200);
  r = await s.json('PUT', '/api/radarr/movie/monitor', { movieIds: [2], monitored: false });
  assert.equal(r.status, 200);
  assert.deepEqual(up.hits.map(h => [h.path, JSON.parse(h.body)]), [
    ['/api/v3/episode/monitor', { episodeIds: [12], monitored: false }],
    ['/api/v3/movie/editor', { movieIds: [2], monitored: false }],
  ]);
});
