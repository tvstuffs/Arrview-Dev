import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import ConfigPage from '../../src/components/ConfigPage'

const MASKED = '••••xxxx'
const reply = (data, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

const baseConfig = (extra = {}) => ({
  sonarr: { url: 'http://sonarr.example.invalid:8989', apikey: MASKED },
  sabnzbd: { url: 'http://sab.example.invalid:8080', apikey: MASKED, sabPath: '/sabnzbd/api' },
  envManaged: { sonarr: false, radarr: false, sabnzbd: false, nzbhydra: false },
  ...extra,
})
const stubFetch = (handler) => {
  const fetch = vi.fn(async (url, options) => handler(url, options) ?? reply({}))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const posted = (fetch, url) => JSON.parse(fetch.mock.calls.find(([u, o]) => u === url && o?.method === 'POST')[1].body)

test('env-managed service is read-only, shows the Docker note and tests with the masked key', async () => {
  const fetch = stubFetch(url => url.startsWith('/api/test/') ? reply({ success: true, version: '4' }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig({ envManaged: { sonarr: true, radarr: false, sabnzbd: false, nzbhydra: false } })} onSave={() => {}} />)
  const url = screen.getByLabelText('Server URL', { selector: '#sonarr-url' })
  const key = screen.getByLabelText('API Key', { selector: '#sonarr-key' })
  expect(url).toHaveAttribute('readonly')
  expect(key).toHaveAttribute('readonly')
  expect(url).toHaveValue('http://sonarr.example.invalid:8989')
  expect(key).toHaveValue(MASKED)
  const note = document.getElementById(url.getAttribute('aria-describedby'))
  expect(note).toHaveTextContent('docker compose up -d')
  expect(note).toHaveTextContent('No image rebuild')
  expect(note).toHaveTextContent('ARRVIEW_SONARR_*')
  fireEvent.click(key.closest('.input-group').querySelector('button'))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/api/test/sonarr')).toBe(true))
  expect(posted(fetch, '/api/test/sonarr')).toEqual({ url: 'http://sonarr.example.invalid:8989', apikey: MASKED })
})

test('editing the URL of a UI-managed service clears a masked key and shows a hint', () => {
  stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  const url = screen.getByLabelText('Server URL', { selector: '#sonarr-url' })
  const key = screen.getByLabelText('API Key', { selector: '#sonarr-key' })
  expect(url).not.toHaveAttribute('readonly')
  fireEvent.change(url, { target: { value: 'http://new.example.invalid:8989' } })
  expect(key).toHaveValue('')
  expect(screen.getByText('Re-enter the API key for the new address.')).toBeInTheDocument()
})

test('server error text is shown for 409 and 400 save responses', async () => {
  for (const [status, message] of [[409, "Sonarr is set by the Docker configuration and can't be changed here"], [400, 'sonarr url must be valid']]) {
    stubFetch(url => url === '/api/config' ? reply({ error: message }, false, status) : reply({ version: '1' }))
    const { unmount } = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    unmount()
  }
  // Non-JSON error bodies fall back to the generic message.
  stubFetch(url => url === '/api/config' ? { ok: false, status: 502, json: async () => { throw new Error('not json') } } : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Save failed')).toBeInTheDocument()
})

test('Save preserves a stored sabPath and omits it for env-managed SABnzbd', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  const { unmount } = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => u === '/api/config' && o?.method === 'POST')).toBe(true))
  const body = posted(fetch, '/api/config')
  expect(body.sabnzbd.sabPath).toBe('/sabnzbd/api')
  expect(body.sonarr).toEqual({ url: 'http://sonarr.example.invalid:8989', apikey: MASKED })
  unmount()

  const fetch2 = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig({ envManaged: { sonarr: false, radarr: false, sabnzbd: true, nzbhydra: false } })} onSave={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(fetch2.mock.calls.some(([u, o]) => u === '/api/config' && o?.method === 'POST')).toBe(true))
  expect(posted(fetch2, '/api/config').sabnzbd).toEqual({ url: 'http://sab.example.invalid:8080', apikey: MASKED })
})

