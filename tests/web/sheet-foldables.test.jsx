import React, { useState } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react'
import Sheet from '../../src/components/Sheet'
import AddMediaModal from '../../src/components/AddMediaModal'
import NzbSearchModal from '../../src/components/NzbSearchModal'
import Dashboard from '../../src/components/Dashboard'
import { reply, config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// Spec criteria 10, 12 and 36 (B3 header actions, B4 blur order, enterkeyhint), keyed off <html data-screen-height> (note 1 item 1).
const PROFILES = [{ id: 1, name: 'Fixture HD', items: [{ quality: { id: 1, name: 'HD', resolution: 1080 }, allowed: true }] }]
const FOLDERS = [{ path: '/media/a', freeSpace: 1024 ** 4 }]
const RESULTS = [{ title: 'Result One', tvdbId: 1, tmdbId: 1, year: 2024 }]
let restoreMedia
beforeEach(() => {
  resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn()
  delete document.documentElement.dataset.screenHeight
})
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete document.documentElement.dataset.screenHeight })

function stubAdd(post = () => reply({ id: 50 })) {
  return stubFetch({
    '/api/sonarr/qualityprofiles': () => reply(PROFILES), '/api/sonarr/rootfolders': () => reply(FOLDERS),
    '/api/sonarr/lookup': () => reply(RESULTS),
    '/api/sonarr/series': (url, init) => init?.method === 'POST' ? post(url, init) : reply([]),
  })
}
const mountAdd = () => render(<AddMediaModal type="show" library={[]} onClose={vi.fn()} onAdded={vi.fn()} onToast={vi.fn()} />)
const headerOrder = () => [...document.querySelector('.sheet-header').children].map(el => el.tagName === 'H2' ? 'title' : el.getAttribute('aria-label') || el.textContent.trim())

test('B3: on a short screen the primary action sits in the header after Close and the title; no footer, no Cancel (criterion 10)', async () => {
  document.documentElement.dataset.screenHeight = 'short'
  stubAdd(); mountAdd()
  expect(headerOrder()).toEqual(['Close dialog', 'title', 'Add Show'])
  expect(document.querySelector('.add-footer')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  const add = within(document.querySelector('.sheet-header')).getByRole('button', { name: 'Add Show' })
  expect(add).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for a show' }), { target: { value: 'result' } })
  await screen.findByRole('button', { name: 'Select Result One' })
  await waitFor(() => expect(add).toBeEnabled())
})
test('B3: the add error shows at the top of the sheet content on a short screen, and the busy text is kept', async () => {
  document.documentElement.dataset.screenHeight = 'short'
  let finish
  stubAdd(() => new Promise(resolve => { finish = () => resolve(reply({ error: 'Fixture failure' })) })); mountAdd()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for a show' }), { target: { value: 'result' } })
  await screen.findByRole('button', { name: 'Select Result One' })
  const add = within(document.querySelector('.sheet-header')).getByRole('button', { name: 'Add Show' })
  await waitFor(() => expect(add).toBeEnabled())
  fireEvent.click(add)
  await waitFor(() => expect(document.querySelector('.sheet-header')).toHaveTextContent('Adding…'))
  await act(async () => { finish() })
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Fixture failure')
  expect(document.querySelector('.sheet-content').firstElementChild).toContainElement(alert)
})
test('B3: on a regular-height screen the footer and header are as before, and the header follows <html data-screen-height> live', async () => {
  stubAdd(); mountAdd()
  expect(headerOrder()).toEqual(['title', 'Close dialog'])
  const footer = document.querySelector('.add-footer')
  expect(within(footer).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  expect(within(footer).getByRole('button', { name: 'Add Show' })).toBeInTheDocument()
  const dialog = screen.getByRole('dialog')
  act(() => { document.documentElement.dataset.screenHeight = 'short' })
  await waitFor(() => expect(headerOrder()).toEqual(['Close dialog', 'title', 'Add Show']))
  expect(screen.getByRole('dialog')).toBe(dialog)
  act(() => { document.documentElement.dataset.screenHeight = 'regular' })
  await waitFor(() => expect(headerOrder()).toEqual(['title', 'Close dialog']))
})
test('sheets without a primary action keep their header on short screens', () => {
  document.documentElement.dataset.screenHeight = 'short'
  render(<Sheet title="Plain" onClose={() => {}}><p>Body</p></Sheet>)
  expect(headerOrder()).toEqual(['title', 'Close dialog'])
})

function Opener() {
  const [open, setOpen] = useState(false)
  return <>
    <button onClick={() => setOpen(true)}>Open</button>
    {open && <Sheet title="Typing" onClose={() => setOpen(false)}><input type="text" aria-label="Field" /></Sheet>}
  </>
}
test('B4: closing a sheet blurs its focused text field before the dialog unmounts and before the opener is focused (criterion 12a)', () => {
  render(<Opener />)
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus(); fireEvent.click(opener)
  const field = screen.getByRole('textbox', { name: 'Field' })
  field.focus()
  expect(document.activeElement).toBe(field)
  const log = []
  const blur = HTMLElement.prototype.blur, focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'blur').mockImplementation(function () { log.push(['blur', this, this.isConnected]); return blur.call(this) })
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (...args) { log.push(['focus', this, this.isConnected]); return focus.apply(this, args) })
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
  const blurAt = log.findIndex(([kind, el]) => kind === 'blur' && el === field)
  const focusAt = log.findIndex(([kind, el]) => kind === 'focus' && el === opener)
  expect(blurAt).toBeGreaterThan(-1)
  expect(log[blurAt][2]).toBe(true) // still in the document when blurred
  expect(focusAt).toBeGreaterThan(blurAt)
  expect(document.activeElement).toBe(opener)
})

