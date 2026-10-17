const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startProxy } = require('./helpers/vm-proxy');

test('episodes route also requests images and stays a pass-through', async (t) => {
  const { up, state, base } = await startProxy(t, 'sonarr');
  // The episodes route (unchanged) does not trim trailing slashes, so use a bare base URL.
  state.config.sonarr.url = state.config.sonarr.url.replace(/\/$/, '');
  const route = '/api/sonarr/series/42/episodes';
  const episodes = [{ id: 1, seriesId: 42, seasonNumber: 1, episodeNumber: 2, title: 'Fixture',
    images: [{ coverType: 'screenshot', url: '/MediaCover/42/1/screenshot.jpg' }], path: 'untouched-passthrough' }];

  await t.test('sends seriesId and includeImages only; body is the upstream JSON', async () => {
    up.payload = episodes;
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), episodes);
    assert.equal(up.last.url.pathname, '/sonarr/api/v3/episode');
    assert.equal(up.last.key, 'fixture-only');
    assert.deepEqual(Object.fromEntries(up.last.url.searchParams), { seriesId: '42', includeImages: 'true' });
  });

  await t.test('status mapping is unchanged', async () => {
    up.status = 401;
    assert.equal((await fetch(base + route)).status, 401);
    up.status = 200;
    state.config = {};
    const response = await fetch(base + route);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Sonarr not configured' });
  });
});
