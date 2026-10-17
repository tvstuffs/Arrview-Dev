const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startUpstream, startServer } = require('./helpers/server-harness');
const APP_VERSION = require('./helpers/app-version');

const KEY = 'env-fixture-secret-key';
const stored = port => ({
  sonarr: { url: `http://127.0.0.1:${port}/stored-sonarr`, apikey: 'stored-sonarr-key' },
  radarr: { url: `http://127.0.0.1:${port}/stored-radarr`, apikey: 'stored-radarr-key' },
  sabnzbd: { url: `http://127.0.0.1:${port}`, apikey: 'stored-sab-key' },
});
const secretFile = (t, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrview-secret-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'key');
  fs.writeFileSync(file, content);
  return file;
};
const allManaged = (flags = {}) => ({ sonarr: false, radarr: false, sabnzbd: false, nzbhydra: false, ...flags });

test('host-derived address, identify and header routing (criteria 2, 3)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const a = await startServer(t, { env: { ARRVIEW_HOST: 'localhost', ARRVIEW_SONARR_API_KEY: KEY } });
  const cfg = await a.getConfig();
  assert.equal(cfg.sonarr.url, 'http://localhost:8989');
  assert.equal(cfg.sonarr.apikey, '••••' + KEY.slice(-4));
  const identify = await (await fetch(a.base + '/api/arrview/identify')).json();
  assert.deepEqual(identify.services, { sabnzbd: false, sonarr: true, radarr: false, nzbhydra: false });

  const b = await startServer(t, { env: {
    ARRVIEW_HOST: 'localhost', ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_RADARR_API_KEY: KEY,
    ARRVIEW_RADARR_URL: `http://127.0.0.1:${up.port}/radarr/`,
  } });
  const cfgB = await b.getConfig();
  assert.equal(cfgB.radarr.url, `http://127.0.0.1:${up.port}/radarr`);
  assert.equal(cfgB.sonarr.url, 'http://localhost:8989');
  assert.equal((await fetch(b.base + '/api/radarr/movies')).status, 200);
  assert.equal(up.hits.at(-1).path.startsWith('/radarr/api/v3/'), true);
  assert.equal(up.hits.at(-1).key, KEY);

  const c = await startServer(t, { env: { ARRVIEW_SONARR_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_SONARR_API_KEY: KEY } });
  up.hits.length = 0;
  assert.equal((await fetch(c.base + '/api/sonarr/series')).status, 200);
  assert.equal(up.hits[0].path, '/api/v3/series');
  assert.equal(up.hits[0].key, KEY);
});

test('override URL forms and default ports (criterion 4)', async t => {
  const a = await startServer(t, { env: { ARRVIEW_SABNZBD_URL: '127.0.0.1', ARRVIEW_SABNZBD_API_KEY: KEY } });
  assert.equal((await a.getConfig()).sabnzbd.url, 'http://127.0.0.1:8080');
  const b = await startServer(t, { env: { ARRVIEW_SABNZBD_URL: 'https://example.invalid', ARRVIEW_SABNZBD_API_KEY: KEY } });
  assert.equal((await b.getConfig()).sabnzbd.url, 'https://example.invalid');
  const c = await startServer(t, { env: { ARRVIEW_HOST: 'https://[::1]/', ARRVIEW_NZBHYDRA_API_KEY: KEY } });
  assert.equal((await c.getConfig()).nzbhydra.url, 'https://[::1]:5076');
});

test('query, fragment and bad ARRVIEW_HOST values are startup errors (criterion 4b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  for (const bad of ['https://example.invalid/sonarr?token=x', 'https://example.invalid/sonarr#frag']) {
    const s = await startServer(t, {
      config: stored(up.port),
      env: { ARRVIEW_HOST: 'localhost', ARRVIEW_SONARR_URL: bad, ARRVIEW_SONARR_API_KEY: KEY },
    });
    const cfg = await s.getConfig();
    assert.equal(cfg.envManaged.sonarr, false);
    assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
    assert.ok(s.logs.some(l => l.startsWith('[config]') && l.includes('ARRVIEW_SONARR_URL')));
    assert.ok(!s.logs.join('\n').includes(KEY));
  }
  for (const host of ['localhost?x=1', 'localhost#frag', 'localhost:8080', 'http://u:p@localhost', 'localhost/path']) {
    const s = await startServer(t, { env: { ARRVIEW_HOST: host, ARRVIEW_SONARR_API_KEY: KEY } });
    assert.equal((await s.getConfig()).envManaged.sonarr, false);
    assert.ok(s.logs.some(l => l.includes('ARRVIEW_HOST')));
  }
});

