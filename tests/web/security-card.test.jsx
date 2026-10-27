import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import SecurityCard from '../../src/components/SecurityCard'
import ConfigPage from '../../src/components/ConfigPage'
import { AuthContext } from '../../src/AuthContext'

const reply = (status, body) => new Response(JSON.stringify(body), { status })
const base = { required: false, signedIn: false, source: 'none', authDisabledByDocker: false, passwordMinLength: 8, passwordMaxLength: 256 }
const ON = { ...base, required: true, signedIn: true, source: 'settings' }
const KEY = 'THE-ACCESS-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456'
let fn, refresh
function mount(status, handler) {
  refresh = vi.fn(async () => {})
  fn = vi.fn(async (url, options) => (handler ? handler(url, options) : reply(200, { success: true })))
  vi.stubGlobal('fetch', fn)
  return render(<AuthContext.Provider value={{ status, refresh }}><SecurityCard /></AuthContext.Provider>)
}
afterEach(() => vi.unstubAllGlobals())
const body = call => JSON.parse(call[1].body)
const field = label => screen.getByLabelText(label)
// The key form and the password forms each have a Current password field: pick the form first.
const passwordFormField = label => within(document.querySelector('form:not(.key-create)')).getByLabelText(label)
const keyPasswordField = () => within(document.querySelector('.key-create')).getByLabelText('Current password')
const makeKey = (password = 'my password!') => { fireEvent.change(keyPasswordField(), { target: { value: password } }); click(/Make a key/) }
const click = name => fireEvent.click(screen.getByRole('button', { name }))
const paths = () => fn.mock.calls.map(c => c[0])
const LIST = { keys: [{ id: '0123456789abcdef', name: 'Sonarr script', created: 1_790_000_000, lastUsed: null }, { id: 'fedcba9876543210', name: 'Phone', created: 1_790_100_000, lastUsed: 1_790_200_000 }] }
// Mounts with the login on and waits for the key list request, then clears the call log.
async function mountOn(status, handler) {
  const rendered = mount(status, (url, options) => (url === '/api/auth/keys' && (!options || !options.method || options.method === 'GET') ? reply(200, LIST) : handler ? handler(url, options) : reply(200, { success: true })))
  await screen.findByText('Sonarr script')
  fn.mockClear()
  return rendered
}

test('nothing renders without an AuthContext value, and ConfigPage still renders without it', () => {
  const { container } = render(<SecurityCard />)
  expect(container).toBeEmptyDOMElement()
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, {})))
  render(<ConfigPage initialConfig={{}} onSave={() => {}} />)
  expect(screen.queryByRole('heading', { name: 'Security' })).toBeNull()
})

test('off: warning text, set-a-password flow checks before any request and refreshes on success', async () => {
  const { container } = mount(base)
  expect(screen.getByRole('heading', { name: 'Security' })).toBeVisible()
  expect(screen.getByText(/No password is set\. Anyone who can reach this address/)).toBeVisible()
  expect(container.querySelector('h2 svg')).not.toBeNull()
  click(/Set a password/)
  expect(container.querySelector('input[autocomplete="username"]')).toHaveValue('ArrView')
  expect(field('New password')).toHaveAttribute('autocomplete', 'new-password')
  expect(field('Confirm new password')).toHaveAttribute('autocomplete', 'new-password')
  fireEvent.change(field('New password'), { target: { value: 'short' } })
  fireEvent.change(field('Confirm new password'), { target: { value: 'short' } })
  click('Save password')
  expect(screen.getByRole('alert')).toHaveTextContent('Password must be 8 to 256 characters')
  fireEvent.change(field('New password'), { target: { value: '        ' } })
  click('Save password')
  expect(screen.getByRole('alert')).toHaveTextContent("Password can't be only spaces")
  fireEvent.change(field('New password'), { target: { value: 'long enough pw' } })
  click('Save password')
  expect(screen.getByRole('alert')).toHaveTextContent('don’t match')
  expect(fn).not.toHaveBeenCalled()
  fireEvent.change(field('Confirm new password'), { target: { value: 'long enough pw' } })
  click('Save password')
  await waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(fn.mock.calls[0][0]).toBe('/api/auth/password')
  expect(body(fn.mock.calls[0])).toEqual({ newPassword: 'long enough pw' })
  expect(new Headers(fn.mock.calls[0][1].headers).get('X-Requested-With')).toBe('ArrView')
})

