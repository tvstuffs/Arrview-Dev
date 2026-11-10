const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const axios = require('axios');
const { startServer } = require('./helpers/server-harness');
const { startSeeded, AJAX, JSON_HEADERS } = require('./helpers/auth-helpers');
const urlTable = require('./fixtures/webhook-urls.json');

// GET, POST and DELETE /api/webhook-setup/:service read Sonarr's or Radarr's connection list with the stored key and
// create or remove the ArrView webhook there. The fakes below behave as the real apps did on the maintainer's rig
// (Sonarr 4.0.20.3014, Radarr 6.4.4.10685): the live Webhook template with every trigger, a list ordered by name in
// which only passwords are masked, unique names compared without case across every kind of connection but checked
// before a slow test (so two creates can both pass), a 400 array or a 500 { message, description } when the test
// fails, the Test message posted to ArrView before the create answers, and 200 {} for any delete.
// The real apps also say who they are in GET /api/v3/system/status. A fake answers that only in a test that sets its
// statusAnswer; everywhere else the request gets the 404 of a path the fake does not have, which must change nothing.

const ADDRESS = 'http://arrview.example:7777';
const target = service => `${ADDRESS}/api/webhooks/${service}`;
const SERVER_TEXT = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

const LIVE_TRIGGERS = {
  sonarr: ['onGrab', 'onDownload', 'onUpgrade', 'onImportComplete', 'onRename', 'onSeriesAdd', 'onSeriesDelete', 'onEpisodeFileDelete',
    'onEpisodeFileDeleteForUpgrade', 'onHealthIssue', 'onHealthRestored', 'onApplicationUpdate', 'onManualInteractionRequired'],
  radarr: ['onGrab', 'onDownload', 'onUpgrade', 'onRename', 'onMovieAdded', 'onMovieDelete', 'onMovieFileDelete', 'onMovieFileDeleteForUpgrade',
    'onHealthIssue', 'onHealthRestored', 'onApplicationUpdate', 'onManualInteractionRequired'],
};
const WANTED = {
  sonarr: ['onDownload', 'onUpgrade', 'onRename', 'onSeriesAdd', 'onSeriesDelete', 'onEpisodeFileDelete'],
  radarr: ['onDownload', 'onUpgrade', 'onRename', 'onMovieAdded', 'onMovieDelete', 'onMovieFileDelete'],
};
const supportsFlag = field => `supports${field.charAt(0).toUpperCase()}${field.slice(1)}`;
// Who each app says it is, as far as ArrView reads it (the real answers have about thirty fields).
const STATUS_PATH = '/api/v3/system/status';
const STATUS = {
  sonarr: { appName: 'Sonarr', instanceName: 'Sonarr', version: '4.0.20.3014' },
  radarr: { appName: 'Radarr', instanceName: 'Radarr', version: '6.4.4.10685' },
};

function webhookTemplate(service, supports = {}) {
  const template = {};
  for (const field of LIVE_TRIGGERS[service]) template[field] = false;
  template.includeHealthWarnings = false;
  for (const field of LIVE_TRIGGERS[service]) template[supportsFlag(field)] = supports[field] ?? true;
  return Object.assign(template, {
    name: '',
    fields: [
      { order: 0, name: 'url', label: 'Webhook URL', type: 'url', advanced: false, privacy: 'normal', isFloat: false },
      { order: 1, name: 'method', label: 'Method', value: 1, type: 'select', advanced: false,
        selectOptions: [{ value: 1, name: 'POST', order: 1 }, { value: 2, name: 'PUT', order: 2 }], privacy: 'normal', isFloat: false },
      { order: 2, name: 'username', label: 'Username', type: 'textbox', advanced: false, privacy: 'userName', isFloat: false },
      { order: 3, name: 'password', label: 'Password', type: 'password', advanced: false, privacy: 'password', isFloat: false },
      { order: 4, name: 'headers', label: 'Headers', value: [], type: 'keyValueList', advanced: true, privacy: 'normal', isFloat: false },
    ],
    implementationName: 'Webhook', implementation: 'Webhook', configContract: 'WebhookSettings',
    infoLink: 'https://wiki.example/webhook', tags: [], presets: [],
  });
}
const DISCORD_TEMPLATE = { name: '', implementation: 'Discord', implementationName: 'Discord', configContract: 'DiscordSettings',
  fields: [{ name: 'webHookUrl', privacy: 'normal' }], tags: [], presets: [] };

// A stored connection as the list gives it (the fake keeps the real values; only a password is masked on the way out).
const webhookEntry = (id, name, url, extra = {}) => ({ id, name, implementation: 'Webhook', implementationName: 'Webhook',
  configContract: 'WebhookSettings', tags: [], onDownload: true,
  fields: [{ name: 'url', value: url }, { name: 'method', value: 1 }, { name: 'username' }, { name: 'password' }, { name: 'headers', value: [] }], ...extra });
const discordEntry = (id, name, token) => ({ id, name, implementation: 'Discord', implementationName: 'Discord', configContract: 'DiscordSettings',
  tags: [], fields: [{ name: 'webHookUrl', value: `https://discord.example/hooks/${token}` }, { name: 'username', value: 'Bot' }] });

const UNIQUE = name => ({ propertyName: 'Name', errorMessage: 'Should be unique', attemptedValue: name, severity: 'error',
  errorCode: 'PredicateValidator', formattedMessageArguments: [], formattedMessagePlaceholderValues: { propertyName: 'Name', propertyValue: name } });
const DESCRIPTION_MARKER = 'STACKTRACE-MARKER-c0ffee';
const DESCRIPTION = `System.Net.WebException: Http request timed out\n ---> ${DESCRIPTION_MARKER} at /build/src/NzbDrone.Common/Http/HttpClient.cs:line 140\n${'   at Frame.Method()\n'.repeat(200)}`;