test('only services with an env key are managed (criterion 5)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: stored(up.port), env: { ARRVIEW_HOST: 'localhost', ARRVIEW_SONARR_API_KEY: KEY } });
  const cfg = await s.getConfig();
  assert.deepEqual(cfg.envManaged, allManaged({ sonarr: true }));
  assert.equal(cfg.radarr.url, stored(up.port).radarr.url);
  assert.equal(cfg.sabnzbd.url, stored(up.port).sabnzbd.url);
  const none = await startServer(t, { env: { ARRVIEW_HOST: 'localhost' } });
  assert.ok(none.logs.some(l => l.startsWith('[config]') && l.includes('ARRVIEW_HOST')));
  assert.deepEqual((await none.getConfig()).envManaged, allManaged());
});

test('key files and plain key trimming (criteria 6, 6b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const file = secretFile(t, `${KEY}\n`);
  const a = await startServer(t, { env: { ARRVIEW_NZBHYDRA_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_NZBHYDRA_API_KEY_FILE: file } });
  assert.equal((await fetch(a.base + '/api/nzbhydra/status')).status, 200);
  assert.equal(up.hits.at(-1).query.apikey, KEY);

  const b = await startServer(t, { env: { ARRVIEW_SONARR_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_SONARR_API_KEY: `  ${KEY}\n` } });
  assert.equal((await fetch(b.base + '/api/sonarr/series')).status, 200);
  assert.equal(up.hits.at(-1).key, KEY);

  for (const env of [{ ARRVIEW_SONARR_API_KEY: '   ' }, { ARRVIEW_SONARR_API_KEY: '' },
    { ARRVIEW_SONARR_API_KEY_FILE: secretFile(t, '  \n') }]) {
    const s = await startServer(t, { config: stored(up.port), env: { ARRVIEW_HOST: 'localhost', ...env } });
    const cfg = await s.getConfig();
    assert.equal(cfg.envManaged.sonarr, false);
    assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
    assert.ok(s.logs.some(l => l.startsWith('[config]') && l.includes('ARRVIEW_SONARR_API_KEY')));
  }
});

test('conflicting, unreadable and invalid values fall back to config.json (criterion 7)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const file = secretFile(t, 'file-secret-value');
  const cases = [
    [{ ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_SONARR_API_KEY_FILE: file }, ['ARRVIEW_SONARR_API_KEY', 'ARRVIEW_SONARR_API_KEY_FILE']],
    [{ ARRVIEW_SONARR_API_KEY_FILE: path.join(os.tmpdir(), 'arrview-does-not-exist') }, ['ARRVIEW_SONARR_API_KEY_FILE']],
    [{ ARRVIEW_SONARR_API_KEY_FILE: secretFile(t, '') }, ['ARRVIEW_SONARR_API_KEY_FILE']],
    [{ ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_SONARR_URL: 'ftp://example.invalid' }, ['ARRVIEW_SONARR_URL']],
  ];
  for (const [env, names] of cases) {
    const s = await startServer(t, { config: stored(up.port), env: { ARRVIEW_HOST: 'localhost', ...env } });
    const cfg = await s.getConfig();
    assert.equal(cfg.envManaged.sonarr, false);
    assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
    const line = s.logs.find(l => l.startsWith('[config]') && names.every(n => l.includes(n)));
    assert.ok(line, `expected a log naming ${names}`);
    const all = s.logs.join('\n');
    assert.ok(!all.includes(KEY) && !all.includes('file-secret-value'));
  }
});

test('invalid ARRVIEW_HOST only affects services relying on it (criterion 7b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const env = {
    ARRVIEW_HOST: 'http://host:1234', ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_RADARR_API_KEY: KEY,
    ARRVIEW_RADARR_URL: `http://127.0.0.1:${up.port}/radarr`,
  };
  const s = await startServer(t, { config: stored(up.port), env });
  const cfg = await s.getConfig();
  assert.deepEqual(cfg.envManaged, allManaged({ radarr: true }));
  assert.equal(cfg.radarr.url, `http://127.0.0.1:${up.port}/radarr`);
  assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
  assert.ok(s.logs.some(l => l.startsWith('[config]') && l.includes('ARRVIEW_HOST')));
  assert.ok(s.logs.some(l => l.startsWith('[config]') && /sonarr/.test(l) && /no valid address/.test(l)));
  const noOverride = await startServer(t, { env: { ARRVIEW_HOST: 'http://host:1234', ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_RADARR_API_KEY: KEY } });
  assert.deepEqual((await noOverride.getConfig()).envManaged, allManaged());
});

