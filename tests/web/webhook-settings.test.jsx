import React, { useState } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import WebhookSettings from '../../src/components/WebhookSettings'
import ConfigPage from '../../src/components/ConfigPage'
import Dashboard from '../../src/components/Dashboard'
import { normalizeAddress } from '../../src/webhooks'
import { copyText } from '../../src/clipboard'
import { reply, config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// The card in Settings that shows the two URLs Sonarr and Radarr post their events to, built from ArrView's
// own address as they reach it (config.webhooks.baseUrl, empty = this page's address), with the setup steps.
const remote = { hostname: 'nas.example.invalid', origin: 'http://nas.example.invalid:7777' }
const local = { hostname: 'localhost', origin: 'http://localhost:7777' }

function Harness({ initial = '', ...props }) {
  const [address, setAddress] = useState(initial)
  return <WebhookSettings address={address} onAddressChange={setAddress} sonarr radarr location={remote} {...props} />
}
const urlOf = name => screen.getByLabelText(`${name} webhook URL`)
const typeAddress = value => fireEvent.change(screen.getByLabelText('ArrView address for Sonarr and Radarr'), { target: { value } })

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

// The same table is in tests/webhook-address.test.js for the server's copy of the rules.
const NORMALISED = [
  ['192.0.2.10:7777', 'http://192.0.2.10:7777'],
  ['  HTTP://nas.example.invalid:7777/  ', 'http://nas.example.invalid:7777'],
  ['https://arrview.example.invalid', 'https://arrview.example.invalid'],
  ['http://[::1]:7777', 'http://[::1]:7777'],
  ['my_arrview:7777', 'http://my_arrview:7777'],
  ['http://nas.example.invalid/arrview/', 'http://nas.example.invalid/arrview'],
  ['http://nas.example.invalid:7777/api/webhooks/sonarr', 'http://nas.example.invalid:7777'],
  ['http://nas.example.invalid:7777/api/webhooks/Radarr/', 'http://nas.example.invalid:7777'],
  ['http://nas.example.invalid:7777/api/webhooks', 'http://nas.example.invalid:7777'],
  ['nas.example.invalid/api/webhooks/sonarr', 'http://nas.example.invalid'],
]
const NOT_ADDRESSES = ['ftp://nas.example.invalid', 'http://user:pass@nas.example.invalid', 'http://nas.example.invalid/?token=x',
  'http://nas.example.invalid/#x', 'http://', 'http:///api/webhooks', 'http://bad host', 'http://bad%20host',
  'http://nas.example.invalid/ar rview', 'http://-bad.example.invalid', 'http://nas.example.invalid.',
  'http://nas.example.invalid/a;b', 'http://nas.example.invalid/$(id)', 'http://nas.example.invalid/a|b', 'http://nas.example.invalid/`id`',
  "http://nas.example.invalid/a'b", 'http://nas.example.invalid/a"b', 'http://nas.example.invalid/a&b', 'http://nas.example.invalid/a\\b',
  'http://nas.example.invalid/{x}', 'http://exämple.invalid', 'http://nas.example.invalid:99999',
  '', '   ', null, undefined]

test('normalizeAddress follows the server rules', () => {
  for (const [typed, expected] of NORMALISED) expect(normalizeAddress(typed), typed).toBe(expected)
  for (const typed of NOT_ADDRESSES) expect(normalizeAddress(typed), String(typed)).toBeNull()
})

test('with no address set, the URLs are built from this page and the field says so', () => {
  render(<Harness />)
  expect(urlOf('Sonarr')).toHaveValue('http://nas.example.invalid:7777/api/webhooks/sonarr')
  expect(urlOf('Radarr')).toHaveValue('http://nas.example.invalid:7777/api/webhooks/radarr')
  expect(urlOf('Sonarr')).toHaveAttribute('readonly')
  const field = screen.getByLabelText('ArrView address for Sonarr and Radarr')
  expect(field).toHaveValue('')
  expect(field).toHaveAttribute('placeholder', 'http://nas.example.invalid:7777')
  expect(document.getElementById(field.getAttribute('aria-describedby'))).toHaveTextContent('Leave it empty to use this page')
  expect(screen.getByRole('heading', { level: 2, name: 'Webhooks' })).toBeInTheDocument()
})

test('a typed address changes both URLs as it is typed, and a pasted webhook URL is cut back to the address', () => {
  render(<Harness />)
  typeAddress('192.0.2.10:7777')
  expect(urlOf('Sonarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/sonarr')
  expect(urlOf('Radarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/radarr')
  typeAddress('http://192.0.2.10:7777/api/webhooks/sonarr')
  expect(urlOf('Sonarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/sonarr')
  expect(urlOf('Radarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/radarr')
  typeAddress('')
  expect(urlOf('Sonarr')).toHaveValue('http://nas.example.invalid:7777/api/webhooks/sonarr')
})

test('text that is not an address keeps the page address and says what to write', () => {
  render(<Harness />)
  const field = screen.getByLabelText('ArrView address for Sonarr and Radarr')
  expect(field).not.toHaveAttribute('aria-invalid')
  typeAddress('http://bad host')
  expect(screen.getByText(/That is not an address yet/)).toBeInTheDocument()
  expect(urlOf('Sonarr')).toHaveValue('http://nas.example.invalid:7777/api/webhooks/sonarr')
  // The hint is part of the field's description, and the field is marked invalid.
  expect(field).toHaveAttribute('aria-invalid', 'true')
  expect(field).toHaveAccessibleDescription(/That is not an address yet/)
  typeAddress('192.0.2.10:7777')
  expect(screen.queryByText(/That is not an address yet/)).toBeNull()
  expect(field).not.toHaveAttribute('aria-invalid')
  expect(field).not.toHaveAccessibleDescription(/That is not an address yet/)
})

test('a page opened on the server itself warns that localhost is no use to Sonarr or Radarr elsewhere', () => {
  const { unmount } = render(<Harness location={local} />)
  expect(screen.getByText(/This page is open as localhost/)).toBeInTheDocument()
  expect(screen.getByLabelText('ArrView address for Sonarr and Radarr')).toHaveAccessibleDescription(/This page is open as localhost/)
  expect(urlOf('Sonarr')).toHaveValue('http://localhost:7777/api/webhooks/sonarr')
  typeAddress('192.0.2.10:7777')
  expect(screen.queryByText(/This page is open as localhost/)).toBeNull()
  unmount()
  render(<Harness location={remote} />)
  expect(screen.queryByText(/This page is open as/)).toBeNull()
})

test('only the services that are set up get a URL and a setup guide, and the card is absent when neither is', () => {
  const { container, unmount } = render(<Harness radarr={false} />)
  expect(screen.queryByLabelText('Radarr webhook URL')).toBeNull()
  expect(screen.getByText('Set up the webhook in Sonarr')).toBeInTheDocument()
  expect(screen.queryByText('Set up the webhook in Radarr')).toBeNull()
  expect(container.textContent).toContain('Test fails in Sonarr.')
  unmount()
  const second = render(<Harness sonarr={false} />)
  expect(screen.queryByLabelText('Sonarr webhook URL')).toBeNull()
  expect(urlOf('Radarr')).toBeInTheDocument()
  expect(second.container.textContent).toContain('Test fails in Radarr.')
  second.unmount()
  const none = render(<Harness sonarr={false} radarr={false} />)
  expect(none.container).toBeEmptyDOMElement()
})

test('each setup guide gives the exact URL, the triggers that matter and POST', () => {
  render(<Harness initial="192.0.2.10:7777" />)
  const guide = name => screen.getByText(`Set up the webhook in ${name}`).closest('details')
  const sonarr = guide('Sonarr')
  expect(sonarr).toHaveTextContent('open Settings, then Connect')
  expect(sonarr).toHaveTextContent('choose Webhook')
  for (const trigger of ['On File Import', 'On File Upgrade', 'On Rename', 'On Series Add', 'On Series Delete', 'On Episode File Delete']) expect(sonarr).toHaveTextContent(trigger)
  expect(sonarr).not.toHaveTextContent('Movie')
  expect(within(sonarr).getByText('http://192.0.2.10:7777/api/webhooks/sonarr').tagName).toBe('CODE')
  expect(sonarr).toHaveTextContent('Method to POST')
  expect(sonarr).toHaveTextContent('Older versions call the first two On Download and On Upgrade')
  const radarr = guide('Radarr')
  for (const trigger of ['On File Import', 'On File Upgrade', 'On Rename', 'On Movie Added', 'On Movie Delete', 'On Movie File Delete']) expect(radarr).toHaveTextContent(trigger)
  expect(radarr).not.toHaveTextContent('Series')
  expect(within(radarr).getByText('http://192.0.2.10:7777/api/webhooks/radarr').tagName).toBe('CODE')
})

test('the troubleshooting section carries a command that posts to the first URL and the facts about who can call it', () => {
  render(<Harness initial="192.0.2.10:7777" />)
  const help = screen.getByText('If it does not work').closest('details')
  const command = help.querySelector('pre')
  expect(command).toHaveTextContent(`curl -X POST -H "Content-Type: application/json" -d '{"eventType":"Download","series":{"title":"ArrView test"}}' "http://192.0.2.10:7777/api/webhooks/sonarr"`)
  expect(help).toHaveTextContent('Test fails in Sonarr or Radarr.')
  expect(help).toHaveTextContent('ArrView does not check who calls a webhook')
  expect(help).toHaveTextContent('Connect Directly mode refreshes on a timer')
  expect(help).toHaveTextContent('[Sonarr webhook] Download')
})

test('with only Radarr set up the example command is a Radarr one', () => {
  render(<Harness sonarr={false} initial="192.0.2.10:7777" />)
  const command = screen.getByText('If it does not work').closest('details').querySelector('pre')
  expect(command).toHaveTextContent(`-d '{"eventType":"Download","movie":{"title":"ArrView test"}}' "http://192.0.2.10:7777/api/webhooks/radarr"`)
})

test('every control in the card has a name, and the Copy buttons say which URL they copy', () => {
  render(<Harness />)
  for (const el of screen.getByRole('heading', { name: 'Webhooks' }).closest('section').querySelectorAll('input, button, summary')) {
    expect(el, el.outerHTML.slice(0, 90)).toHaveAccessibleName()
  }
  expect(screen.getByRole('button', { name: 'Copy Sonarr webhook URL' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy Radarr webhook URL' })).toBeInTheDocument()
})

const stubSecure = (secure, writeText) => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined })
}
afterEach(() => { delete document.execCommand; delete window.isSecureContext; delete navigator.clipboard })

test('Copy uses the Clipboard API on a secure page and says so', async () => {
  const writeText = vi.fn(async () => {})
  stubSecure(true, writeText)
  document.execCommand = vi.fn(() => true)
  render(<Harness initial="192.0.2.10:7777" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Radarr webhook URL' }))
  expect(await screen.findByText('Radarr webhook URL copied.')).toBeInTheDocument()
  expect(writeText).toHaveBeenCalledWith('http://192.0.2.10:7777/api/webhooks/radarr')
  expect(document.execCommand).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Radarr webhook URL copied.')
})

test('on a plain http page Copy selects the field and uses the copy command', async () => {
  stubSecure(false, null)
  document.execCommand = vi.fn(() => true)
  render(<Harness initial="192.0.2.10:7777" />)
  const field = urlOf('Sonarr')
  fireEvent.click(screen.getByRole('button', { name: 'Copy Sonarr webhook URL' }))
  expect(await screen.findByText('Sonarr webhook URL copied.')).toBeInTheDocument()
  expect(document.execCommand).toHaveBeenCalledWith('copy')
  expect(document.activeElement).toBe(field)
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
})

test('Copy falls back to the field when the Clipboard API refuses, and reports a copy that did not happen', async () => {
  stubSecure(true, vi.fn(async () => { throw new Error('denied') }))
  document.execCommand = vi.fn(() => false)
  render(<Harness initial="192.0.2.10:7777" />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy Sonarr webhook URL' }))
  expect(await screen.findByText(/Could not copy the Sonarr webhook URL automatically\. It is selected/)).toBeInTheDocument()
  expect(document.execCommand).toHaveBeenCalledWith('copy')
  expect(document.activeElement).toBe(urlOf('Sonarr'))
})

test('the copy message clears itself, and a page that cannot copy at all still selects the field', async () => {
  vi.useFakeTimers()
  stubSecure(false, null)
  render(<Harness initial="192.0.2.10:7777" />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Sonarr webhook URL' })) })
  expect(screen.getByRole('status')).toHaveTextContent('Could not copy the Sonarr webhook URL automatically')
  expect(document.activeElement).toBe(urlOf('Sonarr'))
  await act(async () => { vi.advanceTimersByTime(4000) })
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
})

test('copyText works without a field and never throws', async () => {
  stubSecure(false, null)
  expect(await copyText('x')).toBe(false)
  document.execCommand = vi.fn(() => { throw new Error('blocked') })
  const field = document.createElement('input'); field.value = 'abc'; document.body.append(field)
  expect(await copyText('abc', field)).toBe(false)
  field.remove()
})

// --- the Settings page ---

const MASKED = '••••xxxx'
const base = (extra = {}) => ({
  sonarr: { url: 'http://sonarr.example.invalid:8989', apikey: MASKED },
  sabnzbd: { url: 'http://sab.example.invalid:8080', apikey: MASKED },
  envManaged: { sonarr: false, radarr: false, sabnzbd: false, nzbhydra: false },
  ...extra,
})
const posts = fetch => fetch.mock.calls.filter(([url, options]) => url === '/api/config' && options?.method === 'POST')
const body = fetch => JSON.parse(posts(fetch)[0][1].body)
const settingsFetch = () => stubFetch({ '/api/config': (url, init) => init?.method === 'POST' ? reply({ success: true }) : reply({}) })
const press = name => fireEvent.click(screen.getByRole('button', { name }))

test('Settings shows the card for a saved Sonarr or Radarr, between the services and Add to Home Screen, and not on first run', () => {
  settingsFetch()
  const { container, unmount } = render(<ConfigPage initialConfig={base()} onSave={() => {}} onBack={() => {}} />)
  const card = screen.getByRole('heading', { level: 2, name: 'Webhooks' }).closest('section')
  expect(urlOf('Sonarr')).toBeInTheDocument()
  expect(screen.queryByLabelText('Radarr webhook URL')).toBeNull()
  const order = [...container.querySelectorAll('.service-list, .webhook-card, .install-help')]
  expect(order.map(el => el.className.split(' ')[0])).toEqual(['service-list', 'webhook-card', 'install-help'])
  expect(card.contains(screen.getByLabelText('ArrView address for Sonarr and Radarr'))).toBe(true)
  unmount()
  render(<ConfigPage onSave={() => {}} />)
  expect(screen.queryByRole('heading', { name: 'Webhooks' })).toBeNull()
})

test('Settings shows a service only after it is saved, not while it is being typed', () => {
  settingsFetch()
  render(<ConfigPage initialConfig={base()} onSave={() => {}} onBack={() => {}} />)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#radarr-url' }), { target: { value: 'http://radarr.example.invalid:7878' } })
  fireEvent.change(screen.getByLabelText('API Key', { selector: '#radarr-key' }), { target: { value: 'typed-key-1' } })
  expect(screen.queryByLabelText('Radarr webhook URL')).toBeNull()
})

test('the saved address is shown in the field and used for the URLs', () => {
  settingsFetch()
  render(<ConfigPage initialConfig={base({ radarr: { url: 'http://radarr.example.invalid:7878', apikey: MASKED }, webhooks: { baseUrl: 'http://192.0.2.10:7777' } })}
    onSave={() => {}} onBack={() => {}} />)
  expect(screen.getByLabelText('ArrView address for Sonarr and Radarr')).toHaveValue('http://192.0.2.10:7777')
  expect(urlOf('Sonarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/sonarr')
  expect(urlOf('Radarr')).toHaveValue('http://192.0.2.10:7777/api/webhooks/radarr')
})

test('Save sends the address only when it changed, normalised', async () => {
  const fetch = settingsFetch()
  render(<ConfigPage initialConfig={base()} onSave={() => {}} onBack={() => {}} />)
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
  expect('webhooks' in body(fetch)).toBe(false)

  fetch.mockClear()
  typeAddress(' 192.0.2.10:7777/ ')
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
  expect(body(fetch).webhooks).toEqual({ baseUrl: 'http://192.0.2.10:7777' })
  expect(body(fetch).sonarr).toEqual({ url: 'http://sonarr.example.invalid:8989', apikey: MASKED })
})

test('Save leaves a stored address out when it was not touched, and sends an empty one to clear it', async () => {
  const fetch = settingsFetch()
  const stored = base({ webhooks: { baseUrl: 'http://192.0.2.10:7777' } })
  const { unmount } = render(<ConfigPage initialConfig={stored} onSave={() => {}} onBack={() => {}} />)
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
  expect('webhooks' in body(fetch)).toBe(false)
  unmount()

  fetch.mockClear()
  render(<ConfigPage initialConfig={stored} onSave={() => {}} onBack={() => {}} />)
  typeAddress('')
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
  expect(body(fetch).webhooks).toEqual({ baseUrl: '' })
})

test('an address that is not one blocks Save with a message and posts nothing', async () => {
  const fetch = settingsFetch()
  render(<ConfigPage initialConfig={base()} onSave={() => {}} onBack={() => {}} />)
  typeAddress('http://bad host')
  press('Save')
  expect(await screen.findByText(/The ArrView address for webhooks must look like http:\/\/host:7777/)).toBeInTheDocument()
  expect(posts(fetch)).toHaveLength(0)
  typeAddress('192.0.2.10:7777')
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
})

test('a refused address from the server is shown like any other save error', async () => {
  stubFetch({ '/api/config': (url, init) => init?.method === 'POST' ? reply({ error: 'webhooks baseUrl must be an http(s) address without credentials, query or fragment' }, false) : reply({}) })
  render(<ConfigPage initialConfig={base()} onSave={() => {}} onBack={() => {}} />)
  typeAddress('192.0.2.10:7777')
  press('Save')
  expect(await screen.findByText(/webhooks baseUrl must be an http\(s\) address/)).toBeInTheDocument()
})

test('Docker-managed services still get the card, and saving the address does not touch them', async () => {
  const fetch = settingsFetch()
  render(<ConfigPage initialConfig={base({ envManaged: { sonarr: true, radarr: false, sabnzbd: false, nzbhydra: false } })} onSave={() => {}} onBack={() => {}} />)
  expect(urlOf('Sonarr')).toBeInTheDocument()
  typeAddress('192.0.2.10:7777')
  press('Save')
  await waitFor(() => expect(posts(fetch)).toHaveLength(1))
  expect(body(fetch).webhooks).toEqual({ baseUrl: 'http://192.0.2.10:7777' })
})

test('both layouts show the card on their Settings page', async () => {
  stubFetch({ '/api/arrview/identify': () => reply({ version: '1.9A4', capabilities: [] }) })
  window.location.hash = '#/settings'
  const modern = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  expect(modern.container.querySelector('.m-shell .webhook-card')).not.toBeNull()
  expect(urlOf('Sonarr')).toBeInTheDocument()
  modern.unmount()

  localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"settings"')
  const classic = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 2, name: 'Webhooks' })
  expect(classic.container.querySelector('.dashboard .webhook-card')).not.toBeNull()
})

// --- Set up in / Remove from Sonarr and Radarr (GET, POST and DELETE /api/webhook-setup/:service) ---

const SAVED = 'http://arrview.example:7777'
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this } })
const notJson = status => ({ ok: false, status, json: async () => { throw new SyntaxError('not JSON') }, clone() { return this } })
const stateOf = (service, state, extra = {}) => answer(200, { service, state, url: `${SAVED}/api/webhooks/${service}`, ...extra })
// A fetch for the setup routes: `handlers[method]` answers each call, a function of the service.
function setupFetch(handlers) {
  const fn = vi.fn(async (url, init = {}) => {
    const match = /^\/api\/webhook-setup\/(sonarr|radarr)$/.exec(String(url))
    if (!match) return answer(200, {})
    return handlers[init.method || 'GET'](match[1], init)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const setupCalls = (fetch, method) => fetch.mock.calls.filter(([url, init = {}]) => String(url).startsWith('/api/webhook-setup/') && (init.method || 'GET') === method)
const block = name => screen.getByRole('group', { name: `Status in ${name}` })
const live = name => block(name).querySelector('[aria-live="polite"]')
const lines = name => [...live(name).querySelectorAll('p')].map(p => p.textContent)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function SetupHarness(props) {
  return <Harness initial={SAVED} savedAddress={SAVED} radarr={false} {...props} />
}

const STATUS_TEXTS = [
  ['present', {}, 'Set up.'],
  ['absent', {}, 'Not set up.'],
  ['different-address', { address: 'http://old.example:7777/api/webhooks/sonarr' }, 'Set up, but at a different address: http://old.example:7777/api/webhooks/sonarr. Fix it in Sonarr under Settings, Connect, or remove it here and set up again.'],
  ['different-address', { address: 'http://old.example:7777/api/webhooks/sonarr', extra: true }, 'Set up, but at a different address: http://old.example:7777/api/webhooks/sonarr. Its URL also carries login details or a query. Fix it in Sonarr under Settings, Connect, or remove it here and set up again.'],
  ['needs-address', {}, 'Save the ArrView address above first.'],
  ['not-configured', {}, 'Cannot check: Sonarr is not set up in ArrView.'],
  ['unreachable', {}, 'Cannot check: Sonarr could not be reached.'],
  ['key-rejected', {}, 'Cannot check: Sonarr rejected the API key.'],
  ['name-taken', {}, 'Cannot set up: a connection named ArrView already exists in Sonarr. Rename or remove it there.'],
  ['multiple', {}, 'Several ArrView webhooks exist in Sonarr. Remove the extra ones there.'],
]

test('each setup state has its own status text in a polite live region, with Set up only for absent and Remove only when there is one', async () => {
  for (const [state, extra, text] of STATUS_TEXTS) {
    setupFetch({ GET: service => stateOf(service, state, extra) })
    const { unmount } = render(<SetupHarness />)
    expect(live('Sonarr')).toHaveTextContent('Checking Sonarr…')
    await waitFor(() => expect(live('Sonarr')).toHaveTextContent(text))
    expect(live('Sonarr').textContent).toBe(text)
    expect(within(block('Sonarr')).queryByRole('button', { name: 'Set up in Sonarr' }) !== null, state).toBe(state === 'absent')
    expect(within(block('Sonarr')).queryByRole('button', { name: 'Remove from Sonarr' }) !== null, state).toBe(state === 'present' || state === 'different-address')
    unmount()
  }
  // Radarr reads Radarr.
  setupFetch({ GET: service => stateOf(service, 'unreachable') })
  render(<SetupHarness sonarr={false} radarr />)
  await waitFor(() => expect(live('Radarr')).toHaveTextContent('Cannot check: Radarr could not be reached.'))
})

test('an answer that is not a setup state, a 404 from an older server or a failed fetch says the status cannot be checked, with no buttons', async () => {
  const answers = [() => answer(404, { error: 'Not found' }), () => answer(200, {}), () => answer(200, { state: 'weird' }), () => notJson(200),
    () => { throw new TypeError('Failed to fetch') }, () => answer(500, { state: 'present' })]
  for (const reply of answers) {
    setupFetch({ GET: reply })
    const { unmount } = render(<SetupHarness />)
    await waitFor(() => expect(live('Sonarr')).toHaveTextContent('Cannot check the webhook status.'))
    expect(within(block('Sonarr')).queryAllByRole('button')).toHaveLength(0)
    unmount()
  }
})

test('Set up is disabled while the address field differs from the saved address, and says why', async () => {
  setupFetch({ GET: service => stateOf(service, 'absent') })
  render(<SetupHarness />)
  const button = await screen.findByRole('button', { name: 'Set up in Sonarr' })
  expect(button).toBeEnabled()
  expect(button).not.toHaveAccessibleDescription(/Save the address first/)
  typeAddress('192.0.2.10:7777')
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription('Save the address first: Set up uses the saved address.')
  typeAddress(SAVED)
  expect(button).toBeEnabled()
})

test('Set up opens a preview of exactly what is added, and Cancel closes it without writing anything', async () => {
  const fetch = setupFetch({ GET: service => stateOf(service, 'absent') })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up in Sonarr' }))
  const preview = screen.getByRole('region', { name: 'Webhook to add in Sonarr' })
  expect(block('Sonarr').contains(preview)).toBe(true)
  expect(preview).toHaveTextContent('Name: ArrView')
  expect(within(preview).getByText(`${SAVED}/api/webhooks/sonarr`).tagName).toBe('CODE')
  expect(preview).toHaveTextContent('Method: POST')
  for (const label of ['On File Import', 'On File Upgrade', 'On Rename', 'On Series Add', 'On Series Delete', 'On Episode File Delete']) expect(preview).toHaveTextContent(label)
  expect(preview).toHaveTextContent('Sonarr sends ArrView a test message before saving. If Sonarr cannot reach the address, nothing is saved.')
  fireEvent.click(within(preview).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('region', { name: 'Webhook to add in Sonarr' })).toBeNull()
  expect(setupCalls(fetch, 'POST')).toHaveLength(0)
})

test('Add sends an empty JSON body through apiFetch, then re-reads the status and says that ArrView received the test message', async () => {
  let state = 'absent'
  const fetch = setupFetch({
    GET: service => stateOf(service, state),
    POST: () => { state = 'present'; return answer(201, { state: 'present', created: true, skipped: [], testReceived: true }) },
  })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up in Sonarr' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(lines('Sonarr')).toEqual(['Set up.', "ArrView received Sonarr's test message."]))
  const [[url, init]] = setupCalls(fetch, 'POST')
  expect(url).toBe('/api/webhook-setup/sonarr')
  expect(init.body).toBe('{}')
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
  expect(new Headers(init.headers).get('X-Requested-With')).toBe('ArrView')
  expect(setupCalls(fetch, 'GET')).toHaveLength(2)
  expect(screen.queryByRole('region', { name: 'Webhook to add in Sonarr' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Remove from Sonarr' })).toBeEnabled()
})

test('a set-up whose test message never reached ArrView says so, and names the triggers this version does not offer', async () => {
  let state = 'absent'
  setupFetch({
    GET: service => stateOf(service, state),
    POST: () => { state = 'present'; return answer(201, { state: 'present', created: true, skipped: ['On Rename', 'On Series Delete'], testReceived: false }) },
  })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up in Sonarr' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(live('Sonarr')).toHaveTextContent(/^Set up\./))
  expect(live('Sonarr')).toHaveTextContent('Sonarr saved the webhook, but ArrView did not receive its test message. Sonarr counts any answer below 400 as a pass, so a login page or a redirect at that address can pass its test. Check that the address reaches this ArrView, then check "Last event received" below.')
  expect(live('Sonarr')).toHaveTextContent('This version of Sonarr does not offer: On Rename, On Series Delete.')
  expect(live('Sonarr')).not.toHaveTextContent("ArrView received Sonarr's test message.")
})

test('the server error is shown as text, and the status is read again', async () => {
  const fetch = setupFetch({
    GET: service => stateOf(service, 'absent'),
    POST: () => answer(422, { error: 'Sonarr refused the webhook: <b>Unable to post</b> [404:NotFound]', refused: true }),
  })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up in Sonarr' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))
  await screen.findByText('Sonarr refused the webhook: <b>Unable to post</b> [404:NotFound]')
  expect(block('Sonarr').querySelector('b')).toBeNull()
  await waitFor(() => expect(setupCalls(fetch, 'GET')).toHaveLength(2))
  expect(live('Sonarr')).toHaveTextContent('Not set up.')
  expect(screen.getByRole('button', { name: 'Set up in Sonarr' })).toBeEnabled()
})

test('an answer that is not JSON, or none at all, says ArrView did not answer in time and re-checks the status', async () => {
  for (const reply of [() => notJson(504), () => { throw new TypeError('Failed to fetch') }]) {
    const fetch = setupFetch({ GET: service => stateOf(service, 'absent'), POST: reply })
    const { unmount } = render(<SetupHarness />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set up in Sonarr' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await screen.findByText('ArrView did not answer in time. Sonarr may still be testing the address: the status above is re-checked.')
    await waitFor(() => expect(setupCalls(fetch, 'GET')).toHaveLength(2))
    unmount()
  }
})

test('while a set-up is pending every button of that service is disabled, and after 3 seconds the card says why it can take long', async () => {
  vi.useFakeTimers()
  const pending = deferred()
  let state = 'absent'
  setupFetch({ GET: service => stateOf(service, state), POST: () => pending.promise })
  render(<SetupHarness />)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Set up in Sonarr' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
  for (const button of within(block('Sonarr')).getAllByRole('button')) expect(button).toBeDisabled()
  const waiting = 'Waiting for Sonarr to test the address. If Sonarr cannot reach ArrView, this can take up to two minutes.'
  await act(async () => { await vi.advanceTimersByTimeAsync(2900) })
  expect(live('Sonarr')).not.toHaveTextContent(waiting)
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  expect(live('Sonarr')).toHaveTextContent(waiting)
  state = 'present'
  await act(async () => { pending.resolve(answer(201, { state: 'present', created: true, skipped: [], testReceived: true })) })
  await act(async () => {})
  expect(live('Sonarr')).not.toHaveTextContent(waiting)
  expect(lines('Sonarr')).toEqual(['Set up.', "ArrView received Sonarr's test message."])
  for (const button of within(block('Sonarr')).getAllByRole('button')) expect(button).toBeEnabled()
})

test('Remove asks first, Cancel sends nothing, and confirming sends DELETE and re-reads the status', async () => {
  let state = 'present'
  const fetch = setupFetch({
    GET: service => stateOf(service, state),
    DELETE: () => { state = 'absent'; return answer(200, { state: 'absent', removed: true }) },
  })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from Sonarr' }))
  expect(block('Sonarr')).toHaveTextContent('Remove the ArrView webhook from Sonarr? Your other connections are not changed.')
  fireEvent.click(within(block('Sonarr')).getByRole('button', { name: 'Cancel' }))
  expect(block('Sonarr')).not.toHaveTextContent('Remove the ArrView webhook from Sonarr?')
  expect(setupCalls(fetch, 'DELETE')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Remove from Sonarr' }))
  fireEvent.click(within(block('Sonarr')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(live('Sonarr')).toHaveTextContent('Not set up.'))
  const [[url, init]] = setupCalls(fetch, 'DELETE')
  expect(url).toBe('/api/webhook-setup/sonarr')
  expect(new Headers(init.headers).get('X-Requested-With')).toBe('ArrView')
  expect(screen.getByRole('button', { name: 'Set up in Sonarr' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove from Sonarr' })).toBeNull()
})

test('a remove the server refuses shows its error as text', async () => {
  setupFetch({
    GET: service => stateOf(service, 'different-address', { address: 'http://old.example/api/webhooks/sonarr' }),
    DELETE: () => answer(502, { error: 'Sonarr answered, but the ArrView webhook is still there', state: 'different-address' }),
  })
  render(<SetupHarness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove from Sonarr' }))
  fireEvent.click(within(block('Sonarr')).getByRole('button', { name: 'Remove' }))
  await screen.findByText('Sonarr answered, but the ArrView webhook is still there')
})

test('Last event received shows a Test message that arrived with no event', () => {
  render(<Harness activity={{ status: 'ready', receivedAt: 1000, data: { uptimeSeconds: 30, sonarr: { event: null, test: { eventType: 'Test', ageSeconds: 0 } }, radarr: { event: null, test: null } } }} now={1000} />)
  expect(within(screen.getByRole('list', { name: 'Last event received' })).getAllByRole('listitem')[0])
    .toHaveTextContent('Sonarr: No event since ArrView started less than a minute ago. Test message received less than a minute ago.')
})

test('the guides no longer call a green Test check proof: the Test message is, and a login page or redirect is checked before the triggers', () => {
  const { container } = render(<Harness initial="192.0.2.10:7777" />)
  expect(container).not.toHaveTextContent('A green check means ArrView answered')
  for (const name of ['Sonarr', 'Radarr']) {
    const steps = [...screen.getByText(`Set up the webhook in ${name}`).closest('details').querySelectorAll('li')]
    const step = steps.find(li => li.textContent.startsWith('Select Test.'))
    expect(step).toHaveTextContent('"Test message received"')
    expect(step).toHaveTextContent('a login page or a redirect also passes')
  }
  const item = within(screen.getByText('If it does not work').closest('details')).getByText('Test passes but nothing updates.').closest('li')
  const text = item.textContent
  expect(text.indexOf('login page')).toBeGreaterThan(-1)
  expect(text.indexOf('login page')).toBeLessThan(text.indexOf('check the triggers'))
  expect(text).toContain('Sonarr or Radarr counts any answer below 400 as a pass.')
  expect(text).toContain('If it stays at "No event" while things change in Sonarr or Radarr, the events never arrive.')
})

test('Settings passes the saved address to the card: Set up is enabled until the address is edited', async () => {
  setupFetch({ GET: service => stateOf(service, 'absent') })
  render(<ConfigPage initialConfig={base({ webhooks: { baseUrl: SAVED } })} onSave={() => {}} onBack={() => {}} />)
  const button = await screen.findByRole('button', { name: 'Set up in Sonarr' })
  expect(button).toBeEnabled()
  typeAddress('192.0.2.10:7777')
  expect(button).toBeDisabled()
})
