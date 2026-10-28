import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, act, waitFor } from '@testing-library/react'
import WebhookSettings from '../../src/components/WebhookSettings'
import ConfigPage from '../../src/components/ConfigPage'
import Dashboard from '../../src/components/Dashboard'
import { describeActivity, eventLabel, formatAge, readActivity } from '../../src/webhooks'
import { reply, config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// "Last event received" in the Webhooks card: what GET /api/webhooks/last says Sonarr and Radarr last delivered,
// read safely, worded in plain language and refreshed every few seconds while Settings is in view.

const none = { event: null, test: null }
const seen = (eventType, ageSeconds) => ({ eventType, ageSeconds })
const answer = (extra = {}) => ({ uptimeSeconds: 600, sonarr: none, radarr: none, ...extra })
const MINUTE = 60, HOUR = 3600, DAY = 86400

test('formatAge counts in whole units and never says less than a minute is a number', () => {
  const table = [[0, 'less than a minute ago'], [1, 'less than a minute ago'], [59, 'less than a minute ago'], [59.9, 'less than a minute ago'],
    [60, '1 minute ago'], [119, '1 minute ago'], [120, '2 minutes ago'], [3599, '59 minutes ago'],
    [HOUR, '1 hour ago'], [2 * HOUR - 1, '1 hour ago'], [2 * HOUR, '2 hours ago'], [DAY - 1, '23 hours ago'],
    [DAY, '1 day ago'], [2 * DAY, '2 days ago'], [10 * DAY + 5, '10 days ago']]
  for (const [seconds, text] of table) expect(formatAge(seconds), String(seconds)).toBe(text)
  for (const bad of [-5, NaN, Infinity, undefined, null, '90', {}]) expect(formatAge(bad), String(bad)).toBe('less than a minute ago')
})

test('eventLabel puts the event types of Sonarr and Radarr in words', () => {
  const table = [['Download', 'Download (file import)'], ['Test', 'Test message'], ['Grab', 'Grab'], ['Rename', 'Rename'],
    ['SeriesAdd', 'Series add'], ['SeriesDelete', 'Series delete'], ['EpisodeFileDelete', 'Episode file delete'],
    ['MovieAdded', 'Movie added'], ['MovieDelete', 'Movie delete'], ['MovieFileDelete', 'Movie file delete'],
    ['Health', 'Health'], ['HealthRestored', 'Health restored'], ['ApplicationUpdate', 'Application update'],
    ['ManualInteractionRequired', 'Manual interaction required'], ['X', 'X'], ['abc', 'Abc']]
  for (const [type, text] of table) expect(eventLabel(type), type).toBe(text)
})

test('readActivity keeps what is usable and refuses anything that is not the server\'s answer', () => {
  expect(readActivity({ uptimeSeconds: 12.9, sonarr: { event: seen('Download', 5.9), test: seen('Test', 0) }, radarr: none, extra: 'ignored' }))
    .toEqual({ uptimeSeconds: 12, sonarr: { event: seen('Download', 5), test: seen('Test', 0) }, radarr: none })
  // One service missing or empty reads as nothing seen for it.
  expect(readActivity({ uptimeSeconds: 1, sonarr: { event: seen('Rename', 3) } }))
    .toEqual({ uptimeSeconds: 1, sonarr: { event: seen('Rename', 3), test: null }, radarr: none })
  // An entry that is not plain letters and a whole age is dropped on its own, and so is an unusable uptime.
  const bad = ['<b>x</b>', 'Down load', 'Download1', 'a'.repeat(41), '', 42, null, ['Download'], undefined]
  for (const eventType of bad) {
    expect(readActivity(answer({ sonarr: { event: seen(eventType, 5), test: null } })).sonarr.event, JSON.stringify(eventType)).toBeNull()
  }
  for (const ageSeconds of [-1, NaN, Infinity, '5', null, undefined]) {
    expect(readActivity(answer({ radarr: { event: null, test: seen('Test', ageSeconds) } })).radarr.test, String(ageSeconds)).toBeNull()
  }
  for (const uptimeSeconds of [-1, NaN, '60', null, undefined]) expect(readActivity(answer({ uptimeSeconds })).uptimeSeconds, String(uptimeSeconds)).toBeNull()
  // Not the answer to that request at all.
  for (const body of [null, undefined, [], 'text', 7, true, {}, { version: '1' }, { sonarr: 'x', radarr: 5 }, { uptimeSeconds: 5 }, [{ sonarr: none }]]) {
    expect(readActivity(body), JSON.stringify(body)).toBeNull()
  }
})

test('describeActivity says what a service last delivered, and that a Test message arrived, in sentences', () => {
  const table = [
    [none, 30, 0, 'No event since ArrView started less than a minute ago.'],
    [none, 2 * DAY, 0, 'No event since ArrView started 2 days ago.'],
    [none, null, 0, 'No event yet.'],
    [{ event: seen('Download', 3 * HOUR + 5), test: null }, 1, 0, 'Download (file import), 3 hours ago.'],
    [{ event: null, test: seen('Test', 4) }, DAY, 0, 'No event since ArrView started 1 day ago. Test message received less than a minute ago.'],
    [{ event: seen('Rename', 5 * MINUTE), test: seen('Test', 2 * MINUTE) }, 9999, 0, 'Rename, 5 minutes ago. Test message received 2 minutes ago.'],
    [{ event: seen('MovieAdded', 50), test: seen('Test', 55) }, 50, 15, 'Movie added, 1 minute ago. Test message received 1 minute ago.'],
    [{ event: null, test: null }, 50, 15, 'No event since ArrView started 1 minute ago.'],
  ]
  for (const [entry, uptime, elapsed, text] of table) expect(describeActivity(entry, uptime, elapsed), text).toBe(text)
  expect(describeActivity(none, 30)).toBe('No event since ArrView started less than a minute ago.')
})

// --- the card ---

const remote = { hostname: 'nas.example.invalid', origin: 'http://nas.example.invalid:7777' }
const NOW = 1_800_000_000_000
const ready = (body, receivedAt = NOW) => ({ status: 'ready', data: readActivity(body), receivedAt })
function card(props = {}) {
  return render(<WebhookSettings address="" onAddressChange={() => {}} sonarr radarr location={remote} now={NOW} {...props} />)
}
const items = () => within(screen.getByRole('list', { name: 'Last event received' })).getAllByRole('listitem').map(item => item.textContent)

test('the section tells what it is, how fresh it is and what it cannot tell, before any answer', () => {
  const { container } = card()
  expect(screen.getByRole('heading', { level: 3, name: 'Last event received' })).toBeInTheDocument()
  expect(screen.getByText('Checking…')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Last event received' })).toBeNull()
  expect(container).toHaveTextContent('Updates every few seconds while this page is open.')
  expect(container).toHaveTextContent('It starts empty when ArrView restarts')
  expect(container).toHaveTextContent('it shows that a message arrived, not who sent it.')
})

test('a ready answer lists each service that is set up, with the event and the Test message', () => {
  card({ activity: ready(answer({ uptimeSeconds: 2 * DAY + 5, sonarr: { event: seen('Download', 3 * HOUR), test: seen('Test', 20) }, radarr: none })) })
  expect(items()).toEqual([
    'Sonarr: Download (file import), 3 hours ago. Test message received less than a minute ago.',
    'Radarr: No event since ArrView started 2 days ago.',
  ])
  expect(screen.queryByText('Checking…')).toBeNull()
})

test('only the services that are set up are listed', () => {
  const data = answer({ sonarr: { event: seen('Rename', 5), test: null }, radarr: { event: seen('MovieAdded', 9), test: null } })
  const { unmount } = card({ radarr: false, activity: ready(data) })
  expect(items()).toEqual(['Sonarr: Rename, less than a minute ago.'])
  unmount()
  card({ sonarr: false, activity: ready(data) })
  expect(items()).toEqual(['Radarr: Movie added, less than a minute ago.'])
})

test('time keeps counting between polls: the age is the server\'s plus the seconds since it arrived', () => {
  const data = answer({ uptimeSeconds: 100, sonarr: { event: seen('Download', 40), test: null }, radarr: none })
  const { unmount } = card({ activity: ready(data, NOW - 30_000) })
  expect(items()).toEqual(['Sonarr: Download (file import), 1 minute ago.', 'Radarr: No event since ArrView started 2 minutes ago.'])
  unmount()
  card({ activity: ready(data, NOW + 5_000) })
  expect(items()[0]).toBe('Sonarr: Download (file import), less than a minute ago.')
})

test('an answer that could not be read, and a server that does not have the route, say so plainly', () => {
  const { unmount } = card({ activity: { status: 'error', data: null, receivedAt: 0 } })
  expect(screen.getByText('Could not read what ArrView received. Trying again.')).toBeInTheDocument()
  expect(screen.queryByRole('list', { name: 'Last event received' })).toBeNull()
  unmount()
  card({ activity: { status: 'old', data: null, receivedAt: 0 } })
  expect(screen.getByText('This version of ArrView does not report received events.')).toBeInTheDocument()
  expect(screen.queryByText(/Trying again/)).toBeNull()
})

test('what came from the server is shown as text and nothing else', () => {
  // The hook already refuses such a type; this is the second wall, in case the data ever arrives another way.
  const hostile = { status: 'ready', receivedAt: NOW, data: { uptimeSeconds: 5, radarr: none, sonarr: { event: seen('<img src=x onerror=alert(1)>', 1), test: null } } }
  const { container } = card({ activity: hostile })
  expect(container.querySelector('img')).toBeNull()
  expect(items()[0]).toContain('<img src=x onerror=alert(1)>')
})

test('the section sits after the URLs and before the guides', () => {
  const { container } = card({ activity: ready(answer()) })
  const order = [...container.querySelectorAll('#webhook-url-radarr, .webhook-activity-block, details')]
  expect(order[0]).toHaveAttribute('id', 'webhook-url-radarr')
  expect(order[1]).toHaveClass('webhook-activity-block')
  expect(order.slice(2).every(element => element.tagName === 'DETAILS')).toBe(true)
  expect(order.length).toBe(5)
})

test('the guides point at the section: the Test step, the missing-event check and the manual check', () => {
  card({ activity: ready(answer()) })
  const guide = name => screen.getByText(name).closest('details')
  expect(guide('Set up the webhook in Sonarr')).toHaveTextContent('"Test message received" appears under Last event received above within a few seconds')
  expect(guide('Set up the webhook in Radarr')).toHaveTextContent('ArrView changes no page for it, so this checks the address, not the triggers.')
  const help = guide('If it does not work')
  expect(help).toHaveTextContent('is listed under Last event received above and adds a line')
  expect(help).toHaveTextContent('If it stays at "No event" while things change in Sonarr or Radarr, the events never arrive.')
  expect(help).toHaveTextContent('the event is listed under Last event received, and the pages you have open refresh')
})

// --- the Settings page ---

const MASKED = '••••xxxx'
const saved = (extra = {}) => ({
  sonarr: { url: 'http://sonarr.example.invalid:8989', apikey: MASKED },
  radarr: { url: 'http://radarr.example.invalid:7878', apikey: MASKED },
  envManaged: { sonarr: false, radarr: false, sabnzbd: false, nzbhydra: false },
  ...extra,
})
const gone = () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) })
const down = () => ({ ok: false, status: 503, json: async () => ({}) })
// Serves the answers in turn, then repeats the last. A function is called to make that answer.
function sequence(...answers) {
  let index = 0
  return () => { const next = answers[Math.min(index++, answers.length - 1)]; return typeof next === 'function' ? next() : reply(next) }
}
const lastCalls = fn => fn.calls.filter(call => call.url.startsWith('/api/webhooks/last')).length
const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
const settings = () => render(<ConfigPage initialConfig={saved()} onSave={() => {}} onBack={() => {}} />)

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('Settings asks at once, shows the answer, and asks again every five seconds while it is in view', async () => {
  fakeTimers()
  const fn = stubFetch({ '/api/webhooks/last': sequence(answer(), answer({ uptimeSeconds: 605, sonarr: { event: seen('Download', 2), test: seen('Test', 4) } })) })
  settings()
  // The service rows say Checking… too, while their own pings are out.
  expect(within(screen.getByRole('heading', { level: 2, name: 'Webhooks' }).closest('section')).getByText('Checking…')).toBeInTheDocument()
  await advance(10)
  expect(lastCalls(fn)).toBe(1)
  expect(items()).toEqual(['Sonarr: No event since ArrView started 10 minutes ago.', 'Radarr: No event since ArrView started 10 minutes ago.'])
  await advance(4000)
  expect(lastCalls(fn)).toBe(1)
  await advance(1000)
  expect(lastCalls(fn)).toBe(2)
  expect(items()).toEqual([
    'Sonarr: Download (file import), less than a minute ago. Test message received less than a minute ago.',
    'Radarr: No event since ArrView started 10 minutes ago.',
  ])
  // It does not use a cached answer.
  expect(fn.calls.find(call => call.url.startsWith('/api/webhooks/last')).init).toMatchObject({ cache: 'no-store' })
})