const sortedByName = list => [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
const readBack = entry => {
  const copy = JSON.parse(JSON.stringify(entry));
  for (const field of copy.fields || []) if (field && field.name === 'password' && 'value' in field) field.value = '********';
  return copy;
};

async function startFakeArr(t, service) {
  const fake = {
    service, key: `fake-${service}-key-5ec4e7`, hits: [], list: [], nextId: 1, supports: {},
    create: 'ok', postTest: true, arrview: null, gate: null, deleteKeeps: false,
    listAnswer: null, schemaAnswer: null, onSchema: null, deleteAnswer: null, message: null,
    statusAnswer: null, statusReads: [],
    hold() { fake.gate = new Promise(resolve => { fake.release = () => { fake.gate = null; resolve(); }; }); },
    creates: () => fake.hits.filter(h => h.method === 'POST' && h.path === '/api/v3/notification'),
    deletes: () => fake.hits.filter(h => h.method === 'DELETE'),
    named: name => fake.list.filter(e => String(e.name).toLowerCase() === name.toLowerCase()),
  };
  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  const save = body => {
    const stored = { ...body, id: fake.nextId++ };
    fake.list.push(stored);
    fake.hits.push({ method: 'SAVED', id: stored.id });
    return stored;
  };
  const postTest = async () => {
    if (!fake.postTest) return;
    await fetch(`${fake.arrview}/api/webhooks/${service}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'Test', instanceName: service === 'sonarr' ? 'Sonarr' : 'Radarr', applicationUrl: '' }) });
  };
  async function create(body, res) {
    // The name is checked first, then the (slow) test runs, then it is saved: two creates can both pass the check.
    if (fake.named(String(body?.name ?? '')).length) return send(res, 400, [UNIQUE(body.name)]);
    // The connection to the caller is lost at once, but the app goes on and saves it later.
    if (fake.create === 'resetThenSave') {
      res.socket.destroy();
      if (fake.gate) await fake.gate;
      await postTest();
      save(body);
      return undefined;
    }
    if (fake.gate) await fake.gate;
    const url = body.fields.find(f => f.name === 'url')?.value;
    switch (fake.create) {
      case 'receiver404': return send(res, 400, [{ propertyName: 'Url', errorMessage: `Unable to send test message: Unable to post to webhook: HTTP request failed: [404:NotFound] [POST] at [${url}]`, severity: 'error', isWarning: false }]);
      case 'invalidUrl': return send(res, 400, [{ propertyName: 'Url', errorMessage: "Invalid Url: 'not-a-url'", attemptedValue: 'not-a-url', severity: 'error', isWarning: false }]);
      case 'unique': return send(res, 400, [UNIQUE('ArrView')]);
      case 'refused500': return send(res, 500, { message: fake.message || 'Connection refused (arrview.example:7777)', description: DESCRIPTION });
      case 'html500': res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end(`<html><body>${DESCRIPTION_MARKER}</body></html>`);
      case 'key401': res.writeHead(401); return res.end();
      case 'hang': return undefined;
      case 'saveThenHang': await postTest(); save(body); return undefined;
      case 'noId': await postTest(); save(body); return send(res, 201, { saved: true });
      default: {
        await postTest();
        const stored = save(body);
        return send(res, 201, readBack(stored), { Location: `http://127.0.0.1/api/v3/notification/${stored.id}` });
      }
    }
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake.invalid');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    // Who the app is gets asked ahead of its connection list. Those reads are kept apart, each with the number of connection requests
    // that came before it, so `hits` stays the traffic on the connection API that the tests read request by request.
    const identity = req.method === 'GET' && url.pathname === STATUS_PATH;
    if (identity) fake.statusReads.push({ key: req.headers['x-api-key'], search: url.search, before: upstreamPaths(fake).length });
    else fake.hits.push({ method: req.method, path: url.pathname, search: url.search, body, raw: text, key: req.headers['x-api-key'] });
    if (req.headers['x-api-key'] !== fake.key) { res.writeHead(401); return res.end(); }
    if (identity && fake.statusAnswer) return fake.statusAnswer(res, url);
    if (req.method === 'GET' && url.pathname === '/api/v3/notification') {
      if (fake.listAnswer) return fake.listAnswer(res);
      return send(res, 200, sortedByName(fake.list).map(readBack));
    }
    if (req.method === 'GET' && url.pathname === '/api/v3/notification/schema') {
      if (fake.onSchema) fake.onSchema();
      if (fake.schemaAnswer) return fake.schemaAnswer(res);
      return send(res, 200, [DISCORD_TEMPLATE, webhookTemplate(service, fake.supports)]);
    }
    if (req.method === 'POST' && url.pathname === '/api/v3/notification') return create(body, res);
    const match = /^\/api\/v3\/notification\/(\d+)$/.exec(url.pathname);
    if (req.method === 'DELETE' && match) {
      if (fake.deleteAnswer) return fake.deleteAnswer(res);
      if (!fake.deleteKeeps) fake.list = fake.list.filter(e => e.id !== Number(match[1]));
      return send(res, 200, {});
    }
    return send(res, 404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fake.port = server.address().port;
  fake.url = `http://127.0.0.1:${fake.port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return fake;
}

// ArrView with fake apps for the given services, and the saved address unless `address` is null.
async function setup(t, { address = ADDRESS, services = ['sonarr', 'radarr'], start = startServer, ...options } = {}) {
  const fakes = {};
  for (const service of services) fakes[service] = await startFakeArr(t, service);
  const config = {};
  for (const service of services) config[service] = { url: fakes[service].url, apikey: fakes[service].key };
  if (address) config.webhooks = { baseUrl: address };
  const s = await start(t, { config, ...options });
  for (const fake of Object.values(fakes)) fake.arrview = s.base;
  const seen = [];
  const call = async (method, service, { headers = {}, body, query = '' } = {}) => {
    const hasBody = method === 'POST' || body !== undefined;
    const response = await fetch(`${s.base}/api/webhook-setup/${service}${query}`, { method,
      headers: hasBody ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: hasBody ? JSON.stringify(body ?? {}) : undefined });
    const text = await response.text();
    seen.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { status: response.status, body: json, text };
  };
  return { s, fakes, sonarr: fakes.sonarr, radarr: fakes.radarr, seen, call,
    get: (service, o) => call('GET', service, o), post: (service, o) => call('POST', service, o), del: (service, o) => call('DELETE', service, o) };
}

// The create's own timeout, shortened for a test; every timeout ArrView asks for is recorded.
function shortCreate(ms, timeouts) {
  return { get: axios.get.bind(axios), put: axios.put.bind(axios), delete: axios.delete.bind(axios),
    post: (url, body, options = {}) => {
      timeouts.push(options.timeout);
      return axios.post(url, body, options.timeout === 115000 ? { ...options, timeout: ms } : options);
    } };
}

async function until(check, label) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const upstreamPaths = fake => fake.hits.filter(h => h.method !== 'SAVED').map(h => `${h.method} ${h.path}`);

// ── The URL and the states ──────────────────────────────────────────────────

test('the URL written into the app is the saved address plus the receiver path, from one table', async t => {
  const s = await startServer(t, { config: {} });
  for (const row of urlTable) {
    fs.writeFileSync(s.configFile, JSON.stringify({ webhooks: { baseUrl: row.base } }));
    for (const service of ['sonarr', 'radarr']) {
      const r = await fetch(`${s.base}/api/webhook-setup/${service}`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { service, state: 'not-configured', url: row[service] }, row.base);
    }
  }
  fs.writeFileSync(s.configFile, JSON.stringify({}));
  assert.deepEqual(await (await fetch(`${s.base}/api/webhook-setup/sonarr`)).json(), { service: 'sonarr', state: 'not-configured', url: null });
});

test('an unknown service is a 404 on every method, and matching is exact and lower-case', async t => {
  const { call, sonarr } = await setup(t, { services: ['sonarr'] });
  for (const method of ['GET', 'POST', 'DELETE']) {
    for (const service of ['lidarr', 'Sonarr', 'SONARR', '1']) {
      const r = await call(method, service);
      assert.equal(r.status, 404, `${method} ${service}`);
      assert.deepEqual(r.body, { error: 'Unknown service' });
    }
  }
  assert.deepEqual(sonarr.hits, []);
});

test('a service that is not configured: GET says so, POST and DELETE answer 503, and nothing is asked upstream', async t => {
  const { get, post, del, sonarr } = await setup(t, { services: ['sonarr'] });
  assert.deepEqual((await get('radarr')).body, { service: 'radarr', state: 'not-configured', url: target('radarr') });
  assert.deepEqual(await post('radarr').then(r => [r.status, r.body]), [503, { error: 'Radarr not configured', state: 'not-configured' }]);
  assert.deepEqual(await del('radarr').then(r => [r.status, r.body]), [503, { error: 'Radarr not configured', state: 'not-configured' }]);
  assert.deepEqual(sonarr.hits, []);
});

test('with no saved address GET and POST answer needs-address without asking the app', async t => {
  const { get, post, sonarr } = await setup(t, { address: null, services: ['sonarr'] });
  sonarr.list = [webhookEntry(1, 'ArrView', target('sonarr'))];
  assert.deepEqual(await get('sonarr').then(r => [r.status, r.body]), [200, { service: 'sonarr', state: 'needs-address', url: null }]);
  assert.deepEqual(await post('sonarr').then(r => [r.status, r.body]), [409, { error: 'Save the ArrView address first', state: 'needs-address' }]);
  assert.deepEqual(sonarr.hits, []);
});

test('a rejected key, a login page and an app that cannot be reached are told apart, and POST writes nothing', async t => {
  const { s, get, post, sonarr } = await setup(t, { services: ['sonarr'] });
  const cases = [
    ['key-rejected', () => { sonarr.listAnswer = res => { res.writeHead(401); res.end(); }; }],
    ['key-rejected', () => { sonarr.listAnswer = res => { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{}'); }; }],
    ['unreachable', () => { sonarr.listAnswer = res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Login</html>'); }; }],
    ['unreachable', () => { sonarr.listAnswer = res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"records":[]}'); }; }],
    ['unreachable', () => { sonarr.listAnswer = res => { res.writeHead(302, { Location: '/login' }); res.end(); }; }],
    ['unreachable', () => { sonarr.listAnswer = res => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('[]'); }; }],
  ];
  for (const [state, arrange] of cases) {
    arrange();
    assert.deepEqual((await get('sonarr')).body, { service: 'sonarr', state, url: target('sonarr') }, state);
    const r = await post('sonarr');
    assert.equal(r.status, 502);
    assert.deepEqual(r.body, { error: state === 'key-rejected' ? 'Sonarr rejected the API key' : 'Sonarr could not be reached', state });
  }
  assert.equal(sonarr.creates().length, 0);
  assert.ok(sonarr.hits.every(h => h.path === '/api/v3/notification' && h.method === 'GET'));

  // A wrong stored key is answered 401 with an empty body by the app itself.
  fs.writeFileSync(s.configFile, JSON.stringify({ sonarr: { url: sonarr.url, apikey: 'wrong-key' }, webhooks: { baseUrl: ADDRESS } }));
  sonarr.listAnswer = null;
  assert.equal((await get('sonarr')).body.state, 'key-rejected');
  // Nothing listens: unreachable.
  const closed = http.createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  fs.writeFileSync(s.configFile, JSON.stringify({ sonarr: { url: `http://127.0.0.1:${port}`, apikey: sonarr.key }, webhooks: { baseUrl: ADDRESS } }));
  assert.equal((await get('sonarr')).body.state, 'unreachable');
});

test('ours is recognised leniently by its URL, whatever it is called, and every state is reached', async t => {
  const { get, sonarr } = await setup(t, { services: ['sonarr'] });
  const rows = [
    ['present', [webhookEntry(1, 'ArrView', target('sonarr'))]],
    ['present', [webhookEntry(1, 'Made by hand', `${ADDRESS}/api/webhooks/sonarr/`)]],
    ['present', [webhookEntry(1, 'x', `${ADDRESS}/API/WEBHOOKS/SONARR`)]],
    ['present', [webhookEntry(1, 'x', 'HTTP://ARRVIEW.EXAMPLE:7777/api/webhooks/sonarr//')]],
    ['present', [webhookEntry(1, 'x', `${ADDRESS}/api/webhooks/sonarr?x=1#frag`)]],
    ['absent', [webhookEntry(1, 'x', `${ADDRESS}/api/webhooks/sonarr/extra`)]],
    ['absent', [webhookEntry(1, 'x', `${ADDRESS}/api/webhooks/radarr`)]],
    ['absent', [webhookEntry(1, 'x', 'not a url /api/webhooks/sonarr')]],
    ['absent', [{ id: 1, name: 'x', implementation: 'Webhook', fields: [{ name: 'method', value: 1 }] }]],
    ['absent', [{ ...webhookEntry(1, 'x', target('sonarr')), implementation: 'Discord' }]],
    ['absent', []],
    ['different-address', [webhookEntry(1, 'ArrView', 'http://old.example:7777/api/webhooks/sonarr')]],
    ['different-address', [webhookEntry(1, 'ArrView', 'https://arrview.example:7777/api/webhooks/sonarr')]],
    ['different-address', [webhookEntry(1, 'ArrView', 'http://arrview.example:7778/api/webhooks/sonarr')]],
    ['different-address', [webhookEntry(1, 'ArrView', 'http://arrview.example:7777/proxy/api/webhooks/sonarr')]],
    ['multiple', [webhookEntry(1, 'ArrView', target('sonarr')), webhookEntry(2, 'Copy', target('sonarr'))]],
    ['multiple', [webhookEntry(1, 'ArrView', target('sonarr')), webhookEntry(2, 'Old', 'http://old.example/api/webhooks/sonarr')]],
    ['name-taken', [discordEntry(1, 'arrview', 'DISCORD-TOKEN')]],
    ['name-taken', [webhookEntry(1, 'ARRVIEW', 'http://other.example/hook')]],
    ['absent', [discordEntry(1, 'ArrView ', 'DISCORD-TOKEN')]],
  ];
  for (const [state, list] of rows) {
    sonarr.list = list;
    const body = (await get('sonarr')).body;
    assert.equal(body.state, state, JSON.stringify(list.map(e => e.fields?.[0]?.value)));
    assert.equal(body.url, target('sonarr'));
    assert.deepEqual(Object.keys(body).sort(), state === 'different-address' ? ['address', 'service', 'state', 'url'] : ['service', 'state', 'url']);
  }
  sonarr.list = [webhookEntry(1, 'ArrView', 'http://old.example:7777/api/webhooks/sonarr')];
  assert.equal((await get('sonarr')).body.address, 'http://old.example:7777/api/webhooks/sonarr');
});

test('a different address is shown without login details, query or fragment, and says that something was dropped', async t => {
  const { get, post, seen, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.list = [webhookEntry(1, 'ArrView', 'http://user:secret@arrview.example:7777/api/webhooks/sonarr?token=abc#frag')];
  // Same host and port as the saved address, and the path matches: but userinfo does not count, so it is present.
  assert.equal((await get('sonarr')).body.state, 'present');
  sonarr.list = [webhookEntry(1, 'ArrView', 'http://user:secret@old.example:7777/api/webhooks/sonarr?token=abc#frag')];
  const g = await get('sonarr');
  assert.deepEqual(g.body, { service: 'sonarr', state: 'different-address', url: target('sonarr'), address: 'http://old.example:7777/api/webhooks/sonarr', extra: true });
  const p = await post('sonarr');
  assert.equal(p.status, 409);
  assert.deepEqual(p.body, { error: 'The ArrView webhook in Sonarr points at another address. Fix it in Sonarr, or remove it here and set up again.',
    state: 'different-address', address: 'http://old.example:7777/api/webhooks/sonarr', extra: true });
  for (const text of seen) for (const secret of ['user', 'secret', 'token', 'abc', 'frag']) assert.ok(!text.includes(secret), `${secret} in ${text}`);
  assert.equal(sonarr.creates().length, 0);
});

// ── Set up ──────────────────────────────────────────────────────────────────

test('set up sends the app its own template with our name, URL, POST and exactly the six triggers, then reports the Test message', async t => {
  for (const service of ['sonarr', 'radarr']) {
    const env = await setup(t, { services: [service] });
    const fake = env.fakes[service];
    fake.list = [discordEntry(7, 'Family chat', 'DISCORD-TOKEN')];
    const r = await env.post(service, { body: { url: 'http://evil.example/api/webhooks/sonarr', name: 'Evil', id: 7 } });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body, { state: 'present', created: true, skipped: [], testReceived: true });
    assert.deepEqual(upstreamPaths(fake), ['GET /api/v3/notification', 'GET /api/v3/notification/schema', 'GET /api/v3/notification', 'POST /api/v3/notification']);
    const [sent] = fake.creates();
    assert.equal(sent.search, '');
    assert.ok(!/forceSave/i.test(sent.raw));
    assert.equal(sent.key, fake.key);
    const body = sent.body;
    assert.equal(body.name, 'ArrView');
    assert.deepEqual(body.tags, []);
    assert.ok(!('id' in body));
    const on = Object.keys(body).filter(key => /^on[A-Z]/.test(key));
    assert.deepEqual(on.sort(), [...LIVE_TRIGGERS[service]].sort());
    assert.deepEqual(on.filter(key => body[key] === true).sort(), [...WANTED[service]].sort());
    for (const extra of LIVE_TRIGGERS[service].filter(f => !WANTED[service].includes(f))) assert.equal(body[extra], false, extra);
    assert.equal(body.includeHealthWarnings, false);
    const template = webhookTemplate(service);
    for (const key of ['implementation', 'implementationName', 'configContract', 'infoLink', 'presets']) assert.deepEqual(body[key], template[key], key);
    for (const field of LIVE_TRIGGERS[service]) assert.equal(body[supportsFlag(field)], true);
    const fields = Object.fromEntries(body.fields.map(f => [f.name, f]));
    assert.deepEqual(body.fields.map(f => f.name), ['url', 'method', 'username', 'password', 'headers']);
    assert.equal(fields.url.value, target(service));
    assert.equal(fields.method.value, 1);
    assert.ok(!('value' in fields.username) && !('value' in fields.password));
    assert.deepEqual(fields.headers.value, []);
    assert.ok(env.s.logs.includes(`[Webhook setup] ${service}: created`));
    assert.equal((await env.get(service)).body.state, 'present');
    // The Test message is in the test slot of what ArrView last received.
    const last = await (await fetch(`${env.s.base}/api/webhooks/last`)).json();
    assert.equal(last[service].test.eventType, 'Test');
    assert.equal(last[service].event, null);
  }
});

test('the triggers set on are exactly the server block, which the guide copies', async t => {
  const block = SERVER_TEXT.slice(SERVER_TEXT.indexOf('// webhookTriggers:begin'), SERVER_TEXT.indexOf('// webhookTriggers:end'));
  const triggers = new Function(`${block}; return WEBHOOK_TRIGGERS;`)();
  const env = await setup(t);
  for (const service of ['sonarr', 'radarr']) {
    assert.equal((await env.post(service)).status, 201);
    const body = env.fakes[service].creates()[0].body;
    assert.deepEqual(Object.keys(body).filter(key => /^on[A-Z]/.test(key) && body[key] === true).sort(), triggers[service].map(t => t.field).sort());
  }
});

test('set up is idempotent: one present means no schema read and no create', async t => {
  const { post, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.list = [webhookEntry(4, 'Hand made', `${ADDRESS}/api/webhooks/sonarr/`)];
  for (let i = 0; i < 2; i++) assert.deepEqual(await post('sonarr').then(r => [r.status, r.body]), [200, { state: 'present', created: false }]);
  assert.deepEqual(upstreamPaths(sonarr), ['GET /api/v3/notification', 'GET /api/v3/notification']);
});

test('set up refuses every state that is not absent, and writes nothing', async t => {
  const { post, sonarr } = await setup(t, { services: ['sonarr'] });
  const rows = [
    [[webhookEntry(1, 'ArrView', target('sonarr')), webhookEntry(2, 'Copy', target('sonarr'))], 409,
      { error: 'Several ArrView webhooks exist in Sonarr. Remove the extra ones in Sonarr.', state: 'multiple' }],
    [[discordEntry(1, 'arrview', 'T')], 409, { error: 'A connection named ArrView already exists in Sonarr. Rename or remove it in Sonarr.', state: 'name-taken' }],
  ];
  for (const [list, status, body] of rows) {
    sonarr.list = list;
    assert.deepEqual(await post('sonarr').then(r => [r.status, r.body]), [status, body]);
  }
  assert.equal(sonarr.creates().length, 0);
});

test('a trigger the app does not support is left off and reported, and a template ArrView does not know is refused', async t => {
  const { post, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.supports = { onRename: false, onSeriesDelete: false };
  const r = await post('sonarr');
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.skipped, ['On Rename', 'On Series Delete']);
  const body = sonarr.creates()[0].body;
  assert.equal(body.onRename, false);
  assert.equal(body.onSeriesDelete, false);
  assert.equal(body.onDownload, true);

  const refusals = [
    () => { sonarr.schemaAnswer = res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([DISCORD_TEMPLATE])); }; },
    () => { sonarr.schemaAnswer = res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html></html>'); }; },
    () => { sonarr.schemaAnswer = res => { const tp = webhookTemplate('sonarr'); tp.fields = tp.fields.filter(f => f.name !== 'url'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([tp])); }; },
    () => { sonarr.schemaAnswer = res => { const tp = webhookTemplate('sonarr'); tp.fields = tp.fields.filter(f => f.name !== 'method'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([tp])); }; },
    () => { sonarr.schemaAnswer = res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([webhookTemplate('sonarr'), webhookTemplate('sonarr')])); }; },
    // No trigger supported: the app would save it without running its test.
    () => { sonarr.schemaAnswer = null; sonarr.supports = Object.fromEntries(WANTED.sonarr.map(f => [f, false])); },
  ];
  for (const arrange of refusals) {
    sonarr.list = [];
    arrange();
    assert.deepEqual(await post('sonarr').then(x => [x.status, x.body]), [502, { error: 'Sonarr offered no Webhook connection to create' }]);
  }
  assert.equal(sonarr.creates().length, 1);
  sonarr.supports = {};
  sonarr.schemaAnswer = res => { res.writeHead(401); res.end(); };
  sonarr.list = [];
  assert.deepEqual(await post('sonarr').then(x => [x.status, x.body]), [502, { error: 'Sonarr rejected the API key', state: 'key-rejected' }]);
});

