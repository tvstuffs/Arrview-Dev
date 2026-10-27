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
