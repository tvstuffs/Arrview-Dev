const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const readme = read('README.md');
const changelog = read('CHANGELOG.md');

test('README documents the variables and the app warning', () => {
  for (const needle of ['ARRVIEW_PASSWORD', 'ARRVIEW_PASSWORD_FILE', 'ARRVIEW_AUTH=off', 'ARRVIEW_TRUSTED_PROXIES', 'cannot sign in yet', '### Password login (optional)']) {
    assert.ok(readme.includes(needle), needle);
  }
  assert.ok(!readme.includes('still has no login'));
  assert.ok(!readme.includes('still has no built-in'));
});

test('CHANGELOG has the 1.9A5 login section above 1.9A4', () => {
  const heading = '## 1.9A5 (unreleased) — Optional password login';
  assert.ok(changelog.split('\n').includes(heading), heading);
  assert.ok(changelog.indexOf(heading) < changelog.indexOf('## 1.9A4'));
});

test('README, CHANGELOG and the compose file hold no local path or private network address', () => {
  for (const [name, text] of [['README.md', readme], ['CHANGELOG.md', changelog], ['docker-compose.yml', read('docker-compose.yml')]]) {
    assert.ok(!text.includes('/Users/'), `${name} has a /Users/ path`);
    assert.ok(!/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|169\.254)\.\d{1,3}\.\d{1,3}\b/.test(text), `${name} has a private address`);
  }
});
