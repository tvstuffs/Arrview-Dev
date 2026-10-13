import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ConfigPage from '../../src/components/ConfigPage'

const MASKED = '••••xxxx'
const reply = (data, ok = true, status = ok ? 200 : 400) => ({ ok, status, json: async () => data })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