test('Save is blocked while an edited address has no key re-entered', async () => {
  const fetch = stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }), { target: { value: 'http://new.example.invalid:8989' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect((await screen.findAllByText('Re-enter the API key for the new address.')).length).toBeGreaterThan(0)
  expect(fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false)
})

test('emptying a URL still removes that service on Save', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => u === '/api/config' && o?.method === 'POST')).toBe(true))
  const body = posted(fetch, '/api/config')
  expect(body.sonarr).toBeUndefined()
  expect(body.sabnzbd).toBeDefined()
})

test('Save stays blocked after typing then erasing the key, and works once a real key is entered', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  const url = screen.getByLabelText('Server URL', { selector: '#sonarr-url' })
  const key = screen.getByLabelText('API Key', { selector: '#sonarr-key' })
  const save = screen.getByRole('button', { name: 'Save' })
  const configPosts = () => fetch.mock.calls.filter(([u, o]) => u === '/api/config' && o?.method === 'POST')
  fireEvent.change(url, { target: { value: 'http://new.example.invalid:8989' } })
  fireEvent.change(key, { target: { value: 'abc' } })
  fireEvent.change(key, { target: { value: '' } })
  fireEvent.click(save)
  expect((await screen.findAllByText('Re-enter the API key for the new address.')).length).toBeGreaterThan(0)
  expect(configPosts()).toHaveLength(0)
  fireEvent.change(key, { target: { value: 'realkey' } })
  fireEvent.click(save)
  await waitFor(() => expect(configPosts()).toHaveLength(1))
  expect(posted(fetch, '/api/config').sonarr).toEqual({ url: 'http://new.example.invalid:8989', apikey: 'realkey' })
})

const ALNUM_ERROR = 'API key must contain at least one letter or number.'
const configPosts = fetch => fetch.mock.calls.filter(([u, o]) => u === '/api/config' && o?.method === 'POST')
const radarrStored = () => baseConfig({ radarr: { url: 'http://radarr.example.invalid:7878', apikey: MASKED } })

test('19d: URL plus spaces-only or punctuation-only key blocks Save and removes nothing', async () => {
  const fetch = stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={radarrStored()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#nzbhydra-url' }), { target: { value: 'http://hydra.example.invalid:5076' } })
  const key = screen.getByLabelText('API Key', { selector: '#nzbhydra-key' })
  for (const value of ['     ', '----']) {
    fireEvent.change(key, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(ALNUM_ERROR)).toBeInTheDocument()
    expect(configPosts(fetch)).toHaveLength(0)
    expect(key).toHaveValue(value)
  }
})

test('19d: spaces-only replacement of a stored key is neither saved nor removal', async () => {
  const fetch = stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('API Key', { selector: '#sonarr-key' }), { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(ALNUM_ERROR)).toBeInTheDocument()
  expect(configPosts(fetch)).toHaveLength(0)
})

test('19d: a completely empty key still removes the service', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={radarrStored()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('API Key', { selector: '#radarr-key' }), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(configPosts(fetch)).toHaveLength(1))
  const body = posted(fetch, '/api/config')
  expect(body.radarr).toBeUndefined()
  expect(body.sonarr).toBeDefined()
  expect(screen.queryByText(ALNUM_ERROR)).toBeNull()
})

test('19d: the typed key is trimmed in the Save payload and in Test', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : url.startsWith('/api/test/') ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#nzbhydra-url' }), { target: { value: 'http://hydra.example.invalid:5076' } })
  fireEvent.change(screen.getByLabelText('API Key', { selector: '#nzbhydra-key' }), { target: { value: '  new-key-1  ' } })
  fireEvent.click(screen.getByLabelText('API Key', { selector: '#nzbhydra-key' }).closest('.input-group').querySelector('button'))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => u === '/api/test/nzbhydra')).toBe(true))
  expect(posted(fetch, '/api/test/nzbhydra').apikey).toBe('new-key-1')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(configPosts(fetch)).toHaveLength(1))
  expect(posted(fetch, '/api/config').nzbhydra).toEqual({ url: 'http://hydra.example.invalid:5076', apikey: 'new-key-1' })
})