test('the list is read again right before the create, and a change found there wins', async t => {
  const { post, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.onSchema = () => { sonarr.list.push(webhookEntry(9, 'ArrView', target('sonarr'))); };
  assert.deepEqual(await post('sonarr').then(r => [r.status, r.body]), [200, { state: 'present', created: false }]);
  sonarr.list = [];
  sonarr.onSchema = () => { sonarr.list.push(discordEntry(9, 'ArrView', 'T')); };
  assert.equal((await post('sonarr')).body.state, 'name-taken');
  assert.equal(sonarr.creates().length, 0);
});

test('every create outcome is mapped, the app text is cleaned, and the stack trace is never read', async t => {
  let later = 0;
  const { s, post, seen, sonarr } = await setup(t, { services: ['sonarr'], clock: () => Date.now() + later });
  const run = async (mode, arrange = () => {}) => {
    sonarr.list = [];
    sonarr.create = mode;
    arrange();
    return post('sonarr');
  };
  let r = await run('receiver404');
  assert.deepEqual([r.status, r.body], [422, { error: `Sonarr refused the webhook: Unable to send test message: Unable to post to webhook: HTTP request failed: [404:NotFound] [POST] at [${target('sonarr')}]`, refused: true }]);
  r = await run('unique');
  assert.deepEqual([r.status, r.body], [422, { error: 'Sonarr refused the webhook: Should be unique', refused: true }]);
  r = await run('invalidUrl');
  assert.deepEqual([r.status, r.body], [422, { error: "Sonarr refused the webhook: Invalid Url: 'not-a-url'", refused: true }]);
  r = await run('refused500');
  assert.deepEqual([r.status, r.body], [422, { error: 'Sonarr could not reach ArrView: Connection refused (arrview.example:7777)', refused: true }]);
  r = await run('refused500', () => { sonarr.message = "Uri didn't match expected pattern: http://someuser:somepass@arrview.example:7777/api/webhooks/sonarr"; });
  assert.equal(r.body.error, "Sonarr could not reach ArrView: Uri didn't match expected pattern: http://arrview.example:7777/api/webhooks/sonarr");
  r = await run('refused500', () => { sonarr.message = `Line one\nline\ttwo\u0007 ${'x'.repeat(400)}`; });
  const text = r.body.error.slice('Sonarr could not reach ArrView: '.length);
  assert.equal(text, `Line one line two ${'x'.repeat(400)}`.slice(0, 300) + '…');
  assert.equal(text.length, 301);
  r = await run('key401');
  assert.deepEqual([r.status, r.body], [502, { error: 'Sonarr rejected the API key', state: 'key-rejected' }]);
  // A 500 that is not JSON: unknown, so the list is read again; nothing was saved.
  r = await run('html500');
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "Sonarr did not confirm the webhook, and it is not in Sonarr's list yet. Sonarr may still be testing the address: check the status again in two minutes before trying again.", state: 'absent' });
  // That create may still be saved, so the next set-up waits for it.
  const createsSoFar = sonarr.creates().length;
  r = await run('ok');
  assert.deepEqual([r.status, r.body.pending], [409, true]);
  assert.equal(sonarr.creates().length, createsSoFar);
  later += 120001;
  // A 2xx that is not the stored connection: unknown, and the list shows it was saved.
  r = await run('noId');
  assert.deepEqual([r.status, r.body], [201, { state: 'present', created: true, skipped: [], testReceived: true }]);
  // A 201 without the Test message reaching ArrView: saved, and said so.
  sonarr.list = [];
  sonarr.create = 'ok';
  sonarr.postTest = false;
  r = await post('sonarr');
  assert.deepEqual([r.status, r.body], [201, { state: 'present', created: true, skipped: [], testReceived: false }]);
  // Nothing of the stack trace, anywhere.
  for (const t of [...seen, ...s.logs]) assert.ok(!t.includes(DESCRIPTION_MARKER) && !t.includes('HttpClient.cs') && !t.includes(sonarr.key), t);
  assert.ok(s.logs.every(line => !line.startsWith('[Webhook setup]') || /^\[Webhook setup\] sonarr: (created|removed)$/.test(line)));
});

