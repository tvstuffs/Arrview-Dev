const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/server-harness');
const { standIn } = require('./helpers/stand-in');

// The three command routes forward only what the web app sends, rebuilt from the listed fields; anything else is a 400 and nothing
// reaches the upstream. Cases C1-C5 from the 2026-11-24 scan, the SABnzbd id shape from maintainer note 1 (real ids are UUIDs; one
// token of letters, digits, _ and -, never `all`, no comma) and the id-count cap from maintainer note 2 (10000).

const KEY = 'fixture-only-key-1';
const REFUSED = { error: 'That command is not supported' };
const UUID = '0148c538-bb82-42dd-92fe-14f682a4ee09';
const UUID2 = '7d1e6f0a-2b3c-4d5e-8f90-a1b2c3d4e5f6';
const SAB_VERSION = JSON.stringify({ version: '4.0.0', status: true });

async function setup(t) {
  const arr = await standIn(t, {}, { fallback: '{"id":1}' });
  const sab = await standIn(t, { '/sabnzbd/api': { status: 404, body: '{}' }, '/api': { body: SAB_VERSION } });
  const s = await startServer(t, { config: {
    sonarr: { url: arr.url, apikey: KEY }, radarr: { url: arr.url, apikey: KEY }, sabnzbd: { url: sab.url, apikey: KEY },
  } });
  // The SABnzbd actions, without the path detection's version probes.
  const sabActions = () => sab.hits.filter(h => h.query.mode !== 'version');
  return { s, arr, sab, sabActions };
}
const post = (s, path, body) => s.json('POST', path, body);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function refused(s, path, body, label) {
  const r = await post(s, path, body);
  assert.equal(r.status, 400, label || JSON.stringify(body).slice(0, 120));
  assert.deepEqual(await r.json(), REFUSED, label || JSON.stringify(body).slice(0, 120));
}

test('C1: a Sonarr command the app never sends is refused', async t => {
  const { s, arr } = await setup(t);
  await refused(s, '/api/sonarr/command', { name: 'ApplicationUpdate' });
  assert.deepEqual(arr.hits, []);
});

test('C2: a Radarr command the app never sends is refused', async t => {
  const { s, arr } = await setup(t);
  await refused(s, '/api/radarr/command', { name: 'Backup' });
  assert.deepEqual(arr.hits, []);
});

test('C3: a SABnzbd mode the app never sends is refused, before the path detection', async t => {
  const { s, sab } = await setup(t);
  await refused(s, '/api/sabnzbd/action', { mode: 'restart' });
  assert.deepEqual(sab.hits, []);
});

test('C4: deleting `all` from the SABnzbd queue is refused', async t => {
  const { s, sab } = await setup(t);
  await refused(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: 'all' });
  assert.deepEqual(sab.hits, []);
});

test('C4b: `ALL`, and a comma list of two ids, are refused as the delete value', async t => {
  const { s, sab } = await setup(t);
  await refused(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: 'ALL' });
  await refused(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: `${UUID},${UUID2}` });
  assert.deepEqual(sab.hits, []);
});

test('C5: every command the web app sends reaches the upstream exactly as before', async t => {
  const { s, arr, sabActions } = await setup(t);
  const arrCommands = [
    ['/api/sonarr/command', { name: 'SeriesSearch', seriesId: 5 }],
    ['/api/sonarr/command', { name: 'EpisodeSearch', episodeIds: [11] }],
    ['/api/sonarr/command', { name: 'EpisodeSearch', episodeIds: [11, 12, 13] }],
    ['/api/sonarr/command', { name: 'SeasonSearch', seriesId: 5, seasonNumber: 0 }],
    ['/api/sonarr/command', { name: 'SeasonSearch', seriesId: 5, seasonNumber: 2 }],
    ['/api/radarr/command', { name: 'MoviesSearch', movieIds: [7] }],
    ['/api/radarr/command', { name: 'MoviesSearch', movieIds: [7, 8, 9] }],
  ];
  for (const [path, body] of arrCommands) {
    const r = await post(s, path, body);
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.deepEqual(await r.json(), { id: 1 });
  }
  assert.deepEqual(arr.hits.map(h => [h.method, h.path, JSON.parse(h.body)]),
    arrCommands.map(([, body]) => ['POST', '/api/v3/command', body]));
  assert.ok(arr.hits.every(h => h.key === KEY));

  const sabCommands = [
    [{ mode: 'pause' }, { mode: 'pause' }],
    [{ mode: 'resume' }, { mode: 'resume' }],
  ];
  for (const id of [UUID, 'SABnzbd_nzo_abc123']) {
    sabCommands.push(
      [{ mode: 'pause', nzo_id: id }, { mode: 'queue', name: 'pause', value: id }],
      [{ mode: 'resume', nzo_id: id }, { mode: 'queue', name: 'resume', value: id }],
      [{ mode: 'queue', name: 'delete', value: id }, { mode: 'queue', name: 'delete', value: id }],
    );
  }
  for (const [body] of sabCommands) assert.equal((await post(s, '/api/sabnzbd/action', body)).status, 200, JSON.stringify(body));
  assert.deepEqual(sabActions().map(h => [h.path, h.query]),
    sabCommands.map(([, sent]) => ['/api', { output: 'json', apikey: KEY, ...sent }]));
  // Today's order on the wire, too.
  assert.equal(sabActions()[2].rawQuery, `?output=json&apikey=${KEY}&mode=queue&name=pause&value=${UUID}`);
});

