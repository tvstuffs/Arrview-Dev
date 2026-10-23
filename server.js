const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL: NodeURL } = require('url');

const app = express();
const PORT = process.env.PORT || 7777;
const CONFIG_DIR = process.env.CONFIG_DIR || __dirname;
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Canonical user-facing app version. Surfaced in the Settings page and the
// /api/arrview/identify endpoint (the iOS app reads it from there).
// Pre-2.0 track: each build increments the A number (1.9A1, 1.9A2, ...). The label
// is display text; clients detect features through `capabilities`, never by
// comparing versions (1.9A1 sorts below 1.10.2 as numbers).
const APP_VERSION = '1.9A3';

app.use(express.json());
// Mutating API calls must declare a JSON body. Without this guard a request
// with a text/plain body leaves req.body empty and would wipe the config.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) &&
      req.path.toLowerCase().startsWith('/api/') && !req.path.toLowerCase().startsWith('/api/webhooks/') &&
      !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});
// Malformed JSON under /api gets a JSON 400 (never the HTML default page).
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.status === 400) &&
      req.path.toLowerCase().startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  next(err);
});
// API responses and mutable shell files must always reach the server.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
const distPath = path.join(__dirname, 'dist');
app.use('/assets', express.static(path.join(distPath, 'assets'), {
  maxAge: '1y', immutable: true,
}));
app.use(express.static(distPath, {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));

// Process liveness, deliberately independent of optional upstream services.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION });
});

// Lightweight connectivity checks: never request queues or media libraries.
app.get('/api/:service/ping', async (req, res) => {
  const { service } = req.params;
  if (!['sonarr', 'radarr', 'sabnzbd', 'nzbhydra'].includes(service)) {
    return res.status(404).json({ error: 'Unknown service' });
  }
  const { url, apikey } = loadConfig()[service] || {};
  if (!url || !apikey) return res.status(503).json({ error: 'Service not configured' });
  try {
    if (service === 'sabnzbd') {
      const data = await sabRequest({ mode: 'version' });
      if (!data?.version || data.status === false) throw new Error('Invalid version response');
    } else {
      const baseUrl = url.replace(/\/+$/, '');
      const isHydra = service === 'nzbhydra';
      const response = await axios.get(`${baseUrl}${isHydra ? '/api' : '/api/v3/system/status'}`, {
        headers: isHydra ? {} : { 'X-Api-Key': apikey },
        params: isHydra ? { t: 'caps', o: 'json', apikey } : {},
        timeout: 10000,
        maxRedirects: 0,
      });
      // Some services return a login page or API error with HTTP 200.
      const data = response.data;
      // NZBHydra2 answers caps without a `caps` key (server, limits, searching, categories).
      const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
      const hydraOk = isObject(data) && !Object.prototype.hasOwnProperty.call(data, 'error')
        && (isObject(data.caps) || isObject(data.server) || isObject(data.searching) || isObject(data.categories));
      if (isHydra ? !hydraOk : !data?.version) {
        throw new Error('Invalid service response');
      }
    }
    res.json({ status: 'ok' });
  } catch (_) {
    // Do not return upstream URLs, credentials or Axios request details.
    res.status(503).json({ error: 'Service unavailable' });
  }
});

// ── Config ────────────────────────────────────────────────────────────────────

const SERVICE_IDS = ['sabnzbd', 'nzbhydra', 'sonarr', 'radarr'];
const DEFAULT_PORTS = { sabnzbd: 8080, sonarr: 8989, radarr: 7878, nzbhydra: 5076 };
const MASK_PREFIX = '••••';
const KEY_ALNUM_ERROR = 'API key must contain at least one letter or number.';

// Shared by POST /api/config and POST /api/test/:service. Returns
// { key } (trimmed) for a plain key, or { error }. Masked placeholders are
// handled by the callers before this is used.
function cleanSubmittedKey(raw) {
  if (typeof raw !== 'string') return { error: 'API key must be a string' };
  const key = raw.trim();
  if (!/[A-Za-z0-9]/.test(key)) return { error: KEY_ALNUM_ERROR };
  if (key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) {
    return { error: 'API key is too long or contains control characters' };
  }
  return { key };
}

// Shared service URL normaliser. Returns the normalised URL string, or null
// when invalid. Query strings and fragments are forbidden because proxy routes
// append paths to the stored base URL by string concatenation.
function normalizeServiceUrl(raw, defaultPort) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || /[?#]/.test(s)) return null;
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (!hadScheme) s = `http://${s}`;
  else s = s.replace(/^[a-z][a-z0-9+.-]*(?=:\/\/)/i, m => m.toLowerCase());
  s = s.replace(/\/+$/, '');
  if (!hadScheme && defaultPort) {
    const rest = s.slice(s.indexOf('://') + 3);
    const slash = rest.indexOf('/');
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const tail = slash === -1 ? '' : rest.slice(slash);
    if (!/:\d+$/.test(authority)) s = `http://${authority}:${defaultPort}${tail}`;
  }
  try {
    const u = new NodeURL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || u.username || u.password) return null;
  } catch (_) { return null; }
  return s;
}

function mask(key) {
  const k = String(key || '');
  return k.length > 8 ? MASK_PREFIX + k.slice(-4) : MASK_PREFIX;
}