test('half-configured services warn without leaking secrets (criterion 8)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const file = secretFile(t, 'file-secret-value');
  const s = await startServer(t, { config: stored(up.port), env: {
    ARRVIEW_SONARR_API_KEY: KEY,                                   // key, no address
    ARRVIEW_RADARR_URL: 'http://example.invalid',                  // address, no key
    ARRVIEW_NZBHYDRA_API_KEY_FILE: file,                           // file key, no address
  } });
  assert.deepEqual((await s.getConfig()).envManaged, allManaged());
  const config = s.logs.filter(l => l.startsWith('[config]'));
  assert.ok(config.some(l => l.includes('sonarr')));
  assert.ok(config.some(l => l.includes('ARRVIEW_RADARR_URL')));
  assert.ok(config.some(l => l.includes('nzbhydra')));
  const all = s.logs.join('\n');
  assert.ok(!all.includes(KEY) && !all.includes('file-secret-value'));
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
});

test('env-managed service with no stored entry is never written (criterion 12)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const envUrl = `http://127.0.0.1:${up.port}/env-sonarr`;
  const s = await startServer(t, {
    config: { radarr: stored(up.port).radarr },
    env: { ARRVIEW_SONARR_URL: envUrl, ARRVIEW_SONARR_API_KEY: KEY },
  });
  const before = s.readConfigText();
  const body = await s.getConfig();
  for (const bad of [{ url: envUrl + '/other', apikey: body.sonarr.apikey }, { url: envUrl, apikey: 'a-different-key' }]) {
    const r = await s.json('POST', '/api/config', { ...body, sonarr: bad });
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /Docker configuration/);
    assert.equal(s.readConfigText(), before);
  }
  assert.equal((await s.json('POST', '/api/config', body)).status, 200);
  const { sonarr, ...rest } = body;
  assert.equal((await s.json('POST', '/api/config', { radarr: rest.radarr })).status, 200);
  assert.equal((await s.json('POST', '/api/config', { ...body, sonarr: { url: envUrl, apikey: KEY } })).status, 200);
  const text = s.readConfigText();
  assert.ok(!text.includes(KEY) && !text.includes(envUrl));
  assert.equal(s.readConfig().sonarr, undefined);
});

test('env-managed service with a prior stored entry keeps it untouched (criterion 12b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const sentinel = {
    sonarr: { url: 'http://stored.invalid:1111', apikey: 'stored-sentinel-key' },
    sabnzbd: { url: 'http://stored.invalid:2222', apikey: 'stored-sab-sentinel', sabPath: '/sabnzbd/api' },
    radarr: stored(up.port).radarr,
  };
  const s = await startServer(t, { config: sentinel, env: {
    ARRVIEW_SONARR_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_SONARR_API_KEY: KEY,
    ARRVIEW_SABNZBD_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_SABNZBD_API_KEY: KEY,
  } });
  const body = await s.getConfig();
  assert.deepEqual(body.envManaged, allManaged({ sonarr: true, sabnzbd: true }));
  const r = await s.json('POST', '/api/config', { ...body, sabnzbd: { ...body.sabnzbd, sabPath: '/api' } });
  assert.equal(r.status, 200);
  assert.deepEqual(s.readConfig().sonarr, sentinel.sonarr);
  assert.deepEqual(s.readConfig().sabnzbd, sentinel.sabnzbd);
  assert.equal((await s.json('POST', '/api/config', { radarr: body.radarr })).status, 200);
  assert.deepEqual(s.readConfig().sonarr, sentinel.sonarr);
  assert.deepEqual(s.readConfig().sabnzbd, sentinel.sabnzbd);
  const afterOk = s.readConfigText();
  const r409 = await s.json('POST', '/api/config', { ...body, sonarr: { ...body.sonarr, url: 'http://elsewhere.invalid' } });
  assert.equal(r409.status, 409);
  assert.equal(s.readConfigText(), afterOk);
});