test('a server error is shown in the card', async () => {
  mount(base, () => reply(409, { error: 'A password was set a moment ago. Sign in instead.' }))
  click(/Set a password/)
  fireEvent.change(field('New password'), { target: { value: 'long enough pw' } })
  fireEvent.change(field('Confirm new password'), { target: { value: 'long enough pw' } })
  click('Save password')
  expect(await screen.findByRole('alert')).toHaveTextContent('A password was set a moment ago')
  expect(refresh).not.toHaveBeenCalled()
})

test('on (Settings): change sends currentPassword, remove asks to confirm first, sign out posts logout', async () => {
  const { container } = await mountOn(ON)
  expect(screen.getByText(/Password protection is on\. This browser stays signed in for 30 days of use\./)).toBeVisible()
  expect(screen.getByText(/iOS and tvOS apps can’t sign in yet/)).toBeVisible()
  expect(container.querySelector('h2 svg')).not.toBeNull()
  click('Change password')
  fireEvent.change(passwordFormField('Current password'), { target: { value: 'old password!' } })
  fireEvent.change(field('New password'), { target: { value: 'new password!' } })
  fireEvent.change(field('Confirm new password'), { target: { value: 'new password!' } })
  click('Change password')
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(body(fn.mock.calls[0])).toEqual({ currentPassword: 'old password!', newPassword: 'new password!' })

  fn.mockClear()
  click('Remove password')
  fireEvent.change(passwordFormField('Current password'), { target: { value: 'old password!' } })
  click('Remove password')
  expect(fn).not.toHaveBeenCalled()
  const sheet = await screen.findByRole('dialog', {}, { timeout: 2000 }).catch(() => null)
  const confirm = (sheet ? within(sheet) : screen).getAllByRole('button', { name: 'Remove password' }).at(-1)
  fireEvent.click(confirm)
  await waitFor(() => expect(paths()).toContain('/api/auth/password/remove'))
  expect(body(fn.mock.calls[0])).toEqual({ currentPassword: 'old password!' })

  fn.mockClear()
  click(/^Sign out$/)
  await waitFor(() => expect(paths()).toEqual(['/api/auth/logout']))
  expect(fn.mock.calls[0][1].method).toBe('POST')
  // the server refuses a POST without a JSON content type, so even an empty one declares it
  expect(new Headers(fn.mock.calls[0][1].headers).get('Content-Type')).toBe('application/json')
})

test('keys: the list shows name, created and last used and never a key; a new key is made with an optional name', async () => {
  const { container } = await mountOn(ON, url => (url === '/api/auth/keys' ? reply(200, { accessKey: KEY, id: 'aaaaaaaaaaaaaaaa', name: 'Cron job', created: 1 }) : reply(200, {})))
  expect(screen.getByText('Sonarr script')).toBeVisible()
  expect(screen.getByText(/Last used Never/)).toBeVisible()
  expect(screen.getByText(/shown only once/)).toBeVisible()
  expect(container.textContent).not.toContain(KEY)
  expect(keyPasswordField()).toHaveAttribute('autocomplete', 'current-password')
  expect(keyPasswordField()).toHaveAttribute('type', 'password')
  expect(container.querySelector('.key-create input[autocomplete="username"]')).toHaveValue('ArrView')
  fireEvent.change(field('Key name (optional)'), { target: { value: '  Cron job ' } })
  // no password: nothing is sent
  click(/Make a key/)
  expect(screen.getByRole('alert')).toHaveTextContent('Enter your current password')
  expect(fn).not.toHaveBeenCalled()
  makeKey('my password!')
  const shown = await screen.findByLabelText('New key for Cron job')
  expect(shown).toHaveValue(KEY)
  expect(shown).toHaveAttribute('readonly')
  expect(screen.getByText('Copy it now. It will not be shown again.')).toBeVisible()
  expect(fn.mock.calls[0][0]).toBe('/api/auth/keys')
  expect(fn.mock.calls[0][1].method).toBe('POST')
  expect(body(fn.mock.calls[0])).toEqual({ name: 'Cron job', currentPassword: 'my password!' })
  expect(paths()).toEqual(['/api/auth/keys', '/api/auth/keys'])
  expect(keyPasswordField()).toHaveValue('')
  expect(document.body.innerHTML).not.toContain('my password!')
  // Done removes the key from the page for good
  click('Done')
  expect(document.body.innerHTML).not.toContain(KEY)
})