test('after ArrView itself times out the list decides: saved means set up, not saved means check again later', async t => {
  const timeouts = [];
  let later = 0;
  const { post, get, sonarr } = await setup(t, { services: ['sonarr'], modules: { axios: shortCreate(150, timeouts) },
    clock: () => Date.now() + later });
  sonarr.create = 'saveThenHang';
  let r = await post('sonarr');
  assert.deepEqual([r.status, r.body], [201, { state: 'present', created: true, skipped: [], testReceived: true }]);
  assert.deepEqual(timeouts, [115000]);
  sonarr.list = [];
  sonarr.create = 'hang';
  r = await post('sonarr');
  assert.equal(r.status, 504);
  assert.deepEqual(r.body, { error: "Sonarr did not confirm the webhook, and it is not in Sonarr's list yet. Sonarr may still be testing the address: check the status again in two minutes before trying again.", state: 'absent' });
  // Once the window has passed with nothing saved, a set-up is sent again.
  later += 120001;
  // The re-read finds something else: the plain message, with that state.
  sonarr.create = 'hang';
  sonarr.onSchema = null;
  const realList = sonarr.list;
  let reads = 0;
  sonarr.listAnswer = res => { reads += 1; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reads <= 2 ? [] : [webhookEntry(1, 'ArrView', target('sonarr')), webhookEntry(2, 'B', target('sonarr'))])); };
  r = await post('sonarr');
  assert.deepEqual([r.status, r.body], [504, { error: 'Sonarr did not confirm the webhook. Check the status before trying again.', state: 'multiple' }]);
  sonarr.listAnswer = null;
  sonarr.list = realList;
  assert.equal((await get('sonarr')).body.state, 'absent');
});

