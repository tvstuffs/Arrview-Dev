const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { startUpstream, startServer } = require('./helpers/server-harness');

const SECRET = 'fixture-only-secret';
const MASKED = '••••cret';
const services = port => ({
  sonarr: { url: `http://127.0.0.1:${port}/sonarr`, apikey: SECRET },
  radarr: { url: `http://127.0.0.1:${port}/radarr`, apikey: 'short' },
  sabnzbd: { url: `http://127.0.0.1:${port}`, apikey: 'another-fixture-key', sabPath: '/api' },
});

test('GET /api/config masks keys and reports envManaged (criterion 9)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  const body = await s.getConfig();
  assert.equal(body.sonarr.apikey, MASKED);
  assert.equal(body.radarr.apikey, '••••');
  assert.equal(body.sabnzbd.sabPath, '/api');
  assert.deepEqual(body.envManaged, { sabnzbd: false, nzbhydra: false, sonarr: false, radarr: false });
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes(SECRET) && !raw.includes('another-fixture-key'));
});

test('GET -> POST round-trip keeps stored keys and sabPath (criteria 10, 10b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const original = services(up.port);
  const s = await startServer(t, { config: original });
  const r = await s.json('POST', '/api/config', await s.getConfig());
  assert.equal(r.status, 200);
  const saved = s.readConfig();
  assert.equal(saved.sonarr.apikey, SECRET);
  assert.equal(saved.radarr.apikey, 'short');
  assert.equal(saved.sabnzbd.apikey, 'another-fixture-key');
  assert.equal(saved.sabnzbd.sabPath, '/api');
  assert.deepEqual(s.tempFiles(), []);
  JSON.parse(s.readConfigText());
});

test('masked key with a changed or invalid URL is refused (criteria 11, 11b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  const before = s.readConfigText();
  const body = await s.getConfig();
  const r = await s.json('POST', '/api/config', { ...body, sonarr: { ...body.sonarr, url: 'http://elsewhere.invalid' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /re-entered/);
  for (const url of ['https://example.invalid/sonarr?token=x', 'https://example.invalid/sonarr#frag']) {
    const q = await s.json('POST', '/api/config', { sonarr: { url, apikey: 'plain-new-key' } });
    assert.equal(q.status, 400);
    assert.ok((await q.json()).error);
    const before = up.hits.length;
    const test = await s.json('POST', '/api/test/sonarr', { url, apikey: 'plain-new-key' });
    assert.equal(test.status, 400);
    assert.equal(up.hits.length, before);
  }
  assert.equal(s.readConfigText(), before);
  // A plain key with a changed URL is fine.
  const ok = await s.json('POST', '/api/config', { sonarr: { url: 'elsewhere.invalid:8989/', apikey: 'plain-new-key' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.readConfig(), { sonarr: { url: 'http://elsewhere.invalid:8989', apikey: 'plain-new-key' } });
});

test('POST /api/test/:service masked key reuse (criterion 13)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const other = await startUpstream(); t.after(other.close);
  const stored = await startServer(t, { config: services(up.port) });
  const cfg = await stored.getConfig();
  let r = await stored.json('POST', '/api/test/sonarr', cfg.sonarr);
  assert.equal(r.status, 200);
  assert.equal(up.hits.at(-1).key, SECRET);
  r = await stored.json('POST', '/api/test/sonarr', { url: `http://127.0.0.1:${other.port}/sonarr`, apikey: cfg.sonarr.apikey });
  assert.equal(r.status, 400);
  assert.equal(other.hits.length, 0);

  const envUrl = `http://127.0.0.1:${up.port}/env`;
  const env = await startServer(t, { env: { ARRVIEW_SONARR_URL: envUrl, ARRVIEW_SONARR_API_KEY: 'env-fixture-secret' } });
  const envCfg = await env.getConfig();
  up.hits.length = 0;
  r = await env.json('POST', '/api/test/sonarr', envCfg.sonarr);
  assert.equal(r.status, 200);
  assert.equal(up.hits.at(-1).key, 'env-fixture-secret');
  r = await env.json('POST', '/api/test/sonarr', { url: `http://127.0.0.1:${other.port}`, apikey: envCfg.sonarr.apikey });
  assert.equal(r.status, 400);
  assert.equal(other.hits.length, 0);
  assert.equal((await env.json('POST', '/api/test/unknown', { url: envUrl, apikey: 'plain-key' })).status, 400);
});

const rawRequest = (base, method, path, body, headers) => new Promise((resolve, reject) => {
  const req = http.request(base + path, { method, headers }, res => {
    let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text, type: res.headers['content-type'] }));
  });
  req.on('error', reject);
  req.end(body);
});

test('non-JSON mutating requests get 415 and cannot wipe config (criterion 14)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  const before = s.readConfigText();
  const payload = JSON.stringify({ sonarr: { url: 'http://x.invalid', apikey: 'plain-key' } });
  let r = await s.json('POST', '/api/config', payload, { 'Content-Type': 'text/plain' });
  assert.equal(r.status, 415);
  assert.deepEqual(await r.json(), { error: 'Content-Type must be application/json' });
  r = await rawRequest(s.base, 'POST', '/api/config', payload, {});
  assert.equal(r.status, 415);
  assert.equal(s.readConfigText(), before);
  for (const [method, path] of [['POST', '/api/sabnzbd/action'], ['PUT', '/api/sonarr/episode/monitor'], ['PATCH', '/api/config']]) {
    assert.equal((await s.json(method, path, '{}', { 'Content-Type': 'text/plain' })).status, 415, `${method} ${path}`);
  }
  assert.equal((await s.json('POST', '/api/webhooks/sonarr', 'eventType=Test', { 'Content-Type': 'text/plain' })).status, 200);
  assert.equal(s.readConfigText(), before);
});

