import React from 'react'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../../src/App'
import { resetAuthRequired } from '../../src/api'

vi.mock('../../src/components/ConfigPage.jsx', () => ({ default: () => <h1>Fixture setup</h1> }))
vi.mock('../../src/components/Dashboard.jsx', () => ({ default: () => {
  // a data request from the mounted app, so a 401 episode can be provoked
  return <button onClick={async () => (await import('../../src/api')).apiFetch('/api/sonarr/series')}>Load data</button>
} }))

const reply = (status, body) => new Response(JSON.stringify(body), { status })
const CONFIG = { sonarr: { url: 'fixture', apikey: 'fixture' } }
let signedIn, statusReply
const calls = []
beforeEach(() => {
  signedIn = false
  calls.length = 0
  resetAuthRequired()
  statusReply = () => reply(200, signedIn ? { required: true, signedIn: true, source: 'settings' } : { required: true, signedIn: false })
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push(url)
    if (url === '/api/auth/status') return statusReply()
    if (url === '/api/auth/login') { signedIn = true; return reply(200, { success: true }) }
    if (url === '/api/config') return reply(200, CONFIG)
    return reply(401, { error: 'Authentication required', auth: true })
  }))
})
afterEach(() => vi.unstubAllGlobals())

test('login required and not signed in: Sign in is shown and nothing else is requested', async () => {
  render(<App />)
  expect(await screen.findByRole('heading', { name: /Sign in/ })).toBeVisible()
  expect(calls).toEqual(['/api/auth/status'])
})

test('signed in: the app is shown', async () => {
  signedIn = true
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  expect(calls).toEqual(['/api/auth/status', '/api/config'])
})

test('a status without a boolean required, and a 404, both mean the login is off', async () => {
  for (const make of [() => reply(200, {}), () => reply(404, { error: 'Not found' })]) {
    statusReply = make
    const { unmount } = render(<App />)
    expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
    unmount()
  }
})

test('another status failure keeps the cannot-reach screen', async () => {
  statusReply = () => reply(500, {})
  render(<App />)
  expect(await screen.findByRole('heading', { name: /Can’t reach/ })).toBeVisible()
})

test('a new install shows the setup screen first and requests nothing else; the warning is plain', async () => {
  statusReply = () => reply(200, { required: false, signedIn: false, source: 'none', setupPending: true })
  render(<App />)
  expect(await screen.findByRole('heading', { name: /Protect ArrView/ })).toBeVisible()
  expect(screen.getByText(/anyone who can reach this address can use ArrView, including deleting files/)).toBeVisible()
  expect(calls).toEqual(['/api/auth/status'])
})

test('setup: continue without a password posts the skip route and then loads the app', async () => {
  let pending = true
  statusReply = () => reply(200, { required: false, signedIn: false, source: 'none', setupPending: pending })
  const base = fetch
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push(url)
    if (url === '/api/auth/status') return statusReply()
    if (url === '/api/auth/setup/skip') { pending = false; return reply(200, { success: true }) }
    if (url === '/api/config') return reply(200, CONFIG)
    return base(url, options)
  }))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Continue without a password' }))
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  expect(calls).toContain('/api/auth/setup/skip')
})

test('setup: set a password checks the rules first, posts the password and loads the app signed in', async () => {
  let pending = true
  const bodies = []
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push(url)
    if (url === '/api/auth/status') return reply(200, pending ? { required: false, signedIn: false, source: 'none', setupPending: true } : { required: true, signedIn: true, source: 'settings', setupPending: false })
    if (url === '/api/auth/password') { bodies.push(JSON.parse(options.body)); pending = false; return reply(200, { success: true }) }
    if (url === '/api/config') return reply(200, CONFIG)
    return reply(401, { error: 'Authentication required', auth: true })
  }))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be 8 to 256 characters')
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a good password' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'another one' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('don’t match')
  expect(bodies).toEqual([])
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a good password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  expect(bodies).toEqual([{ newPassword: 'a good password' }])
})

// A browser can fill a password (autofill, a password manager) without telling the page: the field shows it, but no input event
// has reached React until the next click, so the page's copy of it is still empty. Saving must use what the fields hold.
const fillSilently = (input, value) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)

// A new install; the array collects what is posted to set the password.
function stubFreshInstall() {
  let pending = true
  const bodies = []
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push(url)
    if (url === '/api/auth/status') return reply(200, pending ? { required: false, signedIn: false, source: 'none', setupPending: true } : { required: true, signedIn: true, source: 'settings', setupPending: false })
    if (url === '/api/auth/password') { bodies.push(JSON.parse(options.body)); pending = false; return reply(200, { success: true }) }
    if (url === '/api/config') return reply(200, CONFIG)
    return reply(401, { error: 'Authentication required', auth: true })
  }))
  return bodies
}

test('setup: passwords the browser filled in without telling the page are still posted', async () => {
  const bodies = stubFreshInstall()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  // new-password fields are the ones a browser is least likely to fill behind the page's back, but the form reads both in one place
  fillSilently(screen.getByLabelText('New password'), 'filled by the browser')
  fillSilently(screen.getByLabelText('Confirm new password'), 'filled by the browser')
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  expect(bodies).toEqual([{ newPassword: 'filled by the browser' }])
})

test('setup: a refusal leaves silently filled fields showing their passwords, as it does for typed ones', async () => {
  const bodies = stubFreshInstall()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  fillSilently(screen.getByLabelText('New password'), 'filled by the browser')
  fillSilently(screen.getByLabelText('Confirm new password'), 'another one entirely')
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('don’t match')
  expect(screen.getByLabelText('New password')).toHaveValue('filled by the browser')
  expect(screen.getByLabelText('Confirm new password')).toHaveValue('another one entirely')
  expect(bodies).toEqual([])
})

// What the form says when nothing at all was entered must not change with the fix (the page's copy of an untouched field is unset).
// Enter is handled by the form's own key handler (src/submitOnEnter.js): on one real Edge the key reached the page but the browser
// never ran the form's own submission. jsdom does not run implicit submission either, so this fails on a form that relies on it.
test('setup: Enter in a password field saves the passwords without the browser submitting the form', async () => {
  const bodies = stubFreshInstall()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new password' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a new password' } })
  fireEvent.keyDown(screen.getByLabelText('Confirm new password'), { key: 'Enter' })
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  expect(bodies).toEqual([{ newPassword: 'a new password' }])
})

test('setup: Enter on the Back button does not save', async () => {
  const bodies = stubFreshInstall()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new password' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a new password' } })
  fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Enter' })
  expect(bodies).toEqual([])
  expect(screen.getByLabelText('New password')).toBeVisible()
})

test('setup: with nothing entered the form still says the length rule', async () => {
  const bodies = stubFreshInstall()
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Protect with a password/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be 8 to 256 characters')
  expect(bodies).toEqual([])
})

test('a 401 mid-session swaps to Sign in with the notice; signing in returns without touching localStorage', async () => {
  signedIn = true
  localStorage.setItem('arrview.layout', 'classic')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Load data' }))
  expect(await screen.findByRole('heading', { name: /Sign in/ })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.')
  signedIn = false
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
  expect(await screen.findByRole('button', { name: 'Load data' })).toBeVisible()
  await waitFor(() => expect(localStorage.getItem('arrview.layout')).toBe('classic'))
})