test('a failed poll keeps the last answer on the page instead of an error, and the next good one replaces it', async () => {
  fakeTimers()
  const fn = stubFetch({ '/api/webhooks/last': sequence(answer(), down, () => { throw new Error('offline') }, { not: 'an answer' },
    answer({ radarr: { event: seen('MovieAdded', 1), test: null } })) })
  settings()
  await advance(10)
  const before = items()
  for (const poll of [2, 3, 4]) {
    await advance(5000)
    expect(lastCalls(fn)).toBe(poll)
    expect(items()).toEqual(before)
    expect(screen.queryByText(/Could not read/)).toBeNull()
  }
  await advance(5000)
  expect(items()[1]).toBe('Radarr: Movie added, less than a minute ago.')
})

test('with nothing to show yet, an unreadable answer is an error and the next poll recovers', async () => {
  fakeTimers()
  stubFetch({ '/api/webhooks/last': sequence({ version: '1' }, answer({ sonarr: { event: seen('Grab', 1), test: null } })) })
  settings()
  await advance(10)
  expect(screen.getByText('Could not read what ArrView received. Trying again.')).toBeInTheDocument()
  await advance(5000)
  expect(screen.queryByText(/Could not read/)).toBeNull()
  expect(items()[0]).toBe('Sonarr: Grab, less than a minute ago.')
})