// Docker environment seeding. Resolved once at startup. A service is
// env-managed only when it has both a resolved key and a resolved address.
function resolveEnvServices(env, log) {
  const managed = {};
  const say = msg => log(`[config] ${msg}`);

  let hostBase = null; // { scheme, host } when ARRVIEW_HOST is valid
  let hostInvalid = false;
  const rawHost = env.ARRVIEW_HOST;
  if (typeof rawHost === 'string' && rawHost.trim()) {
    const m = rawHost.trim().replace(/\/$/, '').match(/^(?:(https?):\/\/)?(.+)$/i);
    const host = m && m[2];
    const ok = host && (/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) ||
      /^\[[0-9A-Fa-f:.]+\]$/.test(host));
    let derivedOk = false;
    if (ok) {
      try { derivedOk = Boolean(new NodeURL(`http://${host}:8080`).hostname); } catch (_) {}
    }
    if (ok && derivedOk) hostBase = { scheme: (m[1] || 'http').toLowerCase(), host };
    else {
      hostInvalid = true;
      say('ARRVIEW_HOST is invalid (use a bare host name or IP, optionally with http:// or https://, no port, path, query or credentials) and is ignored.');
    }
  }

  let anyKey = false;
  for (const svc of SERVICE_IDS) {
    const S = svc.toUpperCase();
    const keyVar = `ARRVIEW_${S}_API_KEY`;
    const fileVar = `${keyVar}_FILE`;
    const urlVar = `ARRVIEW_${S}_URL`;
    const plainRaw = env[keyVar];
    const fileRaw = env[fileVar];
    const plainSet = typeof plainRaw === 'string' && plainRaw.trim() !== '';
    const fileSet = typeof fileRaw === 'string' && fileRaw.trim() !== '';

    let key = null;
    let keyError = false;
    if (plainSet && fileSet) {
      keyError = true;
      say(`${keyVar} and ${fileVar} are both set; set only one. ${svc} env config ignored.`);
    } else if (plainSet) {
      key = plainRaw.trim();
    } else if (fileSet) {
      try { key = String(fs.readFileSync(fileRaw.trim(), 'utf8')).trim(); } catch (_) { key = null; }
      if (!key) {
        key = null; keyError = true;
        say(`${fileVar} is unreadable or empty. ${svc} env config ignored.`);
      }
    } else if (typeof plainRaw === 'string') {
      keyError = true;
      say(`${keyVar} is empty. ${svc} env config ignored.`);
    } else if (typeof fileRaw === 'string') {
      keyError = true;
      say(`${fileVar} is empty. ${svc} env config ignored.`);
    }
    if (key && !/[A-Za-z0-9]/.test(key)) {
      key = null; keyError = true;
      say(`${plainSet ? keyVar : fileVar} must contain at least one letter or number. ${svc} env config ignored.`);
    }
    if (key) anyKey = true;

    let address = null;
    let urlError = false;
    let hasOverride = false;
    const rawUrl = env[urlVar];
    if (typeof rawUrl === 'string' && rawUrl.trim()) {
      hasOverride = true;
      address = normalizeServiceUrl(rawUrl, DEFAULT_PORTS[svc]);
      if (!address) {
        urlError = true;
        say(`${urlVar} is invalid (http/https URL without credentials, query or fragment). ${svc} env config ignored.`);
      }
    } else if (hostBase) {
      address = `${hostBase.scheme}://${hostBase.host}:${DEFAULT_PORTS[svc]}`;
    }

    if (keyError || urlError) continue;
    if (key && address) managed[svc] = { url: address, apikey: key };
    else if (key) say(`${svc} has an API key but no valid address (set ${urlVar} or a valid ARRVIEW_HOST). ${svc} env config ignored.`);
    else if (hasOverride) say(`${urlVar} is set without an API key. ${svc} env config ignored.`);
  }
  if (hostBase && !anyKey) say('ARRVIEW_HOST is set but no service has an ARRVIEW_<SVC>_API_KEY; nothing is env-managed.');
  return managed;
}

const ENV_SERVICES = resolveEnvServices(process.env, msg => console.log(msg));

// Stored config: config.json only.
function loadStoredConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return {};
}

// Effective config: stored config with env-managed services applied on top.
function loadConfig() {
  const config = loadStoredConfig();
  for (const [svc, v] of Object.entries(ENV_SERVICES)) config[svc] = { url: v.url, apikey: v.apikey };
  return config;
}

