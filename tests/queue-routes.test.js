const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startProxy } = require('./helpers/vm-proxy');
const APP_VERSION = require('./helpers/app-version');

const poster = { coverType: 'poster', url: '/MediaCover/1/poster.jpg', remoteUrl: 'https://cdn.example.test/poster.jpg', extra: 'drop' };
const fanart = { coverType: 'fanart', url: '/MediaCover/1/fanart.jpg', remoteUrl: 'https://cdn.example.test/fanart.jpg' };
const images = [{ coverType: 'banner', url: '/b.jpg' }, poster, { coverType: 'poster', url: '/second.jpg' }, fanart, { coverType: 'fanart', url: '/second-fanart.jpg' }];
const privateExtras = {
  outputPath: '/private/downloads/file', statusMessages: [{ title: 'private status' }], errorMessage: 'private error',
  downloadClient: 'private-client', indexer: 'private-indexer', protocol: 'usenet', customFormats: [{ name: 'x' }],
};
const quality = { quality: { id: 7, name: 'WEBDL-1080p', source: 'web' }, revision: { version: 1 } };
const baseRecord = {
  id: 11, title: 'Fixture.Release.1080p', status: 'downloading', size: 1000, sizeleft: 250, timeleft: '00:05:00',
  estimatedCompletionTime: '2026-09-18T12:00:00Z', trackedDownloadStatus: 'ok', trackedDownloadState: 'downloading',
  downloadId: 'SABnzbd_nzo_fixture01', quality, ...privateExtras,
};
const sonarrRecord = () => ({
  ...baseRecord, seriesId: 2, episodeId: 3,
  series: { id: 2, title: 'Fixture Show', year: 2026, images, path: '/private/tv/show', rootFolderPath: '/private/tv',
    overview: 'private overview', statistics: { episodeFileCount: 1 } },
  episode: { id: 3, seasonNumber: 1, episodeNumber: 4, title: 'Fixture Episode', airDateUtc: '2026-09-17T01:00:00Z',
    overview: 'private episode overview', episodeFile: { path: '/private/tv/show/e.mkv' } },
});
const radarrRecord = () => ({
  ...baseRecord, movieId: 5,
  movie: { id: 5, title: 'Fixture Movie', year: 2026, images, path: '/private/movies/m', folderName: 'private-folder',
    overview: 'private overview', movieFile: { path: '/private/movies/m/f.mkv' } },
});

const services = [
  { name: 'sonarr', Name: 'Sonarr', route: '/api/sonarr/queue', record: sonarrRecord,
    flags: { includeSeries: 'true', includeEpisode: 'true' },
    keys: ['downloadId', 'episode', 'episodeId', 'estimatedCompletionTime', 'id', 'quality', 'series', 'seriesId', 'size',
      'sizeleft', 'status', 'timeleft', 'title', 'trackedDownloadState', 'trackedDownloadStatus'],
    embedded: [['series', { id: 2, title: 'Fixture Show', year: 2026 }], ['episode', null]],
    embedKeys: { series: ['id', 'images', 'title', 'year'], episode: ['airDateUtc', 'episodeNumber', 'id', 'seasonNumber', 'title'] } },
  { name: 'radarr', Name: 'Radarr', route: '/api/radarr/queue', record: radarrRecord,
    flags: { includeMovie: 'true' },
    keys: ['downloadId', 'estimatedCompletionTime', 'id', 'movie', 'movieId', 'quality', 'size', 'sizeleft', 'status',
      'timeleft', 'title', 'trackedDownloadState', 'trackedDownloadStatus'],
    embedKeys: { movie: ['id', 'images', 'title', 'year'] } },
];

