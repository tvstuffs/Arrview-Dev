const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startUpstream, startServer } = require('./helpers/server-harness');

// config.webhooks.baseUrl is ArrView's own address as Sonarr and Radarr reach it. Settings builds the two
// webhook URLs from it, so the server only stores and validates it: no route reads it.

const services = port => ({
  sonarr: { url: `http://127.0.0.1:${port}/sonarr`, apikey: 'fixture-only-secret' },
  radarr: { url: `http://127.0.0.1:${port}/radarr`, apikey: 'fixture-only-radarr' },
});
const ADDRESS = 'http://192.0.2.10:7777';
const withAddress = port => ({ ...services(port), webhooks: { baseUrl: ADDRESS } });
const save = async (s, webhooks) => s.json('POST', '/api/config', { ...(await s.getConfig()), webhooks });

test('a stored address is returned by GET /api/config and survives the GET then POST round trip', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: withAddress(up.port) });
  assert.deepEqual((await s.getConfig()).webhooks, { baseUrl: ADDRESS });
  const r = await s.json('POST', '/api/config', await s.getConfig());
  assert.equal(r.status, 200);
  assert.deepEqual(s.readConfig().webhooks, { baseUrl: ADDRESS });
  assert.deepEqual(s.tempFiles(), []);
});

test('a saved address is normalised, and a pasted webhook URL is cut back to the address', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  // The same table is in tests/web/webhook-settings.test.jsx for the browser's copy of the rules.
  const cases = [
    ['192.0.2.10:7777', 'http://192.0.2.10:7777'],
    ['  HTTP://nas.example.invalid:7777/  ', 'http://nas.example.invalid:7777'],
    ['https://arrview.example.invalid', 'https://arrview.example.invalid'],
    ['http://[::1]:7777', 'http://[::1]:7777'],
    ['my_arrview:7777', 'http://my_arrview:7777'],
    ['http://nas.example.invalid/arrview/', 'http://nas.example.invalid/arrview'],
    ['http://nas.example.invalid:7777/api/webhooks/sonarr', 'http://nas.example.invalid:7777'],
    ['http://nas.example.invalid:7777/api/webhooks/Radarr/', 'http://nas.example.invalid:7777'],
    ['http://nas.example.invalid:7777/api/webhooks', 'http://nas.example.invalid:7777'],
    ['nas.example.invalid/api/webhooks/sonarr', 'http://nas.example.invalid'],
  ];
  for (const [typed, expected] of cases) {
    const r = await save(s, { baseUrl: typed });
    assert.equal(r.status, 200, typed);
    assert.deepEqual(s.readConfig().webhooks, { baseUrl: expected }, typed);
    assert.deepEqual((await s.getConfig()).webhooks, { baseUrl: expected }, typed);
  }
  // The services are untouched by all of that.
  assert.equal(s.readConfig().sonarr.apikey, 'fixture-only-secret');
  assert.deepEqual(s.tempFiles(), []);
});

test('an address that cannot be one is refused and nothing is written', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: withAddress(up.port) });
  const before = s.readConfigText();
  const bad = [
    { baseUrl: 'ftp://nas.example.invalid' }, { baseUrl: 'http://user:pass@nas.example.invalid' },
    { baseUrl: 'http://nas.example.invalid/?token=x' }, { baseUrl: 'http://nas.example.invalid/#x' },
    { baseUrl: 'http://' }, { baseUrl: 'http:///api/webhooks' }, { baseUrl: 'http://bad host' }, { baseUrl: 'http://bad%20host' },
    { baseUrl: 'http://nas.example.invalid/ar rview' }, { baseUrl: 'http://-bad.example.invalid' }, { baseUrl: 'http://nas.example.invalid.' },
    { baseUrl: 'http://nas.example.invalid/a;b' }, { baseUrl: 'http://nas.example.invalid/$(id)' }, { baseUrl: 'http://nas.example.invalid/a|b' },
    { baseUrl: 'http://nas.example.invalid/`id`' }, { baseUrl: "http://nas.example.invalid/a'b" }, { baseUrl: 'http://nas.example.invalid/a"b' },
    { baseUrl: 'http://nas.example.invalid/a&b' }, { baseUrl: 'http://nas.example.invalid/a\\b' }, { baseUrl: 'http://nas.example.invalid/{x}' },
    { baseUrl: 'http://exämple.invalid' }, { baseUrl: 'http://nas.example.invalid:99999' },
    { baseUrl: 42 }, { baseUrl: {} }, { baseUrl: ['http://ok.invalid'] },
    { baseUrl: ADDRESS, extra: 1 }, { token: 'x' },
    'nope', null, [], 7,
  ];
  for (const webhooks of bad) {
    const r = await save(s, webhooks);
    assert.equal(r.status, 400, JSON.stringify(webhooks));
    assert.equal(typeof (await r.json()).error, 'string', JSON.stringify(webhooks));
    assert.equal(s.readConfigText(), before, JSON.stringify(webhooks));
  }
});

test('a body without webhooks keeps the stored address, and an empty address clears it', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: withAddress(up.port) });

  // A client that does not know the field must not erase it.
  const older = await s.getConfig();
  delete older.webhooks;
  assert.equal((await s.json('POST', '/api/config', older)).status, 200);
  assert.deepEqual(s.readConfig().webhooks, { baseUrl: ADDRESS });

  for (const empty of [{ baseUrl: '' }, { baseUrl: '   ' }, { baseUrl: null }, {}]) {
    assert.equal((await save(s, { baseUrl: ADDRESS })).status, 200);
    assert.deepEqual(s.readConfig().webhooks, { baseUrl: ADDRESS });
    assert.equal((await save(s, empty)).status, 200, JSON.stringify(empty));
    assert.equal('webhooks' in s.readConfig(), false, JSON.stringify(empty));
    assert.equal('webhooks' in (await s.getConfig()), false, JSON.stringify(empty));
  }
});

test('the address can be saved while services are set by the Docker configuration', async t => {
  const s = await startServer(t, { env: { ARRVIEW_HOST: 'localhost', ARRVIEW_SONARR_API_KEY: 'env-fixture-secret-key' } });
  const r = await save(s, { baseUrl: '192.0.2.10:7777' });
  assert.equal(r.status, 200);
  // Values from the environment are never written to config.json.
  assert.deepEqual(s.readConfig(), { webhooks: { baseUrl: ADDRESS } });
  const cfg = await s.getConfig();
  assert.equal(cfg.sonarr.url, 'http://localhost:8989');
  assert.deepEqual(cfg.webhooks, { baseUrl: ADDRESS });
});
