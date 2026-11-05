import { test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { WEBHOOK_TRIGGERS, normalizeAddress, webhookUrl } from '../../src/webhooks'
import urlTable from '../fixtures/webhook-urls.json'

// The server writes the webhook into Sonarr and Radarr; the guide and the Set up preview describe it. Both sides
// hold the trigger list and the URL rule, and these tests keep them the same.
const SERVER = fs.readFileSync(path.resolve(__dirname, '../../server.js'), 'utf8')

function serverTriggers() {
  const begin = SERVER.indexOf('// webhookTriggers:begin')
  const end = SERVER.indexOf('// webhookTriggers:end')
  expect(begin).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(begin)
  return new Function(`${SERVER.slice(begin, end)}; return WEBHOOK_TRIGGERS;`)()
}

test('the trigger list in src/webhooks.js is the server block, fields and labels in order', () => {
  expect(WEBHOOK_TRIGGERS).toEqual(serverTriggers())
  for (const service of ['sonarr', 'radarr']) expect(WEBHOOK_TRIGGERS[service]).toHaveLength(6)
  // The field names are the live ones: Radarr's is onMovieAdded.
  expect(WEBHOOK_TRIGGERS.radarr.map(t => t.field)).toContain('onMovieAdded')
})

test('the guide builds the same webhook URL from a saved address as the server writes into the app', () => {
  expect(urlTable.length).toBeGreaterThanOrEqual(4)
  for (const row of urlTable) {
    for (const service of ['sonarr', 'radarr']) expect(webhookUrl(normalizeAddress(row.base), service), row.base).toBe(row[service])
  }
})