test('env-managed SABnzbd never persists detected path or env values (criterion 17)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const url = `http://127.0.0.1:${up.port}`;
  const env = { ARRVIEW_SABNZBD_URL: url, ARRVIEW_SABNZBD_API_KEY: KEY };
  const s = await startServer(t, { config: { radarr: stored(up.port).radarr }, env });
  const before = s.readConfigText();
  assert.equal((await fetch(s.base + '/api/sabnzbd/queue')).status, 200);
  assert.equal(up.hits.some(h => h.path === '/api' && h.query.apikey === KEY), true);
  assert.equal(s.readConfigText(), before);

  // UI-managed SABnzbd still persists the detected sabPath.
  const ui = await startServer(t, { config: { sabnzbd: { url, apikey: 'stored-sab-key' } } });
  assert.equal((await fetch(ui.base + '/api/sabnzbd/queue')).status, 200);
  assert.equal(ui.readConfig().sabnzbd.sabPath, '/api');
});

test('no ARRVIEW_* variables leaves behaviour unchanged (criterion 18)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const cfg = Object.fromEntries(['sabnzbd', 'nzbhydra', 'sonarr', 'radarr'].map(s => [s, { url: `http://127.0.0.1:${up.port}`, apikey: 'stored-key-12345' }]));
  const s = await startServer(t, { config: cfg });
  assert.deepEqual(s.logs.filter(l => l.startsWith('[config]')), []);
  const identify = await (await fetch(s.base + '/api/arrview/identify')).json();
  assert.deepEqual(identify, {
    app: 'arrview', version: APP_VERSION,
    capabilities: ['pwa', 'ping', 'health', 'movieDelete', 'seriesMonitor', 'historyLimit',
      'sonarrQueue', 'radarrQueue', 'episodeStills', 'calendarStills', 'radarrCalendar'],
    services: { sabnzbd: true, sonarr: true, radarr: true, nzbhydra: true },
  });
  assert.deepEqual((await s.getConfig()).envManaged, allManaged());
  assert.equal((await fetch(s.base + '/api/sonarr/series')).status, 200);
  assert.equal(up.hits.at(-1).key, 'stored-key-12345');
});

test('malformed ARRVIEW_HOST values are rejected; overrides stay managed', async t => {
  const up = await startUpstream(); t.after(up.close);
  for (const host of ['999.999.999.999', '[:::]', 'http://[:::]']) {
    const s = await startServer(t, { config: stored(up.port), env: {
      ARRVIEW_HOST: host, ARRVIEW_SONARR_API_KEY: KEY, ARRVIEW_RADARR_API_KEY: KEY,
      ARRVIEW_RADARR_URL: `http://127.0.0.1:${up.port}/radarr`,
    } });
    const cfg = await s.getConfig();
    assert.deepEqual(cfg.envManaged, allManaged({ radarr: true }), host);
    assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
    assert.ok(s.logs.some(l => l.startsWith('[config]') && l.includes('ARRVIEW_HOST')));
  }
});

test('uppercase schemes are normalised so env-managed round trips do not 409', async t => {
  const s = await startServer(t, { env: { ARRVIEW_SONARR_URL: 'HTTPS://example.invalid/sonarr', ARRVIEW_SONARR_API_KEY: KEY } });
  const body = await s.getConfig();
  assert.equal(body.sonarr.url, 'https://example.invalid/sonarr');
  assert.equal((await s.json('POST', '/api/config', body)).status, 200);
  assert.equal((await s.json('POST', '/api/config', { sonarr: { url: 'HTTPS://example.invalid/sonarr/', apikey: KEY } })).status, 200);
});

test('env key needs an alphanumeric character (criterion 6c)', async t => {
  const up = await startUpstream(); t.after(up.close);
  for (const env of [{ ARRVIEW_SONARR_API_KEY: '----' }, { ARRVIEW_SONARR_API_KEY_FILE: secretFile(t, '  ...  \n') }]) {
    const s = await startServer(t, { config: stored(up.port), env: { ARRVIEW_HOST: 'localhost', ...env } });
    const cfg = await s.getConfig();
    assert.equal(cfg.envManaged.sonarr, false);
    assert.equal(cfg.sonarr.url, stored(up.port).sonarr.url);
    const line = s.logs.find(l => l.startsWith('[config]') && l.includes('ARRVIEW_SONARR_API_KEY'));
    assert.ok(line);
    assert.ok(!line.includes('----') && !line.includes('...'));
  }
  const ok = await startServer(t, { env: { ARRVIEW_SONARR_URL: `http://127.0.0.1:${up.port}`, ARRVIEW_SONARR_API_KEY: '  a-b  ' } });
  assert.equal((await fetch(ok.base + '/api/sonarr/series')).status, 200);
  assert.equal(up.hits.at(-1).key, 'a-b');
});
