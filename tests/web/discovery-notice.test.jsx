import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DiscoveryNotice from '../../src/components/DiscoveryNotice'
import ConfigPage from '../../src/components/ConfigPage'
import Dashboard from '../../src/components/Dashboard'
import { reply, config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// The server reports whether Bonjour (the iOS app's auto-discovery) started, in GET /api/arrview/identify.
// A server whose port 5353 is held by another mDNS responder keeps running without it, and Settings says so.
const NOTICE = { name: 'iOS auto-discovery' }
const blocked = { state: 'unavailable', reason: 'port-in-use' }
const remote = { hostname: 'nas.example.invalid', origin: 'http://nas.example.invalid:7777' }
const identify = bonjour => ({
  '/api/arrview/identify': () => reply({ version: '1.9A3', capabilities: ['movieDelete'], ...(bonjour ? { bonjour } : {}) }),
})

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('an unavailable Bonjour is flagged with the reason and the address to enter in the iOS app', () => {
  render(<DiscoveryNotice bonjour={blocked} location={remote} />)
  const notice = screen.getByRole('status', NOTICE)
  expect(notice).toHaveTextContent('iOS auto-discovery (Bonjour) is unavailable')
  expect(notice).toHaveTextContent('using the mDNS port (UDP 5353) and does not share it')
  expect(notice).toHaveTextContent('ArrView works normally')
  expect(notice).toHaveTextContent('"Or enter the address manually"')
  expect(notice.querySelector('code')).toHaveTextContent('http://nas.example.invalid:7777')
  // Set artwork from the Icon component, hidden from assistive technology.
  expect(notice.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
})

test('opened on the server itself, the notice does not offer an address a phone could not use', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const { container, unmount } = render(<DiscoveryNotice bonjour={blocked} location={{ hostname, origin: `http://${hostname}:7777` }} />)
    expect(screen.getByRole('status', NOTICE)).toHaveTextContent('enter this server\'s address.')
    expect(container.querySelector('code'), hostname).toBeNull()
    unmount()
  }
})

test.each([
  ['port-in-use', 'using the mDNS port (UDP 5353) and does not share it'],
  ['permission-denied', 'not allowed to open the mDNS port'],
  ['not-installed', 'Bonjour component is not installed'],
  ['start-failed', 'Bonjour failed to start. The server log has the details.'],
  [undefined, 'Bonjour failed to start. The server log has the details.'],
  ['a-reason-from-a-newer-server', 'Bonjour failed to start. The server log has the details.'],
])('reason %s is explained', (reason, text) => {
  render(<DiscoveryNotice bonjour={{ state: 'unavailable', reason }} location={remote} />)
  expect(screen.getByRole('status', NOTICE)).toHaveTextContent(text)
})

test('only an unavailable Bonjour is flagged', () => {
  for (const bonjour of [undefined, null, {}, { state: 'off' }, { state: 'starting' }, { state: 'advertising' }]) {
    const { container, unmount } = render(<DiscoveryNotice bonjour={bonjour} location={remote} />)
    expect(container, JSON.stringify(bonjour)).toBeEmptyDOMElement()
    unmount()
  }
})

test('first-run Settings shows the notice above the service checklist once the server has answered', async () => {
  stubFetch(identify(blocked))
  render(<ConfigPage onSave={() => {}} />)
  const notice = await screen.findByRole('status', NOTICE)
  expect(await screen.findByText('ArrView v1.9A3')).toBeInTheDocument()
  const checklist = screen.getByRole('region', { name: 'Service checklist' })
  expect(notice.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('Settings shows no notice while Bonjour works, is starting or off, or the server predates the field', async () => {
  for (const bonjour of [{ state: 'advertising' }, { state: 'starting' }, { state: 'off' }, undefined]) {
    stubFetch(identify(bonjour))
    const { unmount } = render(<ConfigPage onSave={() => {}} />)
    await screen.findByText('ArrView v1.9A3')
    expect(screen.queryByRole('status', NOTICE), JSON.stringify(bonjour)).toBeNull()
    unmount()
  }
})

test('Settings keeps working when the identify request fails', async () => {
  stubFetch({ '/api/arrview/identify': () => { throw new Error('offline') } })
  render(<ConfigPage onSave={() => {}} />)
  expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
  expect(screen.queryByRole('status', NOTICE)).toBeNull()
})

test('the Modern layout shows it on its Settings page', async () => {
  stubFetch(identify(blocked)); window.location.hash = '#/settings'
  const { container } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  expect(await screen.findByRole('status', NOTICE)).toBeInTheDocument()
  expect(container.querySelector('.m-shell .discovery-notice')).not.toBeNull()
})

test('the Classic layout shows it on its Settings page', async () => {
  stubFetch(identify(blocked))
  localStorage.setItem('arrview.ui.v1.layout', '"classic"'); localStorage.setItem('arrview.ui.v1.tab', '"settings"')
  const { container } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  expect(await screen.findByRole('status', NOTICE)).toBeInTheDocument()
  expect(container.querySelector('.dashboard .discovery-notice')).not.toBeNull()
})