// ── One at a time ───────────────────────────────────────────────────────────

test('two set-ups at once make one webhook, although the app would let both through', async t => {
  const { post, get, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.hold();
  const first = post('sonarr');
  const second = post('sonarr');
  await until(() => sonarr.creates().length === 1, 'the first create');
  // A status read does not wait for the queue.
  assert.equal((await get('sonarr')).body.state, 'absent');
  const readsBeforeSave = sonarr.hits.filter(h => h.method === 'GET' && h.path === '/api/v3/notification').length;
  sonarr.release();
  const answers = (await Promise.all([first, second])).map(r => r.body.created);
  assert.deepEqual(answers.sort(), [false, true]);
  assert.equal(sonarr.creates().length, 1);
  assert.equal(sonarr.named('ArrView').length, 1);
  // The second set-up read the list only after the first one was saved (2 reads by the first, 1 by the status read).
  assert.equal(readsBeforeSave, 3);
  const savedAt = sonarr.hits.findIndex(h => h.method === 'SAVED');
  assert.equal(sonarr.hits.slice(0, savedAt).filter(h => h.path === '/api/v3/notification' && h.method === 'GET').length, 3);
});

test('a remove sent while a set-up is pending waits for it, then removes what it made', async t => {
  const { post, del, get, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.list = [discordEntry(1, 'Family chat', 'DISCORD-TOKEN')];
  sonarr.nextId = 10;
  const discord = JSON.stringify(sonarr.list[0]);
  sonarr.hold();
  const creating = post('sonarr');
  await until(() => sonarr.creates().length === 1, 'the create');
  const removing = del('sonarr');
  assert.equal((await get('sonarr')).body.state, 'absent');
  sonarr.release();
  const [created, removed] = await Promise.all([creating, removing]);
  assert.equal(created.status, 201);
  assert.equal(created.body.created, true);
  assert.deepEqual([removed.status, removed.body], [200, { state: 'absent', removed: true }]);
  const savedAt = sonarr.hits.findIndex(h => h.method === 'SAVED');
  const deleteAt = sonarr.hits.findIndex(h => h.method === 'DELETE');
  assert.ok(deleteAt > savedAt);
  assert.equal(sonarr.hits[deleteAt].path, '/api/v3/notification/10');
  // The remove's first list read came after the save.
  const statusRead = sonarr.hits.slice(0, savedAt).filter(h => h.method === 'GET' && h.path === '/api/v3/notification').length;
  assert.equal(statusRead, 3);
  assert.equal(sonarr.creates().length, 1);
  assert.equal(sonarr.deletes().length, 1);
  assert.deepEqual(sonarr.list.map(e => JSON.stringify(e)), [discord]);
  assert.equal((await get('sonarr')).body.state, 'absent');
});

test('the queue moves on after a create that times out', async t => {
  const { post, del, sonarr } = await setup(t, { services: ['sonarr'], modules: { axios: shortCreate(150, []) } });
  sonarr.create = 'hang';
  const creating = post('sonarr');
  await until(() => sonarr.creates().length === 1, 'the create');
  const removing = del('sonarr');
  const [created, removed] = await Promise.all([creating, removing]);
  assert.equal(created.status, 504);
  assert.equal(created.body.state, 'absent');
  assert.deepEqual([removed.status, removed.body], [404, { state: 'absent', error: 'There is no ArrView webhook in Sonarr' }]);
});

test('a create the app saves after ArrView gave up blocks a queued second set-up, so there is still one webhook', async t => {
  for (const mode of ['ok', 'resetThenSave']) {
    let later = 0;
    const { post, get, del, sonarr } = await setup(t, { services: ['sonarr'], modules: { axios: shortCreate(150, []) },
      clock: () => Date.now() + later });
    sonarr.create = mode;
    sonarr.hold();
    const first = post('sonarr');
    await until(() => sonarr.creates().length === 1, `the first create (${mode})`);
    const second = post('sonarr');
    const [a, b] = await Promise.all([first, second]);
    // 'ok' times out; 'resetThenSave' loses its connection at once.
    assert.deepEqual([a.status, a.body.state], [mode === 'ok' ? 504 : 502, 'absent']);
    assert.deepEqual([b.status, b.body], [409, { error: 'Sonarr has not confirmed the last set-up and may still save it. Check the status again in two minutes before trying again.', state: 'absent', pending: true }]);
    assert.equal(sonarr.creates().length, 1);
    // The status read still answers, and so does the queue.
    assert.equal((await get('sonarr')).body.state, 'absent');
    assert.deepEqual((await del('sonarr')).status, 404);
    assert.equal((await post('sonarr')).status, 409);
    sonarr.release();
    await until(() => sonarr.list.length === 1, `the late save (${mode})`);
    assert.equal((await get('sonarr')).body.state, 'present');
    // Later, and after the window, a set-up finds it there and makes no other.
    later += 120001;
    const r = await post('sonarr');
    assert.deepEqual([r.status, r.body], [200, { state: 'present', created: false }]);
    assert.equal(sonarr.creates().length, 1);
    assert.equal(sonarr.named('ArrView').length, 1);
  }
});

test('the wait after an unknown create ends when ours shows up, or after two minutes with nothing saved', async t => {
  let later = 0;
  const { post, get, del, sonarr } = await setup(t, { services: ['sonarr'], modules: { axios: shortCreate(150, []) },
    clock: () => Date.now() + later });
  sonarr.create = 'hang';
  assert.equal((await post('sonarr')).status, 504);
  later += 119000;
  assert.equal((await post('sonarr')).status, 409);
  later += 1001;
  assert.equal((await post('sonarr')).status, 504);
  assert.equal(sonarr.creates().length, 2);
  // Ours seen by a status read ends the wait at once: removed and set up again without waiting.
  sonarr.list = [webhookEntry(5, 'ArrView', target('sonarr'))];
  assert.equal((await get('sonarr')).body.state, 'present');
  assert.equal((await del('sonarr')).status, 200);
  sonarr.create = 'ok';
  const r = await post('sonarr');
  assert.deepEqual([r.status, r.body.created], [201, true]);
  assert.equal(sonarr.creates().length, 3);
});

// ── Remove ──────────────────────────────────────────────────────────────────

test('remove deletes only ours, by the id in the list, whatever the request says', async t => {
  const { s, del, get, sonarr } = await setup(t, { services: ['sonarr'] });
  const others = [discordEntry(1, 'Family chat', 'DISCORD-TOKEN'), webhookEntry(2, 'Other hook', 'http://other.example/hook'), webhookEntry(3, 'Radarr one', `${ADDRESS}/api/webhooks/radarr`)];
  sonarr.list = [...others, webhookEntry(8, 'ArrView', target('sonarr'))];
  const r = await del('sonarr', { body: { id: 1 }, query: '?id=2' });
  assert.deepEqual([r.status, r.body], [200, { state: 'absent', removed: true }]);
  assert.deepEqual(sonarr.deletes().map(h => h.path), ['/api/v3/notification/8']);
  assert.deepEqual(sonarr.list.map(e => e.id), [1, 2, 3]);
  assert.ok(s.logs.includes('[Webhook setup] sonarr: removed'));
  assert.deepEqual(upstreamPaths(sonarr), ['GET /api/v3/notification', 'DELETE /api/v3/notification/8', 'GET /api/v3/notification']);
  assert.equal((await get('sonarr')).body.state, 'absent');
  // A different address is ours too, and removable.
  sonarr.list.push(webhookEntry(9, 'ArrView', 'http://old.example/api/webhooks/sonarr'));
  assert.equal((await del('sonarr')).status, 200);
  // Another connection named ArrView stays, and the answer says so; a name with a trailing space is another name.
  sonarr.list.push(webhookEntry(10, 'ArrView', target('sonarr')), discordEntry(11, 'ArrView ', 'T'), discordEntry(12, 'arrview', 'T'));
  const named = await del('sonarr');
  assert.deepEqual([named.status, named.body], [200, { state: 'name-taken', removed: true }]);
  assert.deepEqual(sonarr.list.map(e => e.id), [1, 2, 3, 11, 12]);
  const none = await del('sonarr');
  assert.deepEqual([none.status, none.body], [404, { state: 'name-taken', error: 'There is no ArrView webhook in Sonarr' }]);
  sonarr.list = sonarr.list.filter(e => e.id !== 12);
  assert.equal((await del('sonarr')).body.state, 'absent');
});

test('remove refuses when there is none or several, and checks that the app really removed it', async t => {
  const { del, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.list = [];
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [404, { state: 'absent', error: 'There is no ArrView webhook in Sonarr' }]);
  sonarr.list = [webhookEntry(1, 'ArrView', target('sonarr')), webhookEntry(2, 'B', target('sonarr'))];
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [409, { error: 'Several ArrView webhooks exist in Sonarr. Remove the extra ones in Sonarr.', state: 'multiple' }]);
  assert.equal(sonarr.deletes().length, 0);
  sonarr.list = [webhookEntry(1, 'ArrView', target('sonarr'))];
  sonarr.deleteKeeps = true;
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [502, { error: 'Sonarr answered, but the ArrView webhook is still there', state: 'present' }]);
  sonarr.deleteKeeps = false;
  sonarr.deleteAnswer = res => { res.writeHead(401); res.end(); };
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [502, { error: 'Sonarr rejected the API key', state: 'present' }]);
  sonarr.deleteAnswer = res => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: 'x', description: DESCRIPTION })); };
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [502, { error: 'Sonarr could not be reached', state: 'present' }]);
  sonarr.deleteAnswer = null;
  let reads = 0;
  sonarr.listAnswer = res => { reads += 1; if (reads > 1) { res.writeHead(401); return res.end(); } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([webhookEntry(1, 'ArrView', target('sonarr'))])); };
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [502, { error: 'Sonarr answered, but the result could not be checked. Check the status.', state: 'key-rejected' }]);
  sonarr.listAnswer = res => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ ...webhookEntry(1, 'ArrView', target('sonarr')), id: 'abc' }])); };
  const before = sonarr.deletes().length;
  assert.equal((await del('sonarr')).status, 502);
  assert.equal(sonarr.deletes().length, before);
  sonarr.listAnswer = res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); };
  assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [502, { error: 'Sonarr could not be reached', state: 'unreachable' }]);
});

