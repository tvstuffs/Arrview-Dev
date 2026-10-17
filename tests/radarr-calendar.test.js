const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startProxy } = require('./helpers/vm-proxy');

const START = '2026-09-13T00:00:00.000Z';
const END = '2026-09-28T00:00:00.000Z';
const interval = '?start=2026-09-13T00:00:00Z&end=2026-09-28T00:00:00Z';
const route = '/api/radarr/calendar';
const error = 'Radarr calendar unavailable';
const images = [{ coverType: 'banner', url: '/b.jpg' },
  { coverType: 'poster', url: '/MediaCover/1/poster.jpg', remoteUrl: 'https://cdn.example.test/p.jpg', extra: 'drop' },
  { coverType: 'fanart', url: '/MediaCover/1/fanart.jpg', remoteUrl: 'https://cdn.example.test/f.jpg' }];
const movie = (id, dates = {}) => ({
  id, title: `Movie ${id}`, year: 2026, monitored: true, hasFile: false, isAvailable: true, status: 'released',
  inCinemas: '2026-01-01T00:00:00Z', physicalReleaseNote: 'Fixture note', images, ...dates,
  path: '/private/movies', folderName: 'private-folder', overview: 'private overview', sortTitle: 'private sort',
  movieFile: { path: '/private/f.mkv' }, ratings: { imdb: 1 }, tmdbId: 99, imdbId: 'tt0', rootFolderPath: '/private',
});

test('radarr calendar proxy contract', async (t) => {
  const { up, state, base } = await startProxy(t, 'radarr');
  const get = (query = interval) => fetch(base + route + query);
  const ids = async (query) => (await (await get(query)).json()).map(m => m.id);

  await t.test('forwards window, key and the monitored-only policy, nothing else', async () => {
    up.payload = [];
    assert.equal((await get()).status, 200);
    assert.equal(up.last.url.pathname, '/radarr/api/v3/calendar');
    assert.equal(up.last.key, 'fixture-only');
    assert.deepEqual(Object.fromEntries(up.last.url.searchParams), { start: START, end: END, unmonitored: 'false' });
  });

  await t.test('invalid, missing, reversed, equal, oversized and repeated ranges fail before upstream', async () => {
    const before = up.hits;
    for (const query of ['', '?start=bad&end=bad', '?start=2026-09-15&end=2026-09-13', '?start=2026-09-15&end=2026-09-15',
      '?start=2026-01-01&end=2026-12-31', '?start=2026-09-13', interval + '&start=2026-09-14', interval + '&end=2026-09-20']) {
      const response = await get(query);
      assert.equal(response.status, 400, query);
      assert.deepEqual(await response.json(), { error: 'Provide a valid start/end interval of at most 32 days' });
    }
    assert.equal(up.hits, before);
  });

  await t.test('server keeps digital and physical releases in the window, drops cinema-only', async () => {
    up.payload = [
      movie(1, { digitalRelease: '2026-09-20T00:00:00Z' }),
      movie(2, { physicalRelease: '2026-09-21T00:00:00Z' }),
      movie(3, { inCinemas: '2026-09-20T00:00:00Z' }),
      movie(4, { inCinemas: '2026-09-20T00:00:00Z', digitalRelease: '2026-12-01T00:00:00Z' }),
      movie(5, { inCinemas: '2026-01-01T00:00:00Z', digitalRelease: '2026-09-15T00:00:00Z' }),
      movie(6, { digitalRelease: 'not a date', physicalRelease: 12345 }),
      movie(7, { digitalRelease: START }),
      movie(8, { physicalRelease: END }),
      movie(9, { digitalRelease: '2026-09-12T23:59:59.999Z', physicalRelease: '2026-09-28T00:00:00.001Z' }),
      null,
    ];
    assert.deepEqual(await ids(), [1, 2, 5, 7, 8]);
  });

  await t.test('exact allowlist, nulls for absent fields, no leaks', async () => {
    up.payload = [movie(1, { digitalRelease: '2026-09-20T00:00:00Z' }),
      { id: 2, physicalRelease: '2026-09-20T00:00:00Z' }];
    const result = await (await get()).json();
    assert.deepEqual(Object.keys(result[0]).sort(), ['digitalRelease', 'hasFile', 'id', 'images', 'inCinemas', 'isAvailable',
      'monitored', 'physicalRelease', 'physicalReleaseNote', 'status', 'title', 'year']);
    assert.equal(result[0].physicalRelease, null);
    assert.equal(result[0].inCinemas, '2026-01-01T00:00:00Z');
    assert.deepEqual(result[0].images, [
      { coverType: 'poster', url: '/MediaCover/1/poster.jpg', remoteUrl: 'https://cdn.example.test/p.jpg' },
      { coverType: 'fanart', url: '/MediaCover/1/fanart.jpg', remoteUrl: 'https://cdn.example.test/f.jpg' }]);
    assert.deepEqual(result[1], { id: 2, title: null, year: null, monitored: null, hasFile: null, isAvailable: null,
      status: null, inCinemas: null, digitalRelease: null, physicalRelease: '2026-09-20T00:00:00Z',
      physicalReleaseNote: null, images: [] });
    const text = JSON.stringify(result);
    for (const leak of ['/private', 'private overview', 'private sort', 'private-folder', 'fixture-only', 'tmdbId', 'imdbId',
      'ratings', 'movieFile', 'rootFolderPath', 'overview', 'sortTitle', 'extra']) assert.ok(!text.includes(leak), leak);
  });

  await t.test('at most 500 movies, order preserved', async () => {
    up.payload = Array.from({ length: 600 }, (_, i) => movie(i + 1, { digitalRelease: '2026-09-20T00:00:00Z' }));
    const result = await ids();
    assert.equal(result.length, 500);
    assert.deepEqual(result.slice(0, 3), [1, 2, 3]);
    assert.equal(result[499], 500);
  });

  await t.test('empty upstream stays an empty list', async () => {
    up.payload = [];
    assert.deepEqual(await (await get()).json(), []);
  });

  await t.test('non-array upstream gives 502', async () => {
    for (const payload of [{ records: [] }, 'text', null]) {
      up.payload = payload;
      const response = await get();
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error });
    }
  });

  await t.test('oversized, malformed and redirected upstream responses give 503', async () => {
    up.rawBody = JSON.stringify([{ id: 1, padding: 'x'.repeat(4 * 1024 * 1024 + 1024) }]);
    assert.equal((await get()).status, 503);
    up.rawBody = '[{"id":';
    assert.equal((await get()).status, 503);
    up.rawBody = undefined;
    up.redirect = true;
    const before = up.hits;
    assert.equal((await get()).status, 503);
    assert.equal(up.hits, before + 1, 'redirect target must not be requested');
    up.redirect = false;
  });

  await t.test('upstream errors are sanitised', async () => {
    up.payload = { message: 'private path /private and fixture-only key' };
    up.status = 401;
    const response = await get();
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error });
    up.status = 404;
    assert.equal((await get()).status, 502);
    up.status = 200;
  });

  await t.test('unconfigured Radarr reports 503', async () => {
    state.config = {};
    const response = await get();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error });
  });
});
