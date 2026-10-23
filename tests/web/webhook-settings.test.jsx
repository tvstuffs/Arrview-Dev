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
  const order = [...container.querySelectorAll('.services-grid, .webhook-card, .install-help')]
  expect(order.map(el => el.className.split(' ')[0])).toEqual(['services-grid', 'webhook-card', 'install-help'])
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