test('remove works with no saved address, and the classification without one agrees with GET', async t => {
  const { s, del, get, sonarr } = await setup(t, { address: null, services: ['sonarr'] });
  const discord = discordEntry(1, 'Family chat', 'DISCORD-TOKEN');
  sonarr.list = [discord, webhookEntry(5, 'ArrView', target('sonarr'))];
  assert.equal((await get('sonarr')).body.state, 'needs-address');
  assert.deepEqual(sonarr.hits, []);
  const r = await del('sonarr');
  assert.deepEqual([r.status, r.body], [200, { state: 'absent', removed: true }]);
  assert.deepEqual(upstreamPaths(sonarr), ['GET /api/v3/notification', 'DELETE /api/v3/notification/5', 'GET /api/v3/notification']);
  assert.deepEqual(sonarr.list, [discord]);
  assert.ok(s.logs.includes('[Webhook setup] sonarr: removed'));
  assert.equal((await get('sonarr')).body.state, 'needs-address');

  sonarr.list = [webhookEntry(5, 'ArrView', target('sonarr'))];
  sonarr.deleteKeeps = true;
  assert.deepEqual(await del('sonarr').then(x => [x.status, x.body.state]), [502, 'needs-address']);
  sonarr.deleteKeeps = false;
  sonarr.list = [webhookEntry(5, 'ArrView', target('sonarr')), webhookEntry(6, 'Copy', 'http://old.example/api/webhooks/sonarr')];
  assert.deepEqual(await del('sonarr').then(x => [x.status, x.body.state]), [409, 'multiple']);
  sonarr.list = [discordEntry(1, 'ARRVIEW', 'T')];
  assert.deepEqual(await del('sonarr').then(x => [x.status, x.body.state]), [404, 'name-taken']);
  sonarr.list = [];
  assert.deepEqual(await del('sonarr').then(x => [x.status, x.body.state]), [404, 'absent']);
  assert.equal(sonarr.deletes().length, 2);
});

test('the classification with and without a target differs only for a single one of ours', async t => {
  const withTarget = await setup(t, { services: ['sonarr'] });
  const without = await setup(t, { address: null, services: ['sonarr'] });
  const lists = [
    ['present', 'needs-address', [webhookEntry(5, 'ArrView', target('sonarr'))]],
    ['different-address', 'needs-address', [webhookEntry(5, 'ArrView', 'http://old.example/api/webhooks/sonarr')]],
    ['multiple', 'multiple', [webhookEntry(5, 'ArrView', target('sonarr')), webhookEntry(6, 'B', target('sonarr'))]],
    ['name-taken', 'name-taken', [discordEntry(1, 'ArrView', 'T')]],
    ['absent', 'absent', []],
  ];
  for (const [withState, withoutState, list] of lists) {
    for (const env of [withTarget, without]) { env.sonarr.list = JSON.parse(JSON.stringify(list)); env.sonarr.deleteKeeps = true; }
    assert.equal((await withTarget.get('sonarr')).body.state, withState);
    // Without a saved address only DELETE reads the list; a delete that keeps it reports the state found.
    const r = await without.del('sonarr');
    const state = r.status === 200 ? 'absent' : r.body.state;
    assert.equal(state, withoutState, JSON.stringify(list.map(e => e.name)));
    const w = await withTarget.del('sonarr');
    assert.equal(w.body.state, withState);
  }
});

// ── Nothing leaks ───────────────────────────────────────────────────────────