// Atomic write of the stored config; throws on failure after cleaning up.
function saveConfig(config) {
  const tmp = path.join(CONFIG_DIR, `.config.json.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    // Created owner-only so keys are never readable while the temp file exists.
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    // Keep the existing file mode across the rename. If that fails the temp
    // file stays 0600, which is never broader than the original.
    try { fs.chmodSync(tmp, fs.statSync(CONFIG_FILE).mode & 0o7777); } catch (_) {}
    fs.renameSync(tmp, CONFIG_FILE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// A masked placeholder is only honoured when the address is unchanged.
function resolveMaskedKey(service, submittedKey, normalizedUrl) {
  const current = loadConfig()[service];
  if (!current || typeof current.apikey !== 'string' || !current.apikey) return null;
  if (submittedKey !== mask(current.apikey)) return null;
  const currentUrl = normalizeServiceUrl(current.url);
  if (!currentUrl || currentUrl !== normalizedUrl) return null;
  return current.apikey;
}

const REENTER_KEY_ERROR = 'API key must be re-entered when the address changes';

app.get('/api/config', (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(loadConfig())) {
    out[k] = v && typeof v === 'object' && typeof v.apikey === 'string'
      ? { ...v, apikey: mask(v.apikey) } : v;
  }
  out.envManaged = Object.fromEntries(SERVICE_IDS.map(svc => [svc, Boolean(ENV_SERVICES[svc])]));
  res.json(out);
});

// Identity endpoint used by the ArrView iOS app to confirm a discovered or
// manually entered host is an ArrView server, and which services it proxies.
app.get('/api/arrview/identify', (req, res) => {
  const config = loadConfig();
  const services = {};
  for (const svc of ['sabnzbd', 'sonarr', 'radarr', 'nzbhydra']) {
    services[svc] = Boolean(config[svc]?.url && config[svc]?.apikey);
  }
  res.json({
    app: 'arrview',
    version: APP_VERSION,
    capabilities: ['pwa', 'ping', 'health', 'movieDelete', 'seriesMonitor', 'historyLimit',
      'sonarrQueue', 'radarrQueue', 'episodeStills', 'calendarStills', 'radarrCalendar'],
    services,
  });
});

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Validate a POST /api/config body. Returns { config } or { status, error }.
function buildConfigToSave(body) {
  const bad = error => ({ status: 400, error });
  if (!isPlainObject(body)) return bad('Config must be a JSON object');
  const stored = loadStoredConfig();
  const out = {};
  for (const key of Object.keys(body)) {
    if (key !== 'envManaged' && !SERVICE_IDS.includes(key)) return bad(`Unknown config key: ${key}`);
  }
  for (const svc of SERVICE_IDS) {
    if (!Object.prototype.hasOwnProperty.call(body, svc)) {
      if (ENV_SERVICES[svc] && stored[svc] !== undefined) out[svc] = stored[svc];
      continue;
    }
    const entry = body[svc];
    if (!isPlainObject(entry)) return bad(`${svc} must be an object`);
    const allowed = svc === 'sabnzbd' ? ['url', 'apikey', 'sabPath'] : ['url', 'apikey'];
    for (const k of Object.keys(entry)) {
      if (!allowed.includes(k)) return bad(`Unknown ${svc} key: ${k}`);
    }
    const env = ENV_SERVICES[svc];
    if (env) {
      const same = typeof entry.url === 'string' && normalizeServiceUrl(entry.url) === env.url &&
        typeof entry.apikey === 'string' && (entry.apikey.trim() === env.apikey || entry.apikey.trim() === mask(env.apikey));
      if (!same) {
        const label = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' }[svc];
        return { status: 409, error: `${label} is set by the Docker configuration and can't be changed here` };
      }
      if (stored[svc] !== undefined) out[svc] = stored[svc];
      continue;
    }
    if (typeof entry.url !== 'string' || !entry.url.trim()) return bad(`${svc} url must be a non-empty string`);
    const url = normalizeServiceUrl(entry.url);
    if (!url) return bad(`${svc} url must be an http(s) URL without credentials, query or fragment`);
    if (typeof entry.apikey !== 'string' || !entry.apikey) return bad(`${svc} apikey must be a non-empty string`);
    let apikey = entry.apikey;
    if (apikey.startsWith(MASK_PREFIX)) {
      apikey = resolveMaskedKey(svc, apikey, url);
      if (!apikey) return bad(REENTER_KEY_ERROR);
    } else {
      const cleaned = cleanSubmittedKey(apikey);
      if (cleaned.error) return bad(`${svc}: ${cleaned.error}`);
      apikey = cleaned.key;
    }
    out[svc] = { url, apikey };
    // Keep sabPath only while the address is unchanged; otherwise re-detect.
    if (svc === 'sabnzbd' && SAB_PATHS.includes(entry.sabPath) &&
        normalizeServiceUrl(stored.sabnzbd?.url) === url) out[svc].sabPath = entry.sabPath;
  }
  return { config: out };
}

app.post('/api/config', (req, res) => {
  const result = buildConfigToSave(req.body);
  if (result.error) return res.status(result.status).json({ error: result.error });
  try {
    saveConfig(result.config);
  } catch (_) {
    return res.status(500).json({ error: 'Could not save settings' });
  }
  _sabPathCache = null; // reset so new URL is re-probed (only after a successful save)
  res.json({ success: true });
});

// ── SABnzbd path auto-detection ───────────────────────────────────────────────
// Some installs use /sabnzbd/api (subdirectory), others use /api (root).

const SAB_PATHS = ['/sabnzbd/api', '/api'];