test('C-bounds: commands with ids out of bounds are refused, and nothing is sent', async t => {
  const { s, arr } = await setup(t);
  const sonarr = [
    { name: 'SeriesSearch', seriesId: 0 }, { name: 'SeriesSearch', seriesId: -1 }, { name: 'SeriesSearch', seriesId: 1.5 },
    { name: 'SeriesSearch', seriesId: '5' }, { name: 'SeriesSearch' }, { name: 'SeriesSearch', seriesId: 2 ** 53 },
    { name: 'SeasonSearch', seriesId: 5, seasonNumber: -1 }, { name: 'SeasonSearch', seriesId: 5 },
    { name: 'SeasonSearch', seasonNumber: 1 }, { name: 'SeasonSearch', seriesId: 5, seasonNumber: '1' },
    { seriesId: 5 }, { name: 'seriessearch', seriesId: 5 },
  ];
  for (const body of sonarr) await refused(s, '/api/sonarr/command', body);
  const listCases = [[], 5, '1,2', [0], [-1], [1.5], ['1'], [null], range(1, 10001), undefined];
  for (const [path, name, field] of [['/api/sonarr/command', 'EpisodeSearch', 'episodeIds'], ['/api/radarr/command', 'MoviesSearch', 'movieIds']]) {
    for (const list of listCases) {
      const body = list === undefined ? { name } : { name, [field]: list };
      await refused(s, path, body, `${field} ${Array.isArray(list) && list.length > 20 ? `${list.length} ids` : JSON.stringify(list)}`);
    }
  }
  // Not an object at all.
  for (const body of [[], [{ name: 'SeriesSearch', seriesId: 5 }]]) {
    await refused(s, '/api/sonarr/command', body);
    await refused(s, '/api/radarr/command', body);
  }
  assert.deepEqual(arr.hits, []);
});

test('C-cap: 10000 ids, 1500 ids and the largest body (10000 seven-digit ids) are each sent once, exactly as given', async t => {
  const { s, arr } = await setup(t);
  const lists = [range(1, 10000), range(1, 1500), range(1000000, 1009999)];
  let largest = 0;
  for (const [path, name, field] of [['/api/sonarr/command', 'EpisodeSearch', 'episodeIds'], ['/api/radarr/command', 'MoviesSearch', 'movieIds']]) {
    for (const list of lists) {
      const body = { name, [field]: list };
      largest = Math.max(largest, Buffer.byteLength(JSON.stringify(body)));
      const before = arr.hits.length;
      const r = await post(s, path, body);
      assert.equal(r.status, 200, `${field} ${list.length}`);
      assert.equal(arr.hits.length, before + 1);
      assert.deepEqual(JSON.parse(arr.hits[before].body), body);
    }
  }
  // The largest accepted body (reported in build.md): MoviesSearch with 10000 seven-digit ids, under the 100 kB body limit.
  console.log(`C-cap largest accepted body: ${largest} bytes`);
  assert.ok(largest < 100 * 1024);
});

test('C-extra: fields the app does not send are dropped from the rebuilt body', async t => {
  const { s, arr, sabActions } = await setup(t);
  await post(s, '/api/sonarr/command', { name: 'SeriesSearch', seriesId: 5, extra: 'x', priority: 9 });
  await post(s, '/api/sonarr/command', { seasonNumber: 3, seriesId: 5, name: 'SeasonSearch', trigger: 'scheduled' });
  await post(s, '/api/radarr/command', { name: 'MoviesSearch', movieIds: [7], sendUpdatesToClient: true });
  assert.deepEqual(arr.hits.map(h => h.body), [
    '{"name":"SeriesSearch","seriesId":5}',
    '{"name":"SeasonSearch","seriesId":5,"seasonNumber":3}',
    '{"name":"MoviesSearch","movieIds":[7]}',
  ]);
  await post(s, '/api/sabnzbd/action', { mode: 'pause', name: 'delete', value: 'all', extra: 'x' });
  await post(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: UUID, nzo_id: 'other', del_files: 1 });
  assert.deepEqual(sabActions().map(h => h.query), [
    { output: 'json', apikey: KEY, mode: 'pause' },
    { output: 'json', apikey: KEY, mode: 'queue', name: 'delete', value: UUID },
  ]);
});

test('C-nzo: an nzo id is one token of 1 to 64 letters, digits, _ or -, never `all`', async t => {
  const { s, sab } = await setup(t);
  const bad = ['all', 'All', 'aLL', 'a,b', '', 'a'.repeat(65), 'a b', 'a/b', null, 5, ['x'], { id: 'x' }, true, 'x&mode=shutdown', 'ü'];
  for (const id of bad) {
    for (const mode of ['pause', 'resume']) await refused(s, '/api/sabnzbd/action', { mode, nzo_id: id }, `${mode} ${JSON.stringify(id)}`);
    await refused(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: id }, `delete ${JSON.stringify(id)}`);
  }
  // queue with another name, or no value at all.
  for (const body of [{ mode: 'queue', name: 'purge', value: UUID }, { mode: 'queue', name: 'delete' }, { mode: 'queue' },
    { mode: 'queue', name: 'rename', value: UUID }, {}, { mode: 'shutdown' }, { mode: 'addurl', name: 'http://x.invalid/' }]) {
    await refused(s, '/api/sabnzbd/action', body);
  }
  assert.deepEqual(sab.hits, []);
  // The boundary: exactly 64 characters, and a single one.
  for (const id of ['a'.repeat(64), 'Z', '_', '-x']) {
    assert.equal((await post(s, '/api/sabnzbd/action', { mode: 'pause', nzo_id: id })).status, 200, id);
    assert.equal((await post(s, '/api/sabnzbd/action', { mode: 'queue', name: 'delete', value: id })).status, 200, id);
  }
});