test('nothing from other connections, the schema, the app address or the key reaches any answer or log line', async t => {
  const env = await setup(t, { services: ['sonarr'] });
  const { sonarr, s, seen } = env;
  const SECRETS = ['DISCORD-SECRET-TOKEN', 'USERNAME-SECRET', 'HEADER-SECRET', 'PASSWORD-SECRET', 'QUERY-SECRET', 'Family chat', 'Private hook',
    'other.example', 'discord.example', sonarr.key, `127.0.0.1:${sonarr.port}`, 'wiki.example', DESCRIPTION_MARKER, '********'];
  const others = () => [
    discordEntry(1, 'Family chat', 'DISCORD-SECRET-TOKEN'),
    webhookEntry(2, 'Private hook', 'http://other.example:9000/hook', { fields: [{ name: 'url', value: 'http://other.example:9000/hook' },
      { name: 'method', value: 1 }, { name: 'username', value: 'USERNAME-SECRET' }, { name: 'password', value: 'PASSWORD-SECRET' },
      { name: 'headers', value: [{ key: 'X-Token', value: 'HEADER-SECRET' }] }] }),
  ];
  const ours = (url = `${ADDRESS}/api/webhooks/sonarr?token=QUERY-SECRET`) => webhookEntry(3, 'Hand made', url);
  const steps = [
    [[...others()], async () => { await env.get('sonarr'); await env.post('sonarr'); await env.del('sonarr'); }],
    [[...others(), ours()], async () => { await env.get('sonarr'); await env.post('sonarr'); await env.del('sonarr'); }],
    // A different address is shown (criterion 6), so it uses a host that is not one of the secrets.
    [[...others(), ours('http://moved.example:7777/api/webhooks/sonarr?token=QUERY-SECRET')], async () => {
      assert.equal((await env.get('sonarr')).body.address, 'http://moved.example:7777/api/webhooks/sonarr');
      await env.post('sonarr');
    }],
    [[...others(), ours(), webhookEntry(4, 'Second', 'http://other.example/api/webhooks/sonarr?token=QUERY-SECRET')], async () => { await env.get('sonarr'); await env.post('sonarr'); await env.del('sonarr'); }],
    [[...others(), discordEntry(5, 'ArrView', 'DISCORD-SECRET-TOKEN')], async () => { await env.get('sonarr'); await env.post('sonarr'); await env.del('sonarr'); }],
  ];
  for (const [list, run] of steps) { sonarr.list = list; sonarr.create = 'ok'; await run(); }
  for (const mode of ['receiver404', 'refused500', 'html500', 'unique']) { sonarr.list = others(); sonarr.create = mode; await env.post('sonarr'); }
  sonarr.listAnswer = res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<html>${DESCRIPTION_MARKER} DISCORD-SECRET-TOKEN</html>`); };
  await env.get('sonarr'); await env.post('sonarr'); await env.del('sonarr');
  assert.ok(seen.length >= 20);
  for (const text of [...seen, ...s.logs]) for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} in ${text}`);
  // No answer carries an id or a name from the list.
  for (const text of seen) assert.ok(!/"(id|name|fields|tags)"/.test(text), text);
});

// ── The login and the content-type guard ────────────────────────────────────

test('with the login on the routes need credentials, a cookie needs the header for POST and DELETE, and a key works', async t => {
  const env = await setup(t, { services: ['sonarr'], start: startSeeded });
  const { s, sonarr } = env;
  const url = `${s.base}/api/webhook-setup/sonarr`;
  const request = (method, headers = {}) => fetch(url, { method, headers: method === 'POST' ? { ...JSON_HEADERS, ...headers } : headers, body: method === 'POST' ? '{}' : undefined });
  for (const method of ['GET', 'POST', 'DELETE']) {
    const r = await request(method);
    assert.equal(r.status, 401, method);
    assert.deepEqual(await r.json(), { error: 'Authentication required', auth: true });
  }
  assert.equal(sonarr.hits.length, 0);
  const cookie = { Cookie: s.seeded.cookie };
  assert.equal((await (await request('GET', cookie)).json()).state, 'absent');
  assert.equal((await request('POST', cookie)).status, 403);
  assert.equal((await request('DELETE', cookie)).status, 403);
  assert.equal(sonarr.creates().length, 0);
  const posted = await request('POST', { ...cookie, 'X-Requested-With': 'ArrView' });
  assert.equal(posted.status, 201);
  // The app's Test post reached the public receiver while the login was on.
  assert.equal((await posted.json()).testReceived, true);
  assert.equal((await request('DELETE', { ...cookie, 'X-Requested-With': 'ArrView' })).status, 200);
  const key = { 'X-Api-Key': s.seeded.accessKey };
  assert.equal((await (await request('GET', key)).json()).state, 'absent');
  assert.equal((await request('POST', key)).status, 201);
  assert.equal((await request('DELETE', key)).status, 200);
});

test('with the login off all three work without credentials, and a POST without JSON is refused before anything is written', async t => {
  const { s, get, post, del, sonarr } = await setup(t, { services: ['sonarr'] });
  assert.equal((await get('sonarr')).status, 200);
  for (const headers of [{ 'Content-Type': 'text/plain' }, {}, { 'Content-Type': 'application/x-www-form-urlencoded' }]) {
    const r = await fetch(`${s.base}/api/webhook-setup/sonarr`, { method: 'POST', headers, body: 'a=b' });
    assert.equal(r.status, 415);
  }
  assert.equal(sonarr.creates().length, 0);
  assert.equal((await post('sonarr')).status, 201);
  assert.equal((await del('sonarr')).status, 200);
  // A cookie-less call with the browser's headers is fine too while the login is off.
  assert.equal((await fetch(`${s.base}/api/webhook-setup/sonarr`, { method: 'POST', headers: AJAX, body: '{}' })).status, 201);
});

// ── Which app answers ───────────────────────────────────────────────────────
// Sonarr and Radarr share the connection API, so the address and key of one saved in the other's row had its list read, and
// written to, as the other's. Both name themselves in GET /api/v3/system/status (appName), and every call asks that once before it
// reads the list. Only an app that names the other of the two is refused: any other answer, and no answer, changes nothing.

const says = data => res => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const LABEL = { sonarr: 'Sonarr', radarr: 'Radarr' };
const otherOf = service => (service === 'sonarr' ? 'radarr' : 'sonarr');
const wrongApp = row => ({ state: 'wrong-app',
  error: `The address saved for ${LABEL[row]} is ${LABEL[otherOf(row)]}, not ${LABEL[row]}. Fix ${LABEL[row]}'s address in ArrView under Settings, Services.` });

// ArrView whose `row` holds the address and key of the other app: a fake of that app, which names itself as the real one does.
async function otherAppInRow(t, row, { address = ADDRESS, ...options } = {}) {
  const other = otherOf(row);
  const env = await setup(t, { address, services: [other], ...options });
  const app = env.fakes[other];
  app.statusAnswer = says(STATUS[other]);
  fs.writeFileSync(env.s.configFile, JSON.stringify({ [row]: { url: app.url, apikey: app.key }, ...(address ? { webhooks: { baseUrl: address } } : {}) }));
  return { ...env, app };
}

// Every GET ArrView sends, with what it asked for; the read of who the app is gets a short timeout of its own for a test.
function recordGets(ms, gets) {
  return { post: axios.post.bind(axios), put: axios.put.bind(axios), delete: axios.delete.bind(axios),
    get: (url, options = {}) => {
      const path = new URL(url).pathname;
      gets.push({ path, timeout: options.timeout, maxRedirects: options.maxRedirects, key: options.headers?.['X-Api-Key'] });
      return axios.get(url, path === STATUS_PATH ? { ...options, timeout: ms } : options);
    } };
}

test('the other app\'s address and key in a row: the status says so, set up and remove refuse, and its connection list is never read', async t => {
  for (const row of ['radarr', 'sonarr']) {
    const { get, post, del, app } = await otherAppInRow(t, row);
    const status = [200, { service: row, state: 'wrong-app', url: target(row) }];
    // What the other app holds: someone else's connection, then also one that points at this row's receiver.
    const held = () => [discordEntry(1, 'Family chat', 'DISCORD-TOKEN'), webhookEntry(8, 'ArrView', target(row))];
    app.list = held().slice(0, 1);
    assert.deepEqual(await get(row).then(r => [r.status, r.body]), status, row);
    assert.deepEqual(await post(row).then(r => [r.status, r.body]), [409, wrongApp(row)], row);
    app.list = held();
    assert.deepEqual(await get(row).then(r => [r.status, r.body]), status, row);
    assert.deepEqual(await post(row).then(r => [r.status, r.body]), [409, wrongApp(row)], row);
    assert.deepEqual(await del(row).then(r => [r.status, r.body]), [409, wrongApp(row)], row);
    // Nothing was written, and nothing on the connection API was even asked.
    assert.deepEqual(app.list, held(), row);
    assert.deepEqual(app.hits, [], row);
    // One question per call, with the key stored for the row.
    assert.deepEqual(app.statusReads, Array(5).fill({ key: app.key, search: '', before: 0 }), row);
  }
});