async function detectSabPath(baseUrl, apikey) {
  for (const p of SAB_PATHS) {
    try {
      const r = await axios.get(`${baseUrl}${p}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
        validateStatus: s => s === 200,
      });
      if (r.data && (r.data.version || r.data.status !== false)) return p;
    } catch (_) {}
  }
  return null;
}

// ── Test connections ──────────────────────────────────────────────────────────

app.post('/api/test/:service', async (req, res) => {
  const { service } = req.params;
  const body = isPlainObject(req.body) ? req.body : {};
  if (!body.url || !body.apikey || typeof body.url !== 'string' || typeof body.apikey !== 'string') {
    return res.status(400).json({ error: 'URL and API key are required' });
  }
  const url = normalizeServiceUrl(body.url);
  if (!url) return res.status(400).json({ error: 'Invalid URL: use an http(s) address without credentials, query or fragment' });
  let apikey = body.apikey;
  if (apikey.startsWith(MASK_PREFIX)) {
    apikey = SERVICE_IDS.includes(service) ? resolveMaskedKey(service, apikey, url) : null;
    if (!apikey) return res.status(400).json({ error: REENTER_KEY_ERROR });
  } else {
    const cleaned = cleanSubmittedKey(apikey);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    apikey = cleaned.key;
  }

  try {
    if (service === 'sabnzbd') {
      const detectedPath = await detectSabPath(url, apikey);
      if (!detectedPath) return res.status(503).json({ error: 'Could not reach SABnzbd — check URL and API key' });
      // Fetch version for display
      const r = await axios.get(`${url}${detectedPath}`, {
        params: { mode: 'version', output: 'json', apikey },
        timeout: 8000,
      });
      return res.json({ success: true, version: r.data.version, sabPath: detectedPath });
    }

    if (service === 'sonarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'radarr') {
      const r = await axios.get(`${url}/api/v3/system/status`, {
        headers: { 'X-Api-Key': apikey },
        timeout: 10000,
      });
      return res.json({ success: true, version: r.data.version });
    }

    if (service === 'nzbhydra') {
      await axios.get(`${url}/api`, {
        params: { t: 'caps', o: 'json', apikey },
        timeout: 10000,
      });
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown service' });
  } catch (e) {
    const msg = e.response
      ? `HTTP ${e.response.status}: ${e.response.statusText}`
      : e.code === 'ECONNREFUSED'
      ? 'Connection refused — is the service running?'
      : e.message;
    res.status(503).json({ error: msg });
  }
});

// ── SABnzbd ───────────────────────────────────────────────────────────────────

let _sabPathCache = null;

async function getSabPath(baseUrl, apikey) {
  if (_sabPathCache) return _sabPathCache;
  // Env-managed SABnzbd never reads or persists sabPath: memory cache only.
  const envManaged = Boolean(ENV_SERVICES.sabnzbd);
  if (!envManaged) {
    const stored = loadStoredConfig();
    if (stored.sabnzbd?.sabPath) { _sabPathCache = stored.sabnzbd.sabPath; return _sabPathCache; }
  }
  const detected = await detectSabPath(baseUrl, apikey);
  if (detected) {
    _sabPathCache = detected;
    if (!envManaged) {
      // Persist it (stored config only) so future restarts don't re-probe
      try {
        const fresh = loadStoredConfig();
        fresh.sabnzbd = { ...fresh.sabnzbd, sabPath: detected };
        saveConfig(fresh);
      } catch (_) {}
    }
  }
  return detected;
}

async function sabRequest(params) {
  const config = loadConfig();
  const { url, apikey } = config.sabnzbd || {};
  if (!url || !apikey) throw Object.assign(new Error('SABnzbd not configured'), { status: 503 });
  const sabPath = await getSabPath(url, apikey);
  if (!sabPath) throw Object.assign(new Error('Cannot reach SABnzbd'), { status: 503 });
  const r = await axios.get(`${url}${sabPath}`, {
    params: { output: 'json', apikey, ...params },
    timeout: 10000,
  });
  return r.data;
}

app.get('/api/sabnzbd/queue', async (req, res) => {
  try { res.json(await sabRequest({ mode: 'queue' })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sabnzbd/history', async (req, res) => {
  const limit = req.query.limit === undefined ? 15 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return res.status(400).json({ error: 'limit must be an integer from 1 to 1000' });
  try { res.json(await sabRequest({ mode: 'history', limit })); }
  catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/action', async (req, res) => {
  const { mode, nzo_id, name, value } = req.body;
  try {
    let params;
    if (nzo_id && (mode === 'pause' || mode === 'resume')) {
      // Per-item pause/resume uses mode=queue&name=pause/resume&value=<id>
      params = { mode: 'queue', name: mode, value: nzo_id };
    } else {
      params = { mode };
      if (name)  params.name  = name;
      if (value) params.value = value;
      if (nzo_id && !value) params.value = nzo_id;
    }
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// ── Sonarr ────────────────────────────────────────────────────────────────────

function sonarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.sonarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Sonarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Shared calendar window rule: both bounds are single parseable strings, end is
// after start, and the interval is at most 32 days. Returns null when invalid.
function parseCalendarWindow(query) {
  const { start, end } = query;
  const startTime = typeof start === 'string' ? Date.parse(start) : NaN;
  const endTime = typeof end === 'string' ? Date.parse(end) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) ||
      endTime <= startTime || endTime - startTime > 32 * 86400000) return null;
  return { startTime, endTime };
}

// Poster and fanart (first of each, upstream order), reduced to url fields.
function pickPosterFanart(images) {
  if (!Array.isArray(images)) return [];
  const picked = [];
  let poster = false, fanart = false;
  for (const image of images) {
    if (!image || typeof image !== 'object') continue;
    if (image.coverType === 'poster' && !poster) poster = true;
    else if (image.coverType === 'fanart' && !fanart) fanart = true;
    else continue;
    picked.push({ coverType: image.coverType, url: image.url, remoteUrl: image.remoteUrl });
  }
  return picked;
}

// Sonarr/Radarr queue proxies: bounded page, allowlisted records, and a fixed
// error message. downloadId is passed through verbatim for exact matching.
const QUEUE_PAGE_SIZE = 100;

function queueEnvelopeValid(queue) {
  return !!queue && typeof queue === 'object' && !Array.isArray(queue) &&
    queue.page === 1 && Number.isSafeInteger(queue.pageSize) &&
    queue.pageSize >= 1 && queue.pageSize <= QUEUE_PAGE_SIZE &&
    Number.isSafeInteger(queue.totalRecords) && queue.totalRecords >= 0 &&
    Array.isArray(queue.records) && queue.records.length <= queue.pageSize &&
    queue.records.every(record => record && typeof record === 'object');
}

function queueCommon(record) {
  const qualityName = record.quality?.quality?.name;
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    size: record.size,
    sizeleft: record.sizeleft,
    timeleft: record.timeleft,
    estimatedCompletionTime: record.estimatedCompletionTime,
    trackedDownloadStatus: record.trackedDownloadStatus,
    trackedDownloadState: record.trackedDownloadState,
    downloadId: typeof record.downloadId === 'string' && record.downloadId !== '' ? record.downloadId : null,
    quality: qualityName === undefined || qualityName === null ? null : { name: qualityName },
  };
}

function sendQueueError(res, error, message) {
  // Never expose an axios error/config, upstream paths or authentication material.
  const code = error.response?.status;
  // A 404 from the service is an upstream failure, not a missing ArrView route.
  res.status(code === 404 ? 502 : (code >= 400 && code <= 599 ? code : 503)).json({ error: message });
}

async function fetchQueue({ baseUrl, headers }, includeParams) {
  const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/queue`, {
    headers,
    params: { page: 1, pageSize: QUEUE_PAGE_SIZE, ...includeParams },
    timeout: 10000,
    maxContentLength: 4 * 1024 * 1024,
    maxRedirects: 0,
    responseType: 'json',
    transitional: { silentJSONParsing: false },
  });
  return response.data;
}

app.get('/api/sonarr/queue', async (req, res) => {
  const message = 'Sonarr queue unavailable';
  try {
    const queue = await fetchQueue(sonarrHeaders(), { includeSeries: true, includeEpisode: true });
    if (!queueEnvelopeValid(queue)) return res.status(502).json({ error: message });
    // Deliberate allowlist: no filesystem paths, download client, indexer or overviews.
    const records = queue.records.map(record => {
      const { series, episode } = record;
      return {
        ...queueCommon(record),
        seriesId: record.seriesId,
        episodeId: record.episodeId,
        series: series && typeof series === 'object' ? {
          id: series.id, title: series.title, year: series.year, images: pickPosterFanart(series.images),
        } : null,
        episode: episode && typeof episode === 'object' ? {
          id: episode.id, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
          title: episode.title, airDateUtc: episode.airDateUtc,
        } : null,
      };
    });
    res.json({ page: 1, pageSize: queue.pageSize, totalRecords: queue.totalRecords, records });
  } catch (error) { sendQueueError(res, error, message); }
});

// Bound calendar requests and include series in one upstream call (no N+1).
app.get('/api/sonarr/calendar', async (req, res) => {
  const window = parseCalendarWindow(req.query);
  if (!window) {
    return res.status(400).json({ error: 'Provide a valid start/end interval of at most 32 days' });
  }
  const { startTime, endTime } = window;
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl.replace(/\/$/, '')}/api/v3/calendar`, {
      headers,
      params: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(),
        includeSeries: true, includeEpisodeImages: true, unmonitored: false },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/series/:id/episodes', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/episode`, {
      headers,
      params: { seriesId: req.params.id, includeImages: true },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/command/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/command/${req.params.id}`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Interactive release search for a specific episode.
// Tries Sonarr first; if no results, falls back to a direct NZBHydra search.
// Direct NZBHydra search returning release-shaped objects — the shared
// fallback for both interactive search endpoints (Sonarr + Radarr).
async function hydraDirectSearch(q) {
  const config = loadConfig();
  const { url: hydraUrl, apikey: hydraKey } = config.nzbhydra || {};
  if (!hydraUrl || !hydraKey || !q) return [];

  const hydraRes = await axios.get(`${hydraUrl}/api`, {
    params: { t: 'search', q, o: 'json', apikey: hydraKey },
    timeout: 30000,
  });
  const rawItems = hydraRes.data?.channel?.item || [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]);

  return items.map(item => {
    const attrs = {};
    const rawAttrs = item['newznab:attr'] || item['attr'] || [];
    (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
      const n = a?.['@attributes'] || a;
      if (n?.name) attrs[n.name] = n.value;
    });
    const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
    const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
    const pubDate = item.pubDate ? new Date(item.pubDate) : null;
    const ageHours = pubDate ? (Date.now() - pubDate.getTime()) / 3600000 : null;
    return {
      guid:       item.guid?.['#text'] || item.guid || item.link,
      title:      item.title || '(no title)',
      indexer:    attrs.indexer || attrs.site || 'NZBHydra',
      size:       sizeBytes,
      ageHours,
      protocol:   'usenet',
      approved:   true,
      rejections: [],
      quality:    { quality: { name: 'Unknown' } },
      // For NZBHydra-direct results we send the NZB URL to SABnzbd ourselves
      _source:    'nzbhydra',
      _nzbUrl:    encUrl,
    };
  }).filter(r => r._nzbUrl);
}

app.get('/api/sonarr/release', async (req, res) => {
  const { episodeId, seriesTitle, season, episode } = req.query;
  try {
    // 1. Ask Sonarr (it queries all its configured indexers)
    const { baseUrl, headers } = sonarrHeaders();
    const sonarrRes = await axios.get(`${baseUrl}/api/v3/release`, {
      headers,
      params: { episodeId },
      timeout: 60000,
    });
    const sonarrResults = (sonarrRes.data || []).map(r => ({ ...r, _source: 'sonarr' }));

    if (sonarrResults.length > 0) {
      return res.json(sonarrResults);
    }

    // 2. Fallback: direct NZBHydra search if Sonarr found nothing
    if (!seriesTitle) return res.json([]);
    const sn = String(season || '').padStart(2, '0');
    const ep = String(episode || '').padStart(2, '0');
    res.json(await hydraDirectSearch(`${seriesTitle} S${sn}E${ep}`));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Grab a specific release
app.post('/api/sonarr/release', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/release`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Delete an episode file from disk
app.delete('/api/sonarr/episodefile/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    await axios.delete(`${baseUrl}/api/v3/episodefile/${req.params.id}`, { headers, timeout: 15000 });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Update episode monitored status
app.put('/api/sonarr/episode/monitor', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.put(`${baseUrl}/api/v3/episode/monitor`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/series/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/sonarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/sonarr/series', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/series`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

// Read the current resource so changing monitoring preserves Sonarr metadata.
app.put('/api/sonarr/series/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id) || typeof req.body.monitored !== 'boolean')
    return res.status(400).json({ error: 'A numeric series id and boolean monitored are required' });
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const url = `${baseUrl.replace(/\/+$/, '')}/api/v3/series/${req.params.id}`;
    const current = await axios.get(url, { headers, timeout: 15000 });
    const updated = await axios.put(url, { ...current.data, monitored: req.body.monitored }, { headers, timeout: 15000 });
    res.json(updated.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.response?.data?.message || e.message }); }
});

app.delete('/api/sonarr/series/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = sonarrHeaders();
    const deleteFiles = req.query.deleteFiles === 'true';
    await axios.delete(`${baseUrl}/api/v3/series/${req.params.id}`, {
      headers,
      params: { deleteFiles, addImportListExclusion: false },
      timeout: 15000,
    });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// ── Radarr ────────────────────────────────────────────────────────────────────

function radarrHeaders() {
  const config = loadConfig();
  const { url, apikey } = config.radarr || {};
  if (!url || !apikey) throw Object.assign(new Error('Radarr not configured'), { status: 503 });
  return { baseUrl: url, headers: { 'X-Api-Key': apikey } };
}

app.get('/api/radarr/movies', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie`, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/queue', async (req, res) => {
  const message = 'Radarr queue unavailable';
  try {
    const queue = await fetchQueue(radarrHeaders(), { includeMovie: true });
    if (!queueEnvelopeValid(queue)) return res.status(502).json({ error: message });
    // Deliberate allowlist: no filesystem paths, download client, indexer or overviews.
    const records = queue.records.map(record => {
      const movie = record.movie;
      return {
        ...queueCommon(record),
        movieId: record.movieId,
        movie: movie && typeof movie === 'object' ? {
          id: movie.id, title: movie.title, year: movie.year, images: pickPosterFanart(movie.images),
        } : null,
      };
    });
    res.json({ page: 1, pageSize: queue.pageSize, totalRecords: queue.totalRecords, records });
  } catch (error) { sendQueueError(res, error, message); }
});

// Digital and physical releases only. Radarr returns a movie when any of its
// dates (cinema included) is in the window, so the server applies the product
// rule once for every client: keep a movie only if its digital or physical
// release falls inside the validated window (inclusive).
const RADARR_CALENDAR_LIMIT = 500;
app.get('/api/radarr/calendar', async (req, res) => {
  const window = parseCalendarWindow(req.query);
  if (!window) {
    return res.status(400).json({ error: 'Provide a valid start/end interval of at most 32 days' });
  }
  const { startTime, endTime } = window;
  const message = 'Radarr calendar unavailable';
  try {
    const { baseUrl, headers } = radarrHeaders();
    const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/calendar`, {
      headers,
      params: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString(), unmonitored: false },
      timeout: 10000,
      maxContentLength: 4 * 1024 * 1024,
      maxRedirects: 0,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
    });
    if (!Array.isArray(response.data)) return res.status(502).json({ error: message });
    const inWindow = value => {
      const time = typeof value === 'string' ? Date.parse(value) : NaN;
      return time >= startTime && time <= endTime;
    };
    const movies = [];
    for (const movie of response.data) {
      if (movies.length >= RADARR_CALENDAR_LIMIT) break;
      if (!movie || typeof movie !== 'object') continue;
      if (!inWindow(movie.digitalRelease) && !inWindow(movie.physicalRelease)) continue;
      // Deliberate allowlist: no filesystem paths, overviews, ratings or external ids.
      movies.push({
        id: movie.id ?? null, title: movie.title ?? null, year: movie.year ?? null,
        monitored: movie.monitored ?? null, hasFile: movie.hasFile ?? null,
        isAvailable: movie.isAvailable ?? null, status: movie.status ?? null,
        inCinemas: movie.inCinemas ?? null, digitalRelease: movie.digitalRelease ?? null,
        physicalRelease: movie.physicalRelease ?? null,
        physicalReleaseNote: movie.physicalReleaseNote ?? null,
        images: pickPosterFanart(movie.images),
      });
    }
    res.json(movies);
  } catch (error) { sendQueueError(res, error, message); }
});

// Widget metadata must never fetch the full movie library. Radarr's paged
// history takes numeric eventType=3 (downloadFolderImported), newest first.
// Bounds match the widget client: 20 records/page, at most three pages.
app.get('/api/radarr/history/recent-imports', async (req, res) => {
  const pageText = req.query.page ?? '1';
  if (typeof pageText !== 'string' || !/^[1-3]$/.test(pageText)) {
    return res.status(400).json({ error: 'page must be an integer from 1 to 3' });
  }
  const page = Number(pageText);
  const pageSize = 20;
  try {
    const { baseUrl, headers } = radarrHeaders();
    const response = await axios.get(`${baseUrl.replace(/\/+$/, '')}/api/v3/history`, {
      headers,
      params: { page, pageSize, eventType: 3, includeMovie: true, sortKey: 'date', sortDirection: 'descending' },
      timeout: 10000,
      maxContentLength: 512 * 1024,
      maxRedirects: 0,
      responseType: 'json',
      transitional: { silentJSONParsing: false },
    });
    const history = response.data;
    if (history?.page !== page || !Number.isSafeInteger(history.pageSize) ||
        history.pageSize < 1 || history.pageSize > pageSize ||
        !Number.isSafeInteger(history.totalRecords) || history.totalRecords < 0 ||
        !Array.isArray(history.records) || history.records.length > history.pageSize ||
        history.totalRecords < history.records.length ||
        (history.records.length === 0 && history.totalRecords > (page - 1) * history.pageSize)) {
      return res.status(502).json({ error: 'Invalid Radarr history page' });
    }
    // Deliberate allowlist: no filesystem paths, release metadata or overviews.
    const records = history.records.map(record => {
      const movie = record.movie;
      return {
        movieId: record.movieId, date: record.date, eventType: record.eventType,
        movie: movie ? {
          id: movie.id, title: movie.title, year: movie.year,
          hasFile: movie.hasFile, movieFileId: movie.movieFileId,
          movieFile: movie.movieFile ? { id: movie.movieFile.id, dateAdded: movie.movieFile.dateAdded } : null,
          images: Array.isArray(movie.images) ? movie.images.filter(image => image.coverType === 'poster').slice(0, 1)
            .map(image => ({ coverType: image.coverType, url: image.url, remoteUrl: image.remoteUrl })) : [],
        } : null,
      };
    });
    res.json({ page, pageSize: history.pageSize, totalRecords: history.totalRecords, records });
  } catch (error) {
    // Never expose an axios error/config, upstream paths or authentication material.
    const code = error.response?.status;
    // A 404 from Radarr is an upstream failure, not a missing ArrView route.
    res.status(code === 404 ? 502 : (code >= 400 && code <= 599 ? code : 503))
      .json({ error: 'Recent movie imports unavailable' });
  }
});

app.post('/api/radarr/command', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/command`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Interactive release search for one movie: Radarr's indexers first,
// NZBHydra fallback — mirrors /api/sonarr/release.
app.get('/api/radarr/release', async (req, res) => {
  const { movieId, title, year } = req.query;
  try {
    const { baseUrl, headers } = radarrHeaders();
    const radarrRes = await axios.get(`${baseUrl}/api/v3/release`, {
      headers,
      params: { movieId },
      timeout: 60000,
    });
    const radarrResults = (radarrRes.data || []).map(r => ({ ...r, _source: 'radarr' }));

    if (radarrResults.length > 0) {
      return res.json(radarrResults);
    }

    if (!title) return res.json([]);
    res.json(await hydraDirectSearch(year ? `${title} ${year}` : title));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Grab a specific movie release
app.post('/api/radarr/release', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/release`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

// Delete a movie file from disk
app.delete('/api/radarr/moviefile/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    await axios.delete(`${baseUrl}/api/v3/moviefile/${req.params.id}`, { headers, timeout: 15000 });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Remove a movie from Radarr's library; deleteFiles=true also deletes its folder.
// Radarr spells the exclusion flag addImportExclusion — Sonarr's
// addImportListExclusion is silently ignored here, so don't copy the series route.
app.delete('/api/radarr/movie/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid movie id' });
  try {
    const { baseUrl, headers } = radarrHeaders();
    const deleteFiles = req.query.deleteFiles === 'true';
    await axios.delete(`${baseUrl.replace(/\/+$/, '')}/api/v3/movie/${req.params.id}`, {
      headers,
      params: { deleteFiles, addImportExclusion: false },
      timeout: 15000,
    });
    res.json({ success: true });
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    res.status(e.response?.status || 503).json({ error: String(msg) });
  }
});

