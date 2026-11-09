import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import SignIn from '../../src/components/SignIn'

const reply = (status, body) => new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const type = (value = 'a password') => fireEvent.change(screen.getByLabelText('Password'), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: /Sign In|Signing in/ }))

test('idle: a real form with password-manager attributes and a labelled password field', () => {
  const { container } = render(<SignIn onSignedIn={() => {}} />)
  expect(screen.getByRole('heading', { level: 1, name: /Sign in/ })).toBeVisible()
  const password = screen.getByLabelText('Password')
  expect(password).toHaveAttribute('type', 'password')
  expect(password).toHaveAttribute('autocomplete', 'current-password')
  expect(password).toBeRequired()
  const user = container.querySelector('input[autocomplete="username"]')
  expect(user).toHaveValue('ArrView')
  expect(user).toHaveAttribute('readonly')
  expect(user).toHaveAttribute('aria-hidden', 'true')
  expect(container.querySelector('form')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Sign In' })).toHaveAttribute('type', 'submit')
  expect(container.querySelector('button svg')).not.toBeNull()
})

test('submitting posts the password, shows the pending label and calls onSignedIn on success', async () => {
  let release
  const fn = vi.fn(() => new Promise(resolve => { release = () => resolve(reply(200, { success: true })) }))
  vi.stubGlobal('fetch', fn)
  const onSignedIn = vi.fn()
  render(<SignIn onSignedIn={onSignedIn} />)
  type('my secret pass')
  submit()
  expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
  const [url, options] = fn.mock.calls[0]
  expect(url).toBe('/api/auth/login')
  expect(options.method).toBe('POST')
  expect(JSON.parse(options.body)).toEqual({ password: 'my secret pass' })
  const headers = new Headers(options.headers)
  expect(headers.get('Content-Type')).toBe('application/json')
  expect(headers.get('X-Requested-With')).toBe('ArrView')
  await act(async () => release())
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
})

// A browser can fill a password (autofill, a password manager) without telling the page: the field shows it, but no input event
// has reached React until the next click, so the component's state is still empty. Enter must send what the field holds.
const fillSilently = value => {
  const field = screen.getByLabelText('Password')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value)
}

test('a password the browser filled in without telling the page is still sent', async () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  const onSignedIn = vi.fn()
  render(<SignIn onSignedIn={onSignedIn} />)
  fillSilently('filled by the browser')
  submit()
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ password: 'filled by the browser' })
})

test('a wrong password shows the server text, clears and refocuses the field', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Incorrect password' })))
  render(<SignIn onSignedIn={() => {}} />)
  type('wrong password')
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password')
  expect(screen.getByLabelText('Password')).toHaveValue('')
  expect(screen.getByLabelText('Password')).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})

test('too many attempts: minutes shown, button disabled until the time passes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(async () => reply(429, { error: 'Too many attempts. Try again later.', retryAfterSeconds: 125 })))
  render(<SignIn onSignedIn={() => {}} />)
  type()
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again later. Try again in 3 minutes.')
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled()
  await act(async () => { await vi.advanceTimersByTimeAsync(125 * 1000 + 10) })
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})

test('unavailable (503) shows the server text and keeps the button enabled', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: 'The login is unavailable because its settings could not be read. See the ArrView log.' })))
  render(<SignIn onSignedIn={() => {}} />)
  type()
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('The login is unavailable')
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})

test('a network failure says the server cannot be reached', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
  render(<SignIn onSignedIn={() => {}} />)
  type()
  submit()
  expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach your ArrView server. Check your connection and try again.')
})

test('the expired notice shows when App switched here after a 401', () => {
  render(<SignIn onSignedIn={() => {}} expired />)
  expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.')
})

// Enter is handled by the form's own key handler (src/submitOnEnter.js). On one real Edge the key reached the page (keydown and
// keyup) but the browser never ran the form's own submission for it (no change, click or submit event followed), so Enter did
// nothing until the field was left and entered again. jsdom does not run implicit submission either, so these tests fail on a
// form that relies on it.
const enter = (target = screen.getByLabelText('Password'), init = {}) => fireEvent.keyDown(target, { key: 'Enter', ...init })

test('Enter in the password field signs in without the browser submitting the form', async () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  const onSignedIn = vi.fn()
  render(<SignIn onSignedIn={onSignedIn} />)
  type('my secret pass')
  enter()
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
  expect(fn).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ password: 'my secret pass' })
})

// Something outside the page can cancel the key before the page sees it (an extension does); the browser then never reaches its own
// submission, so Enter must still sign in.
test('Enter signs in even when something cancelled the key before the page saw it', async () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  const onSignedIn = vi.fn()
  render(<SignIn onSignedIn={onSignedIn} />)
  const cancel = e => e.preventDefault()
  document.addEventListener('keydown', cancel, true)
  try {
    type('my secret pass')
    enter()
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
  } finally {
    document.removeEventListener('keydown', cancel, true)
  }
  expect(fn).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fn.mock.calls[0][1].body)).toEqual({ password: 'my secret pass' })
})

test('Enter with nothing in the field says so, keeps the cursor there and sends nothing', () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  render(<SignIn onSignedIn={() => {}} />)
  enter()
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your password')
  expect(screen.getByLabelText('Password')).toHaveFocus()
  expect(fn).not.toHaveBeenCalled()
})

test('the Sign In button with nothing in the field says so too, instead of the browser blocking it without a word', () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  const { container } = render(<SignIn onSignedIn={() => {}} />)
  expect(container.querySelector('form')).toHaveAttribute('novalidate')
  submit()
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your password')
  expect(fn).not.toHaveBeenCalled()
})

test('while a sign-in is running, Enter sends nothing more', async () => {
  let release
  const fn = vi.fn(() => new Promise(resolve => { release = () => resolve(reply(200, { success: true })) }))
  vi.stubGlobal('fetch', fn)
  render(<SignIn onSignedIn={() => {}} />)
  type('my secret pass')
  enter()
  expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
  enter()
  expect(fn).toHaveBeenCalledTimes(1)
  await act(async () => release())
})

test('while the screen is blocked after too many attempts, Enter sends nothing', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const fn = vi.fn(async () => reply(429, { error: 'Too many attempts. Try again later.', retryAfterSeconds: 125 }))
  vi.stubGlobal('fetch', fn)
  render(<SignIn onSignedIn={() => {}} />)
  type()
  enter()
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled()
  type()
  enter()
  expect(fn).toHaveBeenCalledTimes(1)
})

test('Enter that confirms an input-method composition does not sign in', () => {
  const fn = vi.fn(async () => reply(200, { success: true }))
  vi.stubGlobal('fetch', fn)
  render(<SignIn onSignedIn={() => {}} />)
  type('a password')
  enter(undefined, { isComposing: true })
  expect(fn).not.toHaveBeenCalled()
})