test('19d: placeholders and env-managed services are exempt', async () => {
  const fetch = stubFetch(url => url === '/api/config' ? reply({ success: true }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig({ sonarr: { url: 'http://sonarr.example.invalid:8989', apikey: '••••' }, envManaged: { sonarr: false, radarr: false, sabnzbd: true, nzbhydra: false } })} onSave={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(configPosts(fetch)).toHaveLength(1))
  expect(posted(fetch, '/api/config').sonarr.apikey).toBe('••••')
  expect(screen.queryByText(ALNUM_ERROR)).toBeNull()
})

test('19d: a spaces-only key does not count as a configured service', async () => {
  const fetch = stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={{ envManaged: {} }} onSave={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }), { target: { value: 'http://sonarr.example.invalid:8989' } })
  fireEvent.change(screen.getByLabelText('API Key', { selector: '#sonarr-key' }), { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText(/letter or number|at least one service/)).toBeInTheDocument())
  expect(configPosts(fetch)).toHaveLength(0)
})

// ---- Services list ----
const row = name => screen.getByRole('button', { name, exact: true })
const statusOf = name => document.getElementById(`${name.toLowerCase()}-status`).textContent
const pings = fetch => fetch.mock.calls.map(([u]) => u).filter(u => u.endsWith('/ping'))

test('Services: a saved service starts closed with its ping status; one that is not set up starts open and says so', async () => {
  const fetch = stubFetch(url => url === '/api/sabnzbd/ping' ? reply({ error: 'Service unavailable' }, false, 503) : url.endsWith('/ping') ? reply({ status: 'ok' }) : reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  expect(row('Sonarr')).toHaveAttribute('aria-expanded', 'false')
  expect(document.getElementById('sonarr-panel')).not.toBeVisible()
  expect(statusOf('Sonarr')).toBe('Checking…')
  await waitFor(() => expect(statusOf('Sonarr')).toBe('Connected'))
  await waitFor(() => expect(statusOf('SABnzbd')).toBe('Can’t connect'))
  expect(row('Sonarr')).toHaveAccessibleDescription('TV show management Connected')
  for (const name of ['Radarr', 'NZBHydra']) {
    expect(row(name)).toHaveAttribute('aria-expanded', 'true')
    expect(statusOf(name)).toBe('Not set up')
  }
  expect(document.getElementById('radarr-panel')).toBeVisible()
  expect(pings(fetch).sort()).toEqual(['/api/sabnzbd/ping', '/api/sonarr/ping'])
  expect(screen.queryByRole('region', { name: 'Service checklist' })).toBeNull()
})

test('Services: a row opens and closes; its fields keep their values', () => {
  stubFetch(() => reply({ version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  fireEvent.click(row('Sonarr'))
  expect(row('Sonarr')).toHaveAttribute('aria-expanded', 'true')
  expect(document.getElementById('sonarr-panel')).toBeVisible()
  expect(screen.getByRole('group', { name: 'Sonarr connection' })).toContainElement(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }))
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }), { target: { value: 'http://other.example.invalid:8989' } })
  fireEvent.click(row('Sonarr'))
  expect(document.getElementById('sonarr-panel')).not.toBeVisible()
  fireEvent.click(row('Sonarr'))
  expect(screen.getByLabelText('Server URL', { selector: '#sonarr-url' })).toHaveValue('http://other.example.invalid:8989')
})

// Fake timers for the Test button's four-second result; `press` clicks and lets the stubbed request settle.
const fakeTimers = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
const advance = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const press = button => act(async () => { fireEvent.click(button); await vi.advanceTimersByTimeAsync(0) })
const sonarrPanel = () => screen.getByRole('group', { name: 'Sonarr connection' })
const sonarrTest = () => sonarrPanel().querySelector('.service-test')
const sonarrLive = () => within(sonarrPanel()).getByRole('status').textContent
const testPosts = fetch => fetch.mock.calls.filter(([url, options]) => url === '/api/test/sonarr' && options?.method === 'POST').length