test('the name is read whatever its case or padding, and with or without the rest of a status answer', async t => {
  const { get, post, del, app } = await otherAppInRow(t, 'radarr');
  app.list = [webhookEntry(8, 'ArrView', target('radarr'))];
  for (const answer of [{ ...STATUS.sonarr, appName: 'sonarr' }, { ...STATUS.sonarr, appName: 'SONARR' }, { ...STATUS.sonarr, appName: ' Sonarr ' }, { appName: 'Sonarr' }]) {
    app.statusAnswer = says(answer);
    assert.equal((await get('radarr')).body.state, 'wrong-app', answer.appName);
    assert.deepEqual(await post('radarr').then(r => [r.status, r.body]), [409, wrongApp('radarr')], answer.appName);
    assert.deepEqual(await del('radarr').then(r => [r.status, r.body]), [409, wrongApp('radarr')], answer.appName);
  }
  assert.deepEqual(app.hits, []);
  assert.equal(app.list.length, 1);
});

test('only an app that names the other one is refused: any other answer, an error or no answer leaves status, set up and remove as they were', async t => {
  const { get, post, del, sonarr } = await setup(t, { services: ['sonarr'] });
  const failing = (status, data) => res => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
  const cases = [
    ['the app the row is for', says(STATUS.sonarr)],
    ['no appName (Sonarr 3)', says({ version: '3.0.6.1342' })],
    ['an empty appName', says({ appName: '', version: '3.0.6.1342' })],
    ['an appName that is not text', says({ appName: ['Radarr'], version: '6.4.4.10685' })],
    ['another app on the same API', says({ appName: 'Whisparr', version: '2.0.0.548' })],
    ['a name that only holds the other app\'s', says({ appName: 'Radarr Fork', version: '6.4.4.10685' })],
    ['a JSON array', says(['Radarr'])],
    ['a web page', res => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><title>Radarr</title></html>'); }],
    ['not found, as a fake answers when it is not told what it is', null],
    ['a rejected key on that route alone', failing(401)],
    ['a server error, whatever its body says', failing(500, STATUS.radarr)],
    // Followed, the redirect would lead to an answer that names the other app.
    ['a redirect, which is not followed', (res, url) => {
      if (url.search) return says(STATUS.radarr)(res);
      res.writeHead(302, { Location: `${STATUS_PATH}?followed=1` });
      return res.end();
    }],
    ['a connection that is cut', res => res.socket.destroy()],
  ];
  for (const [name, statusAnswer] of cases) {
    sonarr.list = [];
    sonarr.statusReads = [];
    sonarr.statusAnswer = statusAnswer;
    assert.equal((await get('sonarr')).body.state, 'absent', name);
    assert.deepEqual(await post('sonarr').then(r => [r.status, r.body.created]), [201, true], name);
    assert.equal((await get('sonarr')).body.state, 'present', name);
    assert.deepEqual(await del('sonarr').then(r => [r.status, r.body]), [200, { state: 'absent', removed: true }], name);
    // The app was asked, once per call and at no second address, and what it said was let pass.
    assert.deepEqual(sonarr.statusReads.map(read => read.search), ['', '', '', ''], name);
  }
});

test('a read of who the app is that never answers is given up after the list\'s own timeout, and the list then decides as before', async t => {
  const gets = [];
  const { get, post, sonarr } = await setup(t, { services: ['sonarr'], modules: { axios: recordGets(150, gets) } });
  sonarr.statusAnswer = () => {};
  assert.equal((await get('sonarr')).body.state, 'absent');
  // The same key, timeout and redirect rule as the list read that follows it.
  assert.deepEqual(gets, [{ path: STATUS_PATH, timeout: 15000, maxRedirects: 0, key: sonarr.key },
    { path: '/api/v3/notification', timeout: 15000, maxRedirects: 0, key: sonarr.key }]);
  assert.deepEqual(await post('sonarr').then(r => [r.status, r.body.created]), [201, true]);
  assert.equal(sonarr.statusReads.length, 2);
});

test('the app is asked who it is once per call, ahead of its connection list and with the stored key', async t => {
  const { get, post, del, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.statusAnswer = says(STATUS.sonarr);
  assert.equal((await get('sonarr')).body.state, 'absent');
  assert.equal((await post('sonarr')).status, 201);
  assert.equal((await del('sonarr')).status, 200);
  // `before` is the number of connection requests that came first: none for the status, one for the set-up, five for the remove.
  // So each call asks once, before anything else, and not again for its second read of the list.
  assert.deepEqual(sonarr.statusReads, [0, 1, 5].map(before => ({ key: sonarr.key, search: '', before })));
  assert.deepEqual(upstreamPaths(sonarr), ['GET /api/v3/notification',
    'GET /api/v3/notification', 'GET /api/v3/notification/schema', 'GET /api/v3/notification', 'POST /api/v3/notification',
    'GET /api/v3/notification', 'DELETE /api/v3/notification/1', 'GET /api/v3/notification']);
});

test('no app is asked who it is when nothing may be asked of it, and a remove with no saved address asks before it reads the list', async t => {
  // An unknown service, and a service that is not set up while another one is.
  const { call, sonarr } = await setup(t, { services: ['sonarr'] });
  sonarr.statusAnswer = says(STATUS.sonarr);
  for (const method of ['GET', 'POST', 'DELETE']) { await call(method, 'lidarr'); await call(method, 'radarr'); }
  assert.deepEqual(sonarr.statusReads, []);

  // With the login on, a call without credentials is turned away first.
  const locked = await setup(t, { services: ['sonarr'], start: startSeeded });
  locked.sonarr.statusAnswer = says(STATUS.radarr);
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await locked.call(method, 'sonarr')).status, 401, method);
  assert.deepEqual(locked.sonarr.statusReads, []);
  const signedIn = await fetch(`${locked.s.base}/api/webhook-setup/sonarr`, { headers: { Cookie: locked.s.seeded.cookie } });
  assert.equal((await signedIn.json()).state, 'wrong-app');
  assert.equal(locked.sonarr.statusReads.length, 1);

  // With no saved address the status and a set-up stop before any request. A remove reads the list even then, so it asks first.
  const bare = await otherAppInRow(t, 'radarr', { address: null });
  bare.app.list = [webhookEntry(5, 'ArrView', target('radarr'))];
  assert.equal((await bare.get('radarr')).body.state, 'needs-address');
  assert.deepEqual(await bare.post('radarr').then(r => [r.status, r.body.state]), [409, 'needs-address']);
  assert.deepEqual(bare.app.statusReads, []);
  assert.deepEqual(await bare.del('radarr').then(r => [r.status, r.body]), [409, wrongApp('radarr')]);
  assert.equal(bare.app.statusReads.length, 1);
  assert.deepEqual(bare.app.hits, []);
  assert.equal(bare.app.list.length, 1);
});

test('nothing the other app says about itself or holds in its list reaches an answer or a log line', async t => {
  const { get, post, del, app, s, seen } = await otherAppInRow(t, 'radarr');
  const SECRETS = ['INSTANCE-SECRET', 'URLBASE-SECRET', 'STARTUP-SECRET', 'APPDATA-SECRET', 'BRANCH-SECRET', STATUS.sonarr.version,
    'DISCORD-SECRET-TOKEN', 'Family chat', 'discord.example', 'elsewhere.example', app.key, `127.0.0.1:${app.port}`];
  app.statusAnswer = says({ ...STATUS.sonarr, instanceName: 'INSTANCE-SECRET', urlBase: '/URLBASE-SECRET', startupPath: '/STARTUP-SECRET',
    appData: '/APPDATA-SECRET', branch: 'BRANCH-SECRET' });
  // Read as Radarr's, this list would show the address of a connection that is Sonarr's.
  app.list = [discordEntry(1, 'Family chat', 'DISCORD-SECRET-TOKEN'), webhookEntry(2, 'ArrView', 'http://elsewhere.example:7777/api/webhooks/radarr')];
  await get('radarr'); await post('radarr'); await del('radarr');
  assert.equal(seen.length, 3);
  for (const text of [...seen, ...s.logs]) for (const secret of SECRETS) assert.ok(!text.includes(secret), `${secret} in ${text}`);
  // An answer is the state with ArrView's own URL, or the state with a sentence that names the two apps.
  assert.deepEqual(seen.map(text => Object.keys(JSON.parse(text)).sort()), [['service', 'state', 'url'], ['error', 'state'], ['error', 'state']]);
  assert.ok(s.logs.every(line => !line.startsWith('[Webhook setup]')));
});
