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
const click = name => fireEvent.click(screen.getByRole('button', { name }))
const paths = () => fn.mock.calls.map(c => c[0])

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
  const { container } = mount(ON)
  expect(screen.getByText(/Password protection is on\. This browser stays signed in for 30 days of use\./)).toBeVisible()
  expect(screen.getByText(/iOS and tvOS apps can’t sign in yet/)).toBeVisible()
  expect(container.querySelector('h2 svg')).not.toBeNull()
  click('Change password')
  fireEvent.change(field('Current password'), { target: { value: 'old password!' } })
  fireEvent.change(field('New password'), { target: { value: 'new password!' } })
  fireEvent.change(field('Confirm new password'), { target: { value: 'new password!' } })
  click('Change password')
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(body(fn.mock.calls[0])).toEqual({ currentPassword: 'old password!', newPassword: 'new password!' })

  fn.mockClear()
  click('Remove password')
  fireEvent.change(field('Current password'), { target: { value: 'old password!' } })
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
})

test('the key is fetched only on Copy and never put in the page; Regenerate and Sign out everywhere confirm first', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const { container } = mount(ON, url => (url === '/api/auth/access-key' ? reply(200, { accessKey: KEY }) : reply(200, { success: true, accessKey: 'NEW' })))
  expect(fn).not.toHaveBeenCalled()
  expect(screen.getByText('Access key for apps')).toBeVisible()
  expect(container.textContent).toContain('••••••••••••••••')
  click(/Copy/)
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY))
  expect(paths()).toEqual(['/api/auth/access-key'])
  expect(await screen.findByText('Copied')).toBeVisible()
  expect(document.body.innerHTML).not.toContain(KEY)

  fn.mockClear()
  click(/Regenerate/)
  expect(fn).not.toHaveBeenCalled()
  expect(await screen.findByText('Apps and scripts using the old key will stop working.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate key' }))
  await waitFor(() => expect(paths()).toEqual(['/api/auth/access-key/regenerate']))

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
  expect(screen.getByRole('button', { name: /Copy/ })).toBeEnabled()
})

test('disabled by ARRVIEW_AUTH=off: warning text and disabled controls', () => {
  mount({ ...base, authDisabledByDocker: true })
  expect(screen.getByText(/turned off by ARRVIEW_AUTH=off/)).toBeVisible()
  expect(screen.getByRole('button', { name: /Set a password/ })).toBeDisabled()
})
