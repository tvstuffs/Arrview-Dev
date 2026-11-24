const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Vite dev server serves files from the project folder, which is also the default data folder. Setting server.fs.deny replaces
// Vite's own list, so Vite's defaults are repeated and the data files the server writes are added. Importing vite.config.js under
// vitest fails in this repo (esbuild's TextEncoder check under jsdom; the node environment cannot load tests/web/setup.js), so the
// list is read from the file's text, as the spec allows.

test('V1: server.fs.deny keeps Vite\'s defaults and adds the data files', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'vite.config.js'), 'utf8');
  const match = text.match(/fs:\s*\{\s*deny:\s*(\[[^\]]*\])/);
  assert.ok(match, 'vite.config.js sets server.fs.deny as a literal list');
  const deny = JSON.parse(match[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const pattern of ['.env', '.env.*', '*.{crt,pem}', '**/.git/**',
    'config.json', 'auth.json', '.config.json.*.tmp', '.auth.json.*.tmp']) {
    assert.ok(deny.includes(pattern), pattern);
  }
});