test('a wrong current password shows the server error and still clears the field', async () => {
  await mountOn(ON, url => (url === '/api/auth/keys' ? reply(403, { error: 'Current password is incorrect' }) : reply(200, {})))
  makeKey('wrong one')
  expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect')
  expect(keyPasswordField()).toHaveValue('')
  expect(screen.queryByRole('group', { name: 'New key' })).toBeNull()
})

test('Copy writes the visible key in the same click with no request first (secure page)', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  await mountOn(ON, () => reply(200, { accessKey: KEY, id: 'aaaaaaaaaaaaaaaa', name: 'App key', created: 1 }))
  makeKey()
  await screen.findByLabelText('New key for App key')
  fn.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(writeText).toHaveBeenCalledWith(KEY) // called synchronously inside the click
  expect(fn).not.toHaveBeenCalled()
  expect(await screen.findByText('Copied')).toBeVisible()
})

test('Copy on a plain-HTTP page selects the visible field and uses the copy command', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  const exec = vi.fn(() => true)
  document.execCommand = exec
  await mountOn(ON, () => reply(200, { accessKey: KEY, id: 'aaaaaaaaaaaaaaaa', name: 'App key', created: 1 }))
  makeKey()
  const shown = await screen.findByLabelText('New key for App key')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(exec).toHaveBeenCalledWith('copy')
  expect(document.activeElement).toBe(shown)
  expect(shown.selectionStart).toBe(0)
  expect(shown.selectionEnd).toBe(KEY.length)
  expect(await screen.findByText('Copied')).toBeVisible()
})

test('when the browser refuses, the key stays selected with a hand-copy hint that says it will not be shown again', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  document.execCommand = vi.fn(() => false)
  await mountOn(ON, () => reply(200, { accessKey: KEY, id: 'aaaaaaaaaaaaaaaa', name: 'App key', created: 1 }))
  makeKey()
  const shown = await screen.findByLabelText('New key for App key')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(await screen.findByText(/copy it by hand now\. It will not be shown again/)).toBeVisible()
  expect(document.activeElement).toBe(shown)
  expect(screen.queryByText('Copied')).toBeNull()
})

test('removing one key and all keys confirm first; Sign out everywhere says the keys stop too', async () => {
  await mountOn(ON)
  click('Remove key Sonarr script')
  expect(fn).not.toHaveBeenCalled()
  expect(await screen.findByText('The app or script using it will stop working at once.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
  await waitFor(() => expect(paths()).toContain('/api/auth/keys/remove'))
  expect(body(fn.mock.calls[0])).toEqual({ id: '0123456789abcdef' })
  await waitFor(() => expect(paths()).toEqual(['/api/auth/keys/remove', '/api/auth/keys']))

  fn.mockClear()
  click(/Remove all keys/)
  expect(fn).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Remove all keys', hidden: false }).then(b => b, () => null) || screen.getAllByRole('button', { name: 'Remove all keys' }).at(-1))
  await waitFor(() => expect(paths()).toContain('/api/auth/keys/remove-all'))

  fn.mockClear()
  click('Sign out everywhere')
  expect(fn).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere', hidden: false }).then(b => b, () => null) || screen.getAllByRole('button', { name: 'Sign out everywhere' }).at(-1))
  await waitFor(() => expect(paths()).toContain('/api/auth/logout-all'))
  await waitFor(() => expect(refresh).toHaveBeenCalled())
})

test('set by Docker: password buttons disabled with the recreate wording, the rest still works', () => {
  mount({ ...ON, source: 'docker' })
  expect(screen.getByText(/docker compose up -d/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Remove password' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Change password' })).toHaveAttribute('aria-describedby')
  expect(screen.getByRole('button', { name: /^Sign out$/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled()
  expect(screen.getByRole('button', { name: /Make a key/ })).toBeEnabled()
})

test('disabled by ARRVIEW_AUTH=off: warning text and disabled controls', () => {
  mount({ ...base, authDisabledByDocker: true })
  expect(screen.getByText(/turned off by ARRVIEW_AUTH=off/)).toBeVisible()
  expect(screen.getByRole('button', { name: /Set a password/ })).toBeDisabled()
})
