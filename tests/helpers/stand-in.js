// A recording stand-in upstream for the hardening tests: answers are written out per "METHOD /path" or "/path" (a
// function gets (req, url, body) and returns { status, headers, body }), anything else is a 200 with `fallback`.
// Every request is recorded with its method, path, query, API key and raw body.
const http = require('node:http');

async function standIn(t, routes = {}, { host = '127.0.0.1', fallback = '[]' } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://upstream.invalid');
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
        rawQuery: url.search, key: req.headers['x-api-key'], body });
      let r = routes[`${req.method} ${url.pathname}`] || routes[url.pathname];
      if (typeof r === 'function') r = r(req, url, body);
      r = r || { status: 200, body: fallback };
      res.writeHead(r.status || 200, { 'Content-Type': 'application/json', ...(r.headers || {}) });
      res.end(r.body ?? '');
    });
  });
  await new Promise(resolve => server.listen(0, host, resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  return { hits, port, url: `http://${host}:${port}` };
}

module.exports = { standIn };