test('B4: a route change blurs an active text field before the heading is focused (criterion 12b)', async () => {
  stubFetch()
  window.location.hash = '#/shows'
  render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const field = screen.getByRole('textbox', { name: 'Search shows' })
  field.focus()
  const log = []
  const blur = HTMLElement.prototype.blur, focus = HTMLElement.prototype.focus
  vi.spyOn(HTMLElement.prototype, 'blur').mockImplementation(function () { log.push(['blur', this]); return blur.call(this) })
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (...args) { log.push(['focus', this]); return focus.apply(this, args) })
  act(() => { window.location.hash = '#/movies'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  await waitFor(() => expect(log.some(([kind, el]) => kind === 'focus' && el.tagName === 'H1')).toBe(true))
  const blurAt = log.findIndex(([kind, el]) => kind === 'blur' && el === field)
  const headingAt = log.findIndex(([kind, el]) => kind === 'focus' && el.tagName === 'H1')
  expect(blurAt).toBeGreaterThan(-1)
  expect(blurAt).toBeLessThan(headingAt)
})

test('B4: the four search fields carry enterkeyhint="search" and blur on Enter, after their own Enter behaviour (criterion 12c)', async () => {
  const fetchMock = stubFetch({ '/api/nzbhydra/search': () => reply([]), '/api/sonarr/qualityprofiles': () => reply(PROFILES), '/api/sonarr/rootfolders': () => reply(FOLDERS), '/api/sonarr/lookup': () => reply([]) })
  window.location.hash = '#/shows'
  const view = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const check = field => {
    expect(field).toHaveAttribute('enterkeyhint', 'search')
    field.focus(); expect(document.activeElement).toBe(field)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(document.activeElement).not.toBe(field)
  }
  check(screen.getByRole('textbox', { name: 'Search shows' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add Show' }))
  check(await screen.findByRole('textbox', { name: 'Search for a show' }))
  view.unmount()
  window.location.hash = '#/movies'
  const movies = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  check(screen.getByRole('textbox', { name: 'Search movies' }))
  movies.unmount()
  render(<NzbSearchModal embedded onToast={() => {}} />)
  const nzb = screen.getByRole('textbox', { name: 'Search for something to download' })
  fireEvent.change(nzb, { target: { value: 'fixture' } })
  check(nzb)
  await waitFor(() => expect(fetchMock.calls.some(call => call.url.startsWith('/api/nzbhydra/search?q=fixture'))).toBe(true))
})

// B3 keyboard (criterion 11): a sheet that opens with its initial field focused while the keyboard is already up is fitted
// to the visual viewport at once, without waiting for another focus or viewport event.
function Prefocused() {
  const field = React.useRef(null)
  return <Sheet title="Typing" onClose={() => {}} initialFocus={field}><input ref={field} type="text" aria-label="Field" /></Sheet>
}
test('B3: a sheet opened with the keyboard already up is fitted to the visual viewport on open (criterion 11)', () => {
  const vv = Object.assign(new EventTarget(), { width: window.innerWidth, height: window.innerHeight - 300, offsetTop: 40 })
  vi.stubGlobal('visualViewport', vv)
  render(<Prefocused />)
  const dialog = document.querySelector('dialog.sheet')
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Field' }))
  expect(dialog.classList.contains('is-keyboard')).toBe(true)
  expect(dialog.style.getPropertyValue('--kb-height')).toBe(`${window.innerHeight - 300}px`)
  expect(dialog.style.getPropertyValue('--kb-top')).toBe('40px')
})
test('B3: a sheet opened with the visual viewport at full height is not fitted on open', () => {
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { width: window.innerWidth, height: window.innerHeight, offsetTop: 0 }))
  render(<Prefocused />)
  expect(document.querySelector('dialog.sheet').classList.contains('is-keyboard')).toBe(false)
})
