const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Job 013, fix 6: the search terms passed on to NZBHydra, Sonarr and Radarr are bounded; anything else is 400 Invalid query with
// nothing sent (cases Q1-Q6, Q-bounds). Job 012's single-value cases are in upstream-ids.test.js.

const KEY = 'fixture-only-key-1';
const INVALID = { error: 'Invalid query' };

async function setup(t) {
  const up = await standIn(t, { '/api': { body: '{"channel":{"item":[]}}' } }, { fallback: '[]' });
  const s = await startServer(t, { config: {
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY }, nzbhydra: { url: up.url, apikey: KEY },
  } });
  const get = path => fetch(s.base + path);
  return { s, up, get };
}

async function refused(env, path, label = path) {
  const before = env.up.hits.length;
  const r = await env.get(path);
  assert.equal(r.status, 400, label);
  assert.deepEqual(await r.json(), INVALID, label);
  assert.equal(env.up.hits.length, before, label);
}
async function accepted(env, path, upstreamPath, label = path) {
  const before = env.up.hits.length;
  const r = await env.get(path);
  assert.equal(r.status, 200, label);
  assert.ok(env.up.hits.length > before, label);
  assert.equal(env.up.hits[before].path, upstreamPath, label);
  return env.up.hits[before];
}

test('Q1 (013): a 301-character or multi-line q is refused', async t => {
  const env = await setup(t);
  await refused(env, `/api/nzbhydra/search?q=${'a'.repeat(301)}`, 'q 301');
  await refused(env, '/api/nzbhydra/search?q=a%0Ab', 'q newline');
  await refused(env, '/api/nzbhydra/search?q=a%C2%85b', 'q C1');
});

test('Q2 (013): a season or episode that is not 1 to 4 digits is refused', async t => {
  const env = await setup(t);
  await refused(env, '/api/sonarr/release?episodeId=5&seriesTitle=Show&season=1a&episode=2', 'season 1a');
  await refused(env, '/api/sonarr/release?episodeId=5&seriesTitle=Show&season=1&episode=12345', 'episode 12345');
  await refused(env, '/api/sonarr/release?episodeId=5&seriesTitle=Show&season=&episode=2', 'season empty');
});

test('Q3 (013): a year that is not 4 digits is refused, and an empty year is accepted', async t => {
  const env = await setup(t);
  await refused(env, '/api/radarr/release?movieId=2&title=Some%20Movie&year=20', 'year 20');
  const hit = await accepted(env, '/api/radarr/release?movieId=2&title=Some%20Movie&year=', '/api/v3/release', 'year empty');
  assert.equal(hit.query.movieId, '2');
});

test('Q4 (013): a cat that is not digits and commas is refused', async t => {
  const env = await setup(t);
  await refused(env, '/api/nzbhydra/search?q=x&cat=5000,abc', 'cat abc');
  await refused(env, '/api/nzbhydra/search?q=x&cat=5000,', 'cat trailing comma');
});

test('Q5 (013): a lookup term with a control character is refused on both lookups', async t => {
  const env = await setup(t);
  await refused(env, '/api/sonarr/lookup?term=a%07b', 'sonarr');
  await refused(env, '/api/radarr/lookup?term=a%07b', 'radarr');
  await refused(env, '/api/sonarr/lookup?term=', 'sonarr empty');
});

test('Q6 (013): the web app\'s own searches still work (control)', async t => {
  const env = await setup(t);
  let hit = await accepted(env, '/api/nzbhydra/search?q=Some%20Show', '/api');
  assert.equal(hit.query.q, 'Some Show');
  hit = await accepted(env, '/api/sonarr/release?episodeId=12&seriesTitle=Some%20Show&season=1&episode=2', '/api/v3/release');
  assert.equal(hit.query.episodeId, '12');
  // Sonarr found nothing, so the NZBHydra fallback searched with the title, season and episode.
  assert.equal(env.up.hits.at(-1).query.q, 'Some Show S01E02');
  await accepted(env, '/api/sonarr/release?episodeId=12&seriesTitle=Some%20Show&season=0&episode=2', '/api/v3/release', 'specials');
  hit = await accepted(env, '/api/radarr/release?movieId=2&title=Some%20Movie&year=2024', '/api/v3/release');
  assert.equal(env.up.hits.at(-1).query.q, 'Some Movie 2024');
  await accepted(env, '/api/radarr/release?movieId=2&title=Some%20Movie&year=', '/api/v3/release', 'year empty');
  hit = await accepted(env, '/api/sonarr/lookup?term=Severance', '/api/v3/series/lookup');
  assert.equal(hit.query.term, 'Severance');
  hit = await accepted(env, '/api/radarr/lookup?term=Dune', '/api/v3/movie/lookup');
  assert.equal(hit.query.term, 'Dune');
});

test('Q-bounds (013): the edges of the search-term rules', async t => {
  const env = await setup(t);
  await accepted(env, `/api/nzbhydra/search?q=${'a'.repeat(300)}`, '/api', 'q 300');
  const hit = await accepted(env, '/api/nzbhydra/search?q=x&cat=5000,5040', '/api', 'cat two numbers');
  assert.equal(hit.query.cat, '5000,5040');
  await refused(env, `/api/nzbhydra/search?q=x&cat=${Array.from({ length: 21 }, () => '5000').join(',')}`, 'cat 21 numbers');
  await refused(env, '/api/sonarr/release?episodeId=5&seriesTitle=&season=1&episode=2', 'seriesTitle empty');
  await refused(env, '/api/radarr/release?movieId=2&title=', 'title empty');
  await refused(env, `/api/radarr/lookup?term=${'a'.repeat(301)}`, 'term 301');
  // An absent or empty q keeps its own message.
  const r = await env.get('/api/nzbhydra/search?q=');
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Missing query parameter q' });
});