test('Services: a Test result replaces the ping status in the row', async () => {
  fakeTimers()
  let ok = true
  stubFetch(url => url === '/api/test/sonarr' ? reply(ok ? { success: true, version: '4.0.20' } : { error: 'HTTP 401: Unauthorized' }, ok) : reply({ status: 'ok', version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await advance(0)
  fireEvent.click(row('Sonarr'))
  await press(sonarrTest())
  expect(statusOf('Sonarr')).toBe('Connected · v4.0.20')
  await advance(4000)
  ok = false
  await press(sonarrTest())
  expect(statusOf('Sonarr')).toBe('Test failed')
  expect(screen.getByText('HTTP 401: Unauthorized')).toBeInTheDocument()
})

test('Services: the Test button shows a check or an X for four seconds, then says Test again', async () => {
  fakeTimers()
  let ok = true
  const fetch = stubFetch(url => url === '/api/test/sonarr' ? reply(ok ? { success: true, version: '4.0.20' } : { error: 'HTTP 401: Unauthorized' }, ok) : reply({ status: 'ok', version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await advance(0)
  fireEvent.click(row('Sonarr'))
  expect(sonarrTest()).toHaveAccessibleName('Test')
  expect(sonarrTest()).not.toHaveAttribute('aria-disabled')
  expect(sonarrTest().querySelector('svg')).toBeNull()

  await press(sonarrTest())
  expect(sonarrTest()).toHaveAccessibleName('Test passed')
  expect(sonarrTest()).toHaveAttribute('aria-disabled', 'true')
  expect(sonarrTest()).toHaveClass('is-ok')
  expect(sonarrTest().querySelector('svg.icon path')).toHaveAttribute('d', expect.stringMatching(/^M229\.66,77\.66/))
  expect(sonarrLive()).toBe('Sonarr test passed')
  expect(statusOf('Sonarr')).toBe('Connected · v4.0.20')
  await press(sonarrTest())
  expect(testPosts(fetch)).toBe(1)
  await advance(3900)
  expect(sonarrTest()).toHaveAccessibleName('Test passed')
  await advance(100)
  expect(sonarrTest()).toHaveAccessibleName('Test')
  expect(sonarrTest()).not.toHaveAttribute('aria-disabled')
  expect(sonarrTest()).not.toHaveClass('is-ok')
  expect(sonarrTest().querySelector('svg')).toBeNull()
  expect(sonarrLive()).toBe('')
  expect(statusOf('Sonarr')).toBe('Connected · v4.0.20')

  ok = false
  await press(sonarrTest())
  expect(testPosts(fetch)).toBe(2)
  expect(sonarrTest()).toHaveAccessibleName('Test failed')
  expect(sonarrTest()).toHaveClass('is-bad')
  expect(sonarrTest().querySelector('svg.icon path')).toHaveAttribute('d', expect.stringMatching(/^M205\.66,194\.34/))
  expect(sonarrLive()).toBe('Sonarr test failed. HTTP 401: Unauthorized')
  expect(statusOf('Sonarr')).toBe('Test failed')
  expect(screen.getByText('HTTP 401: Unauthorized')).toBeInTheDocument()
  await advance(4000)
  expect(sonarrTest()).toHaveAccessibleName('Test')
  expect(sonarrTest()).not.toHaveAttribute('aria-disabled')
  expect(sonarrTest().querySelector('svg')).toBeNull()
})

test('Services: a spinner shows while a Test runs, and an edit ends a shown result at once or drops a Test still running', async () => {
  fakeTimers()
  let answer
  const fetch = stubFetch(url => url === '/api/test/sonarr' ? new Promise(resolve => { answer = resolve }) : reply({ status: 'ok', version: '1' }))
  render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await advance(0)
  fireEvent.click(row('Sonarr'))
  const key = () => screen.getByLabelText('API Key', { selector: '#sonarr-key' })

  await press(sonarrTest())
  expect(sonarrTest()).toHaveAccessibleName('Testing')
  expect(sonarrTest()).toHaveAttribute('aria-disabled', 'true')
  expect(sonarrTest().querySelector('.spinner')).not.toBeNull()
  await press(sonarrTest())
  expect(testPosts(fetch)).toBe(1)
  // The key is edited while the Test runs: its answer is about the old key, so nothing is shown for it.
  fireEvent.change(key(), { target: { value: 'typed-key-1' } })
  await act(async () => { answer(reply({ success: true, version: '4.0.20' })); await vi.advanceTimersByTimeAsync(0) })
  expect(sonarrTest()).toHaveAccessibleName('Test')
  expect(sonarrTest()).not.toHaveAttribute('aria-disabled')
  expect(sonarrLive()).toBe('')
  expect(statusOf('Sonarr')).toBe('Connected')

  // A result is showing; editing the key makes the button ready at once.
  await press(sonarrTest())
  await act(async () => { answer(reply({ error: 'HTTP 401: Unauthorized' }, false, 401)); await vi.advanceTimersByTimeAsync(0) })
  expect(sonarrTest()).toHaveAccessibleName('Test failed')
  fireEvent.change(key(), { target: { value: 'typed-key-2' } })
  expect(sonarrTest()).toHaveAccessibleName('Test')
  expect(sonarrTest()).not.toHaveAttribute('aria-disabled')
  expect(sonarrLive()).toBe('')
  await press(sonarrTest())
  expect(testPosts(fetch)).toBe(3)
})

test('Services: leaving the page while a result shows, or while a Test runs, leaves no timer behind', async () => {
  fakeTimers()
  let answer
  stubFetch(url => url === '/api/test/sonarr' ? new Promise(resolve => { answer = resolve }) : reply({ status: 'ok', version: '1' }))
  const first = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await advance(0)
  fireEvent.click(row('Sonarr'))
  await press(sonarrTest())
  await act(async () => { answer(reply({ success: true })); await vi.advanceTimersByTimeAsync(0) })
  expect(sonarrTest()).toHaveAccessibleName('Test passed')
  first.unmount()
  expect(vi.getTimerCount()).toBe(0)

  const second = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await advance(0)
  fireEvent.click(row('Sonarr'))
  await press(sonarrTest())
  second.unmount()
  await act(async () => { answer(reply({ success: true })); await vi.advanceTimersByTimeAsync(0) })
  expect(vi.getTimerCount()).toBe(0)
})

test('Services: pings start once and do not restart when the parent passes a new, equal config on every render', async () => {
  const fetch = stubFetch(url => url.endsWith('/ping') ? reply({ status: 'ok' }) : reply({ version: '1' }))
  const { rerender } = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await waitFor(() => expect(statusOf('Sonarr')).toBe('Connected'))
  for (let i = 0; i < 5; i++) rerender(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} />)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(pings(fetch).filter(u => u === '/api/sonarr/ping')).toHaveLength(1)
})

test('Services: a first run with nothing saved opens every row and pings nothing', async () => {
  const fetch = stubFetch(() => reply({ version: '1' }))
  const { rerender } = render(<ConfigPage onSave={() => {}} />)
  rerender(<ConfigPage onSave={() => {}} />)
  await new Promise(resolve => setTimeout(resolve, 20))
  for (const name of ['SABnzbd', 'NZBHydra', 'Sonarr', 'Radarr']) {
    expect(row(name)).toHaveAttribute('aria-expanded', 'true')
    expect(statusOf(name)).toBe('Not set up')
  }
  expect(pings(fetch)).toEqual([])
})

test('the Services list sits between Layout and the Webhooks card', () => {
  stubFetch(() => reply({ version: '1' }))
  const { container } = render(<ConfigPage initialConfig={baseConfig()} onSave={() => {}} layout="modern" onLayoutChange={() => {}} />)
  const order = [...container.querySelectorAll('.layout-choice, .service-list, .webhook-card')].map(el => el.className.split(' ').find(name => name !== 'card'))
  expect(order).toEqual(['layout-choice', 'service-list', 'webhook-card'])
})