// Update movie monitored status (bulk, via Radarr's movie editor)
app.put('/api/radarr/movie/monitor', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.put(`${baseUrl}/api/v3/movie/editor`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/lookup', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/movie/lookup`, {
      headers, params: { term: req.query.term }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/qualityprofiles', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/qualityprofile`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.get('/api/radarr/rootfolders', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.get(`${baseUrl}/api/v3/rootfolder`, { headers, timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});

app.post('/api/radarr/movie', async (req, res) => {
  try {
    const { baseUrl, headers } = radarrHeaders();
    const r = await axios.post(`${baseUrl}/api/v3/movie`, req.body, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.message || e.response?.data?.[0]?.errorMessage || e.message;
    res.status(e.response?.status || 503).json({ error: msg });
  }
});

app.get('/api/nzbhydra/search', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  const { q, cat } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    const params = { t: 'search', q, o: 'json', apikey };
    if (cat) params.cat = cat;
    const r = await axios.get(`${url}/api`, { params, timeout: 30000 });
    const items = r.data?.channel?.item || [];
    const results = (Array.isArray(items) ? items : [items]).map(item => {
      const attrs = {};
      const rawAttrs = item['newznab:attr'] || item['attr'] || [];
      (Array.isArray(rawAttrs) ? rawAttrs : [rawAttrs]).forEach(a => {
        const n = a?.['@attributes'] || a;
        if (n?.name) attrs[n.name] = n.value;
      });
      const encUrl = item.enclosure?.['@attributes']?.url || item.enclosure?.url || item.link;
      const sizeBytes = parseInt(attrs.size || item.size || item.enclosure?.['@attributes']?.length || 0);
      return {
        title:    item.title || '(no title)',
        guid:     item.guid?.['#text'] || item.guid || item.link,
        link:     encUrl,
        size:     sizeBytes,
        pubDate:  item.pubDate,
        category: item.category,
        indexer:  attrs.indexer || attrs.site || '',
        grabs:    attrs.grabs || 0,
      };
    }).filter(r => r.link);
    res.json(results);
  } catch (e) { res.status(503).json({ error: e.message }); }
});

app.post('/api/sabnzbd/addurl', async (req, res) => {
  const { url: nzbUrl, name } = req.body;
  if (!nzbUrl) return res.status(400).json({ error: 'Missing url' });
  try {
    const params = { mode: 'addurl', name: nzbUrl };
    if (name) params.nzbname = name;
    res.json(await sabRequest(params));
  } catch (e) { res.status(e.response?.status || 503).json({ error: e.message }); }
});



app.get('/api/nzbhydra/status', async (req, res) => {
  const config = loadConfig();
  const { url, apikey } = config.nzbhydra || {};
  if (!url || !apikey) return res.status(503).json({ error: 'NZBHydra not configured' });
  try {
    await axios.get(`${url}/api`, { params: { t: 'caps', o: 'json', apikey }, timeout: 10000 });
    res.json({ status: 'ok' });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

// ── Server-Sent Events ────────────────────────────────────────────────────────
// Browser clients subscribe here and receive push notifications when Sonarr
// (or Radarr) webhooks fire, triggering an immediate UI refresh.

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  // Keep-alive ping every 25s to prevent proxy/browser timeouts
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  sseClients.add(res);
  req.on('close', () => { sseClients.delete(res); clearInterval(ping); });
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

// ── Sonarr webhook ────────────────────────────────────────────────────────────
// In Sonarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/sonarr
//   Method: POST
//   Events: On Download (Import), On Episode File Delete, On Rename

app.post('/api/webhooks/sonarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, series, episodes } = req.body;
  if (!eventType || eventType === 'Test') return;
  console.log(`[Sonarr webhook] ${eventType} — series: ${series?.title}`);
  broadcast('sonarr', {
    eventType,
    seriesId:   series?.id   ?? null,
    seriesTitle: series?.title ?? null,
    episodeIds: (episodes ?? []).map(e => e.id),
  });
});

// ── Radarr webhook ────────────────────────────────────────────────────────────
// In Radarr: Settings → Connect → + → Webhook
//   URL:    http://<this-server>/api/webhooks/radarr
//   Method: POST
//   Events: On Download (Import), On Movie File Delete

app.post('/api/webhooks/radarr', (req, res) => {
  res.sendStatus(200);
  const { eventType, movie } = req.body;
  if (!eventType || eventType === 'Test') return;
  console.log(`[Radarr webhook] ${eventType} — movie: ${movie?.title}`);
  broadcast('radarr', {
    eventType,
    movieId:    movie?.id    ?? null,
    movieTitle: movie?.title ?? null,
  });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  const isApi = req.path === '/api' || req.path.startsWith('/api/');
  res.setHeader('Cache-Control', isApi ? 'no-store' : 'no-cache');
  if (isApi || path.extname(req.path)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Run `npm run build` first, or use `npm run dev` for development.');
  }
});

app.listen(PORT, () => {
  console.log(`✅  ArrView API running on http://localhost:${PORT}`);
  console.log(`    Sonarr webhook URL: http://localhost:${PORT}/api/webhooks/sonarr`);
  console.log(`    Radarr webhook URL: http://localhost:${PORT}/api/webhooks/radarr`);

  // Advertise over Bonjour so the ArrView iOS app can auto-discover this
  // server. Optional dependency — absence just disables auto-discovery.
  try {
    const { Bonjour } = require('bonjour-service');

    // The SRV target and A records must live under `.local`, or clients resolve
    // them via unicast DNS and fail. Inside a container os.hostname() is the bare
    // container ID (no TLD), so append `.local` explicitly.
    const advertiseHost =
      (process.env.ADVERTISE_HOST || os.hostname()).replace(/\.local\.?$/i, '') + '.local';

    // Pick a single LAN IPv4 to advertise. Under host networking the container
    // sees every host interface (LAN + docker0 + bridges + VPNs); advertising
    // the docker bridge (e.g. 172.17.0.1) hands iOS an unreachable address to
    // try, which breaks discovery. ADVERTISE_IP overrides the auto-pick.
    const advertiseIP = process.env.ADVERTISE_IP || (() => {
      const skip = /^(docker|br-|veth|virbr|cni|flannel|tailscale|zt|wg|lo)/i;
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        if (skip.test(name)) continue;
        for (const a of addrs || []) {
          if ((a.family === 'IPv4' || a.family === 4) && !a.internal) return a.address;
        }
      }
      return null;
    })();

    // bonjour-service builds A records from os.networkInterfaces() on every
    // announce/response with no filter hook, so constrain what it sees to the
    // chosen address. A non-zero mac is required — it skips 00:..:00 entries.
    if (advertiseIP) {
      os.networkInterfaces = () => ({
        lan: [{ address: advertiseIP, netmask: '255.255.255.0', family: 'IPv4',
                mac: '02:00:00:00:00:01', internal: false, cidr: `${advertiseIP}/24` }],
      });
    }

    // Bonjour must never take the server down. When another mDNS responder on the
    // host owns UDP 5353 without sharing it (Avahi, a NAS's own discovery service),
    // the bind fails after construction, as an async 'error' event on the
    // multicast-dns instance. bonjour-service 1.4 attaches no listener for it, so
    // Node exits and a restart policy loops the container; its default errorCallback
    // rethrows as well. Point both at a logger. multicast-dns reports one failed
    // bind twice and retries it on every send, so each distinct problem logs once.
    const reported = new Set();
    const onBonjourError = (err) => {
      const message = (err && err.message) || String(err);
      if (reported.has(message)) return;
      reported.add(message);
      console.log(err && err.code === 'EADDRINUSE'
        ? `    Bonjour: ${message} — another mDNS responder on this host (Avahi or a NAS's discovery service, say) holds UDP 5353 and does not share it, so iOS auto-discovery is unavailable. ArrView keeps running; add the server in the app by address.`
        : `    Bonjour: ${message} — iOS auto-discovery may not work. ArrView keeps running.`);
    };
    const bonjour = new Bonjour({}, onBonjourError);
    if (bonjour.server && bonjour.server.mdns) bonjour.server.mdns.on('error', onBonjourError);

    bonjour.publish({ name: 'ArrView', type: 'arrview', port: Number(PORT), host: advertiseHost });
    console.log(`    Bonjour: advertising _arrview._tcp as ${advertiseHost} (${advertiseIP || 'all interfaces'}):${PORT}`);
  } catch (err) {
    console.log(err && err.code === 'MODULE_NOT_FOUND'
      ? '    Bonjour: bonjour-service not installed — iOS auto-discovery disabled'
      : `    Bonjour: couldn't start (${(err && err.message) || err}) — iOS auto-discovery disabled`);
  }
});
