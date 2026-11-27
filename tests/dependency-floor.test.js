const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// D1-lock (job 013): every production copy of these packages in package-lock.json is above the top of its known advisory range.
// The lockfile is read from disk; nothing is fetched.

const FLOORS = {
  'proxy-addr': '2.0.7',
  'shell-quote': '1.10.0',
  axios: '1.19.0',
  'body-parser': '1.20.8',
  'follow-redirects': '1.16.1',
  'form-data': '4.0.5',
  qs: '6.16.0',
};

function compare(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

test('D1-lock (013): production dependencies are above their advisory ranges', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  for (const [name, floor] of Object.entries(FLOORS)) {
    const entries = Object.entries(lock.packages)
      .filter(([key, entry]) => key.endsWith(`node_modules/${name}`) && !entry.dev);
    assert.ok(entries.length > 0, `${name} is in the lockfile`);
    for (const [key, entry] of entries) {
      assert.ok(compare(entry.version, floor) > 0, `${key} ${entry.version} must be above ${floor}`);
    }
  }
});