test('a server without the route (404) says so, and Settings stops asking it', async () => {
  fakeTimers()
  const fn = stubFetch({ '/api/webhooks/last': gone })
  settings()
  await advance(10)
  expect(screen.getByText('This version of ArrView does not report received events.')).toBeInTheDocument()
  await advance(60_000)
  expect(lastCalls(fn)).toBe(1)
})

test('it is asked for only when Sonarr or Radarr is saved, and not while the page is out of view', async () => {
  fakeTimers()
  let fn = stubFetch({ '/api/webhooks/last': () => reply(answer()) })
  const first = render(<ConfigPage onSave={() => {}} />)
  await advance(20_000)
  expect(lastCalls(fn)).toBe(0)
  first.unmount()
  const onlyHydra = render(<ConfigPage initialConfig={{ nzbhydra: { url: 'http://hydra.example.invalid:5076', apikey: MASKED } }} onSave={() => {}} onBack={() => {}} />)
  await advance(20_000)
  expect(lastCalls(fn)).toBe(0)
  onlyHydra.unmount()

  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  fn = stubFetch({ '/api/webhooks/last': () => reply(answer()) })
  settings()
  await advance(20_000)
  expect(lastCalls(fn)).toBe(0)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1) })
  expect(lastCalls(fn)).toBe(1)
})

test('both layouts show it on their Settings page', async () => {
  const body = answer({ sonarr: { event: seen('Rename', 8), test: null } })
  const expected = ['Sonarr: Rename, less than a minute ago.', 'Radarr: No event since ArrView started 10 minutes ago.']
  stubFetch({ '/api/webhooks/last': () => reply(body) })
  window.location.hash = '#/settings'
  const modern = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  await waitFor(() => expect(items()).toEqual(expected))
  expect(modern.container.querySelector('.m-shell .webhook-activity')).not.toBeNull()
  modern.unmount()

  localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"settings"')
  const classic = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await waitFor(() => expect(items()).toEqual(expected))
  expect(classic.container.querySelector('.dashboard .webhook-activity')).not.toBeNull()
})
