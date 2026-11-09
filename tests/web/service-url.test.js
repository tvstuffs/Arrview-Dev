import { test, expect } from 'vitest'
import { addressProblem, cleanAddress, DEFAULT_PORTS } from '../../src/serviceUrl'
import table from '../fixtures/service-urls.json'

// The browser's copy of the address rule of Settings → Services. The server's copy is tested against the same table in
// tests/service-url.test.js: an http:// address names its port, an https:// address needs none.

test('every case of the shared table gets the sentence the server gives, or none', () => {
  for (const c of table.cases) {
    expect(addressProblem(c.input, c.service), `${c.service} ${c.input}`).toBe(c.problem ?? null)
  }
})

test('the suggestion uses the address that was typed and the app\'s usual port', () => {
  expect(DEFAULT_PORTS).toEqual({ sabnzbd: 8080, nzbhydra: 5076, sonarr: 8989, radarr: 7878 })
  expect(addressProblem('http://192.0.2.10', 'sabnzbd')).toBe('Add the port, for example http://192.0.2.10:8080. An https:// address needs none.')
  expect(addressProblem('  192.0.2.10  ', 'nzbhydra')).toContain('http://192.0.2.10:5076')
})

test('nothing is said about an empty field, or about an address that is not an http(s) address at all (the server says that)', () => {
  for (const raw of ['', '   ', undefined, null, 'ftp://nas.example.invalid', 'http://user:pw@nas.example.invalid', 'http://bad host',
    'http://nas.example.invalid:99999', 'http://nas.example.invalid/?x=1', 'http://']) {
    expect(addressProblem(raw, 'sonarr'), String(raw)).toBeNull()
  }
})

test('an address that is already saved is left alone, however it is written; a changed one is not', () => {
  const saved = 'http://nas.example.invalid'
  expect(addressProblem('http://nas.example.invalid', 'radarr', saved)).toBeNull()
  expect(addressProblem('HTTP://nas.example.invalid/', 'radarr', saved)).toBeNull()
  expect(addressProblem('nas.example.invalid', 'radarr', saved)).toBeNull()
  expect(addressProblem('http://nas2.example.invalid', 'radarr', saved)).toMatch(/^Add the port/)
  expect(addressProblem('http://nas.example.invalid/radarr', 'radarr', saved)).toMatch(/^Add the port/)
  expect(addressProblem('http://nas.example.invalid', 'radarr', '')).toMatch(/^Add the port/)
})

test('cleanAddress reads an address as the server does', () => {
  expect(cleanAddress('  192.0.2.10:8989/ ')).toBe('http://192.0.2.10:8989')
  expect(cleanAddress('HTTPS://Nas.Example.invalid//')).toBe('https://Nas.Example.invalid')
  expect(cleanAddress('')).toBe('')
  expect(cleanAddress(undefined)).toBe('')
})