for (const svc of services) {
  test(`${svc.name} queue proxy contract`, async (t) => {
    const { up, state, base } = await startProxy(t, svc.name);
    const envelope = (records, extra = {}) => ({ page: 1, pageSize: 100, totalRecords: records.length, records, ...extra });
    const get = () => fetch(base + svc.route);
    const error = `${svc.Name} queue unavailable`;

    await t.test('fixed bounded query, key and base path; client parameters ignored', async () => {
      up.payload = envelope([svc.record()], { totalRecords: 250 });
      const response = await fetch(base + svc.route + '?pageSize=5000&page=3&includeSeries=false');
      assert.equal(response.status, 200);
      assert.equal(up.last.url.pathname, `/${svc.name}/api/v3/queue`);
      assert.equal(up.last.key, 'fixture-only');
      assert.deepEqual(Object.fromEntries(up.last.url.searchParams), { page: '1', pageSize: '100', ...svc.flags });
      const result = await response.json();
      assert.equal(result.totalRecords, 250, 'truncation signal is preserved');
      assert.equal(result.records.length, 1);
    });

    await t.test('record allowlist, quality, images and downloadId', async () => {
      up.payload = envelope([svc.record()]);
      const result = await (await get()).json();
      assert.deepEqual(Object.keys(result).sort(), ['page', 'pageSize', 'records', 'totalRecords']);
      const record = result.records[0];
      assert.deepEqual(Object.keys(record).sort(), svc.keys);
      assert.equal(record.downloadId, 'SABnzbd_nzo_fixture01');
      assert.deepEqual(record.quality, { name: 'WEBDL-1080p' });
      assert.equal(record.size, 1000);
      assert.equal(record.sizeleft, 250);
      for (const [key, expected] of Object.entries(svc.embedKeys)) assert.deepEqual(Object.keys(record[key]).sort(), expected);
      const embedded = record.series || record.movie;
      assert.deepEqual(embedded.images, [
        { coverType: 'poster', url: poster.url, remoteUrl: poster.remoteUrl },
        { coverType: 'fanart', url: fanart.url, remoteUrl: fanart.remoteUrl }]);
      if (record.episode) assert.equal(record.episode.title, 'Fixture Episode');
    });

    await t.test('privacy: no paths, client, indexer, overviews or key', async () => {
      up.payload = envelope([svc.record()]);
      const text = JSON.stringify(await (await get()).json());
      for (const leak of ['/private', 'private-client', 'private-indexer', 'private overview', 'private status',
        'private error', 'private-folder', 'fixture-only', 'outputPath', 'statusMessages', 'episodeFile', 'movieFile',
        'rootFolderPath', 'statistics', 'overview', 'indexer', 'downloadClient', 'extra']) {
        assert.ok(!text.includes(leak), `leaked ${leak}`);
      }
    });

    await t.test('downloadId is verbatim or null; missing quality and embedded items are null', async () => {
      const odd = ['SABnzbd_nzo_AbC dEf ', '', undefined, 12345, null].map(downloadId => ({ ...svc.record(), downloadId }));
      const noEmbed = { ...svc.record(), quality: undefined, series: null, episode: undefined, movie: null };
      const noImages = { ...svc.record(), series: { id: 1, images: 'bad' }, movie: { id: 1, images: undefined } };
      up.payload = envelope([...odd, noEmbed, noImages]);
      const records = (await (await get()).json()).records;
      assert.deepEqual(records.slice(0, 5).map(r => r.downloadId), ['SABnzbd_nzo_AbC dEf ', null, null, null, null]);
      assert.equal(records[5].quality, null);
      for (const key of ['series', 'episode', 'movie']) if (key in records[5]) assert.equal(records[5][key], null);
      assert.deepEqual((records[6].series || records[6].movie).images, []);
    });

    await t.test('empty queue is a valid response', async () => {
      up.payload = envelope([]);
      const response = await get();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { page: 1, pageSize: 100, totalRecords: 0, records: [] });
    });

    await t.test('rejects invalid envelopes with 502', async () => {
      const valid = envelope([svc.record()]);
      const bad = [null, [], 'text', { ...valid, page: 2 }, { ...valid, page: '1' }, { ...valid, pageSize: 0 },
        { ...valid, pageSize: 101 }, { ...valid, pageSize: 1.5 }, { ...valid, totalRecords: -1 },
        { ...valid, totalRecords: '1' }, { ...valid, records: {} }, { ...valid, records: undefined },
        { ...valid, pageSize: 1, records: [svc.record(), svc.record()] }, { ...valid, records: [null] }];
      for (const payload of bad) {
        up.payload = payload;
        const response = await get();
        assert.equal(response.status, 502, JSON.stringify(payload)?.slice(0, 60));
        assert.deepEqual(await response.json(), { error });
      }
    });

    await t.test('oversized, malformed and redirected upstream responses give 503', async () => {
      up.rawBody = JSON.stringify({ ...envelope([svc.record()]), padding: 'x'.repeat(4 * 1024 * 1024 + 1024) });
      assert.equal((await get()).status, 503);
      up.rawBody = '{"records":';
      assert.equal((await get()).status, 503);
      up.rawBody = undefined;
      up.redirect = true;
      const before = up.hits;
      assert.equal((await get()).status, 503);
      assert.equal(up.hits, before + 1, 'redirect target must not be requested');
      up.redirect = false;
    });

    await t.test('upstream statuses are retained or mapped, with a fixed message', async () => {
      up.payload = { message: 'private path /private and fixture-only key' };
      up.status = 401;
      let response = await get();
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error });
      up.status = 404;
      assert.equal((await get()).status, 502);
      up.status = 500;
      assert.equal((await get()).status, 500);
      up.status = 200;
    });

    await t.test('unconfigured service reports 503', async () => {
      state.config = {};
      const response = await get();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error });
    });
  });
}

test('identify advertises the new capabilities', async (t) => {
  const { base } = await startProxy(t, 'sonarr');
  const identity = await (await fetch(base + '/api/arrview/identify')).json();
  assert.deepEqual(identity.capabilities, ['pwa', 'ping', 'health', 'movieDelete', 'seriesMonitor', 'historyLimit',
    'sonarrQueue', 'radarrQueue', 'episodeStills', 'calendarStills', 'radarrCalendar', 'auth']);
  assert.equal(identity.version, APP_VERSION);
});