test('malformed JSON gets a JSON 400 with no echo (criterion 14c)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  const before = s.readConfigText();
  for (const path of ['/api/config', '/api/test/sonarr', '/api/sabnzbd/action']) {
    const r = await s.json('POST', path, '{not json secret-marker');
    assert.equal(r.status, 400, path);
    assert.match(r.headers.get('content-type'), /application\/json/);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { error: 'Invalid JSON' });
    assert.ok(!text.includes('secret-marker') && !text.includes(' at '));
  }
  assert.equal(up.hits.length, 0);
  assert.equal(s.readConfigText(), before);
});

test('POST /api/config rejects invalid bodies untouched (criterion 15)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const s = await startServer(t, { config: services(up.port) });
  const before = s.readConfigText();
  const good = { url: 'http://example.invalid', apikey: 'plain-key' };
  const bodies = [
    [], { bogus: good }, { sonarr: { ...good, extra: 1 } }, { radarr: { ...good, sabPath: '/api' } },
    { sonarr: { ...good, url: 42 } }, { sonarr: { ...good, url: 'ftp://example.invalid' } },
    { sonarr: { ...good, url: 'http://user:pass@example.invalid' } },
    { sonarr: { ...good, url: 'https://example.invalid/x?y=1' } }, { sonarr: { ...good, url: 'https://example.invalid/x#y' } },
    { sonarr: { ...good, url: '' } }, { sonarr: { ...good, apikey: '' } }, { sonarr: { ...good, apikey: 'bad\u0007key' } },
    { sonarr: { ...good, apikey: 'x'.repeat(257) } }, { sonarr: 'nope' }, { sonarr: null },
  ];
  for (const body of bodies) {
    const r = await s.json('POST', '/api/config', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(typeof (await r.json()).error === 'string');
    assert.equal(s.readConfigText(), before);
  }
  // Invalid sabPath is dropped rather than stored.
  const ok = await s.json('POST', '/api/config', { sabnzbd: { url: 'http://example.invalid', apikey: 'k', sabPath: '/evil' }, envManaged: { sonarr: true } });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.readConfig(), { sabnzbd: { url: 'http://example.invalid', apikey: 'k' } });
});

const failingFs = flag => real => ({
  ...real,
  renameSync: (...args) => { if (flag.rename) throw new Error('rename failed'); return real.renameSync(...args); },
  writeFileSync: (file, ...rest) => {
    if (flag.write && String(file).endsWith('.tmp')) { real.writeFileSync(file, '{partial'); throw new Error('disk full'); }
    return real.writeFileSync(file, ...rest);
  },
});

test('save is atomic and failure-safe (criterion 16)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const ok = await startServer(t, { config: services(up.port) });
  assert.equal((await ok.json('POST', '/api/config', await ok.getConfig())).status, 200);
  assert.deepEqual(ok.tempFiles(), []);
  for (const mode of ['rename', 'write']) {
    const flag = { [mode]: true };
    const s = await startServer(t, { config: services(up.port), fsOverrides: failingFs(flag) });
    const before = s.readConfigText();
    const r = await s.json('POST', '/api/config', await s.getConfig());
    assert.equal(r.status, 500, mode);
    assert.deepEqual(await r.json(), { error: 'Could not save settings' });
    assert.equal(s.readConfigText(), before);
    assert.deepEqual(s.tempFiles(), []);
  }
});

test('_sabPathCache survives failed saves and resets after success (criterion 16b)', async t => {
  const up = await startUpstream(); t.after(up.close);
  const flag = {};
  const config = { sabnzbd: { url: `http://127.0.0.1:${up.port}`, apikey: 'sab-fixture-key' } };
  const env = { ARRVIEW_SONARR_URL: `http://127.0.0.1:${up.port}/env`, ARRVIEW_SONARR_API_KEY: 'env-fixture-secret' };
  const s = await startServer(t, { config, env, fsOverrides: failingFs(flag) });
  const probes = () => up.hits.filter(h => h.query.mode === 'version').length;
  const queue = async () => assert.equal((await fetch(s.base + '/api/sabnzbd/queue')).status, 200);
  await queue();
  assert.ok(probes() > 0);
  // Remove the persisted sabPath so only the in-memory cache can avoid a re-probe.
  fs.writeFileSync(s.configFile, JSON.stringify(config));
  const primed = probes();
  const body = await s.getConfig();

  assert.equal((await s.json('POST', '/api/config', ['bad'])).status, 400);
  assert.equal((await s.json('POST', '/api/config', { ...body, sabnzbd: { ...body.sabnzbd, url: 'http://elsewhere.invalid' } })).status, 400);
  assert.equal((await s.json('POST', '/api/config', { ...body, sonarr: { ...body.sonarr, url: 'http://elsewhere.invalid' } })).status, 409);
  for (const mode of ['rename', 'write']) {
    flag[mode] = true;
    assert.equal((await s.json('POST', '/api/config', body)).status, 500);
    flag[mode] = false;
  }
  await queue();
  assert.equal(probes(), primed, 'cache must survive failed saves');

  const changed = { ...body, sabnzbd: { url: `http://localhost:${up.port}`, apikey: 'sab-fixture-key' } };
  assert.equal((await s.json('POST', '/api/config', changed)).status, 200);
  await queue();
  assert.ok(probes() > primed, 'successful save must re-probe');
});
