const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// Job 013, fix 5: POST /api/sabnzbd/addurl takes only an http or https link that this server returned from an NZBHydra search
// in the last 24 hours, kept in memory per evaluation of server.js, at most 5000 (cases U1-U8, U-eval).

const KEY = 'fixture-only-key-1';
const NOT_OURS = { error: 'That download link did not come from an ArrView search. Search again and send it from the results.' };
const LINK = 'https://indexer.example/get/1.nzb';
const DAY = 24 * 60 * 60 * 1000;

// One stand-in plays SABnzbd (fixed sabPath /sabnzbd/api), NZBHydra (/api) and Sonarr and Radarr (/api/v3/release, empty).
async function setup(t, { up, now } = {}) {
  const state = { items: [{ title: 'Some.Name', link: LINK, guid: 'g1' }] };
  if (!up) {
    up = await standIn(t, {
      '/api': () => ({ body: JSON.stringify({ channel: { item: state.items } }) }),
      '/sabnzbd/api': { body: '{"status":true}' },
      '/api/v3/release': { body: '[]' },
    });
    up.state = state;
  }
  const clock = { now: now ?? Date.UTC(2026, 10, 27) };
  const s = await startServer(t, { clock: () => clock.now, config: {
    sabnzbd: { url: up.url, apikey: KEY, sabPath: '/sabnzbd/api' },
    nzbhydra: { url: up.url, apikey: KEY },
    sonarr: { url: up.url, apikey: KEY }, radarr: { url: up.url, apikey: KEY },
  } });
  const adds = () => up.hits.filter(h => h.path === '/sabnzbd/api' && h.query.mode === 'addurl');
  const search = async (q = 'x') => {
    const r = await fetch(`${s.base}/api/nzbhydra/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200);
    return r.json();
  };
  const send = body => s.json('POST', '/api/sabnzbd/addurl', body);
  return { s, up, clock, adds, search, send };
}

async function notOurs(env, body, label) {
  const before = env.adds().length;
  const r = await env.send(body);
  assert.equal(r.status, 400, label);
  assert.deepEqual(await r.json(), NOT_OURS, label);
  assert.equal(env.adds().length, before, label);
}

test('U1 (013): a link from the NZB search is accepted and reaches SABnzbd with its name', async t => {
  const env = await setup(t);
  const results = await env.search();
  assert.equal(results[0].link, LINK);
  const r = await env.send({ url: LINK, name: 'Some.Name' });
  assert.equal(r.status, 200);
  assert.equal(env.adds().length, 1);
  assert.equal(env.adds()[0].query.name, LINK);
  assert.equal(env.adds()[0].query.nzbname, 'Some.Name');
});

test('U2 (013): a link from the release searches\' NZBHydra fallback is accepted (Sonarr and Radarr)', async t => {
  const env = await setup(t);
  env.up.state.items = [{ title: 'Show.S01E02', link: 'https://indexer.example/get/show.nzb' }];
  let r = await fetch(`${env.s.base}/api/sonarr/release?episodeId=5&seriesTitle=Show&season=1&episode=2`);
  const [fromSonarr] = await r.json();
  assert.equal(fromSonarr._nzbUrl, 'https://indexer.example/get/show.nzb');
  r = await env.send({ url: fromSonarr._nzbUrl, name: fromSonarr.title });
  assert.equal(r.status, 200);

  env.up.state.items = [{ title: 'Movie.2024', link: 'https://indexer.example/get/movie.nzb' }];
  r = await fetch(`${env.s.base}/api/radarr/release?movieId=2&title=Movie&year=2024`);
  const [fromRadarr] = await r.json();
  assert.equal(fromRadarr._nzbUrl, 'https://indexer.example/get/movie.nzb');
  r = await env.send({ url: fromRadarr._nzbUrl, name: fromRadarr.title });
  assert.equal(r.status, 200);
  assert.deepEqual(env.adds().map(h => h.query.name),
    ['https://indexer.example/get/show.nzb', 'https://indexer.example/get/movie.nzb']);
});

test('U3 (013): a link the server never returned is refused and SABnzbd receives nothing', async t => {
  const env = await setup(t);
  await env.search();
  await notOurs(env, { url: 'https://indexer.example/get/2.nzb', name: 'x' }, 'never returned');
  await notOurs(env, { url: LINK + ' ' }, 'not the exact string');
  // Absent or empty keeps the old message.
  for (const body of [{}, { url: '' }]) {
    const r = await env.send(body);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Missing url' });
  }
  assert.equal(env.adds().length, 0);
});

test('U4 (013): a link is accepted until 24 hours after its search, then refused', async t => {
  const env = await setup(t);
  const searchedAt = env.clock.now;
  await env.search();
  env.clock.now = searchedAt + DAY - 1000;
  assert.equal((await env.send({ url: LINK })).status, 200);
  // Sending it does not refresh its time.
  env.clock.now = searchedAt + DAY + 1000;
  await notOurs(env, { url: LINK }, 'expired');
  // Searching again remembers it again.
  await env.search();
  assert.equal((await env.send({ url: LINK })).status, 200);
});

test('U5 (013): at most 5000 links are kept, and the oldest goes first', async t => {
  const env = await setup(t);
  env.up.state.items = Array.from({ length: 5001 }, (_, i) => ({ title: `n${i + 1}`, link: `https://indexer.example/get/${i + 1}.nzb` }));
  assert.equal((await env.search()).length, 5001);
  await notOurs(env, { url: 'https://indexer.example/get/1.nzb' }, 'oldest dropped');
  assert.equal((await env.send({ url: 'https://indexer.example/get/2.nzb' })).status, 200);
  assert.equal((await env.send({ url: 'https://indexer.example/get/5001.nzb' })).status, 200);
});

test('U6 (013): a url that is not a string or is over 4096 characters is refused', async t => {
  const env = await setup(t);
  const long = 'https://indexer.example/' + 'a'.repeat(4097 - 'https://indexer.example/'.length);
  env.up.state.items = [{ title: 'long', link: long }];
  await env.search();
  await notOurs(env, { url: 5 }, 'number');
  await notOurs(env, { url: ['x'] }, 'array');
  await notOurs(env, { url: long }, '4097 characters, even though the search returned it');
  for (const name of [5, 'n'.repeat(301)]) {
    const r = await env.send({ url: long, name });
    assert.equal(r.status, 400);
  }
  assert.equal(env.adds().length, 0);
});

test('U7 (013): a name loses its control characters on the way to SABnzbd', async t => {
  const env = await setup(t);
  await env.search();
  assert.equal((await env.send({ url: LINK, name: 'A\nB\u0007C' })).status, 200);
  assert.equal((await env.send({ url: LINK, name: '\u0001\u0002' })).status, 200);
  assert.equal((await env.send({ url: LINK, name: null })).status, 200);
  const r = await env.send({ url: LINK, name: 7 });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Invalid name' });
  assert.deepEqual(env.adds().map(h => h.query.nzbname), ['ABC', undefined, undefined]);
});

test('U8 (013): a non-http link is still returned by the search but is not accepted', async t => {
  const env = await setup(t);
  env.up.state.items = [
    { title: 'ftp', link: 'ftp://indexer.example/x.nzb' },
    { title: 'js', link: 'javascript:alert(1)' },
  ];
  const results = await env.search();
  assert.deepEqual(results.map(r => r.link), ['ftp://indexer.example/x.nzb', 'javascript:alert(1)']);
  await notOurs(env, { url: 'ftp://indexer.example/x.nzb' }, 'ftp');
  await notOurs(env, { url: 'javascript:alert(1)' }, 'javascript');
  assert.equal(env.adds().length, 0);
});

test('U-eval (013): each evaluation of server.js keeps its own links', async t => {
  const first = await setup(t);
  await first.search();
  assert.equal((await first.send({ url: LINK })).status, 200);
  const second = await setup(t, { up: first.up });
  await notOurs(second, { url: LINK }, 'second server');
});
