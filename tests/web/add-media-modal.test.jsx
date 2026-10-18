import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import AddMediaModal from '../../src/components/AddMediaModal'
import { reply, stubFetch } from './modern-helpers'

const leaf = (resolution, allowed = true) => ({ quality: { id: resolution, name: `Q${resolution}`, resolution }, allowed })
const PROFILES = [
  { id: 1, name: 'Alpha HD', items: [leaf(1080)] },
  { id: 2, name: 'Beta Mixed', items: [{ name: 'All', allowed: true, items: [leaf(480), leaf(720), leaf(2160)] }] },
  { id: 3, name: 'Gamma Unknown', items: [leaf(0)] },
]
const FOLDERS = [{ path: '/media/a', freeSpace: 850 * 1024 ** 3 }, { path: '/media/b', freeSpace: 2.1 * 1024 ** 4 }]
// Profile 2 and folder b are what the library uses, so neither default is the first one listed.
const SHOWS = [
  { id: 1, title: 'S1', qualityProfileId: 2, rootFolderPath: '/media/b' },
  { id: 2, title: 'S2', qualityProfileId: 2, rootFolderPath: '/media/b' },
  { id: 3, title: 'S3', qualityProfileId: 3, rootFolderPath: '/media/a' },
]
const RESULTS = [
  { title: 'Library Result', tvdbId: 3, tmdbId: 3, id: 9, year: 2020, images: [{ coverType: 'poster', remoteUrl: 'https://img.invalid/3.jpg' }] },
  { title: 'Result One', tvdbId: 1, tmdbId: 1, year: 2024, network: 'Net One', studio: 'Studio One', genres: ['Drama', 'Crime', 'Thriller', 'Extra'], overview: 'One overview.', images: [{ coverType: 'poster', remoteUrl: 'https://img.invalid/1.jpg' }] },
  { title: 'Result Two', tvdbId: 2, tmdbId: 2, year: 0, overview: 'Two overview.' },
]

let onClose, onAdded, onToast, scrollSpy
beforeEach(() => {
  onClose = vi.fn(); onAdded = vi.fn(); onToast = vi.fn()
  scrollSpy = Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView })

// Fetch stub for both services; `post` handles the add request.
function stub({ lookup = RESULTS, library = SHOWS, libraryFails = false, post = () => reply({ id: 50 }) } = {}) {
  const lib = (service, plural) => `/api/${service}/${plural}`
  const handlers = {}
  for (const [service, plural] of [['sonarr', 'series'], ['radarr', 'movies']]) {
    handlers[`/api/${service}/qualityprofiles`] = () => reply(PROFILES)
    handlers[`/api/${service}/rootfolders`] = () => reply(FOLDERS)
    handlers[`/api/${service}/lookup`] = () => reply(lookup)
    handlers[lib(service, plural)] = () => libraryFails ? Promise.reject(new Error('down')) : reply(library)
    handlers[`/api/${service}/${service === 'sonarr' ? 'series' : 'movie'}`] = (url, init) => init?.method === 'POST' ? post(url, init) : (libraryFails ? Promise.reject(new Error('down')) : reply(library))
  }
  handlers['/api/radarr/movies'] = () => libraryFails ? Promise.reject(new Error('down')) : reply(library)
  return stubFetch(handlers)
}
const posts = fetchMock => fetchMock.calls.filter(c => c.init?.method === 'POST').map(c => ({ url: c.url, body: JSON.parse(c.init.body) }))
const libraryFetches = fetchMock => fetchMock.calls.filter(c => /^\/api\/(sonarr\/series|radarr\/movies)$/.test(c.url) && !c.init?.method)

function mount(options = {}) {
  const { type = 'show', strict = false } = options
  const library = 'library' in options ? options.library : SHOWS
  const modal = <AddMediaModal type={type} library={library} onClose={onClose} onAdded={onAdded} onToast={onToast} />
  return render(strict ? <React.StrictMode>{modal}</React.StrictMode> : modal)
}
async function search(text = 'result') {
  fireEvent.change(screen.getByRole('textbox', { name: /Search for a/ }), { target: { value: text } })
  await screen.findByRole('button', { name: 'Select Result One' })
}
const qualityButton = () => screen.getByRole('button', { name: /Quality Profile/ })
const folderButton = () => screen.getByRole('button', { name: /Root Folder/ })
const addButton = type => screen.getByRole('button', { name: type === 'movie' ? 'Add Movie' : 'Add Show', exact: true })
const open = async button => { fireEvent.keyDown(button, { key: 'ArrowDown' }); return screen.findByRole('listbox') }
async function ready(options) { mount(options); await search(); await waitFor(() => expect(qualityButton()).toHaveTextContent('Beta Mixed')) }

test('result row: posters, titles, years, Already in library; the first selectable result is selected (criterion 4)', async () => {
  stub(); mount(); await search()
  const tiles = ['Library Result', 'Result One', 'Result Two'].map(name => screen.getByRole('button', { name: `Select ${name}` }))
  expect(tiles[0]).toHaveAttribute('aria-disabled', 'true')
  expect(tiles[0]).toHaveAttribute('tabindex', '-1')
  expect(tiles[0]).toHaveTextContent('Already in library')
  expect(tiles[1]).toHaveAttribute('aria-pressed', 'true')
  expect(tiles[1]).toHaveClass('selected')
  expect(tiles[1].querySelector('img')).toHaveAttribute('src', 'https://img.invalid/1.jpg')
  expect(tiles[1]).toHaveTextContent('2024')
  expect(tiles[2].querySelector('img')).toBeNull() // letter placeholder
  expect(tiles[2]).toHaveTextContent('R')
  expect(tiles[2]).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(tiles[0])
  expect(tiles[1]).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(tiles[2])
  expect(tiles[2]).toHaveAttribute('aria-pressed', 'true')
  expect(tiles[1]).toHaveAttribute('aria-pressed', 'false')
  expect(posts(global.fetch)).toEqual([]) // selecting never adds
})

test('nothing is selected when every result is already in the library (D9)', async () => {
  stub({ lookup: [RESULTS[0]] }); mount()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
  await screen.findByRole('button', { name: 'Select Library Result' })
  expect(screen.queryByRole('button', { name: 'Quality Profile' })).toBeNull()
  expect(screen.queryByText('Quality Profile')).toBeNull()
  expect(addButton('show')).toBeDisabled()
})

test('selected result details: meta line with three genres, overview clamped to 3 lines in the CSS (criterion 5)', async () => {
  stub(); mount(); await search()
  expect(document.querySelector('.selected-title')).toHaveTextContent('Result One')
  expect(document.querySelector('.selected-meta')).toHaveTextContent('2024 · Net One · Drama, Crime, Thriller')
  expect(document.querySelector('.selected-overview')).toHaveTextContent('One overview.')
  fireEvent.click(screen.getByRole('button', { name: 'Select Result Two' }))
  expect(document.querySelector('.selected-meta')).toBeNull() // no year, network or genres
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/components/AddMediaModal.css'), 'utf8')
  expect(/\.selected-overview\s*\{[^}]*-webkit-line-clamp:\s*3/.test(css)).toBe(true)
  expect(/\.result-tile\.selected\s*\{[^}]*(outline|box-shadow)/.test(css)).toBe(true)
  expect(/\.result-tile\.selected\s*\{[^}]*border/.test(css)).toBe(false)
})

test('movies use the studio in the meta line', async () => {
  stub(); mount({ type: 'movie', library: [] }); await search()
  expect(document.querySelector('.selected-meta')).toHaveTextContent('2024 · Studio One · Drama, Crime, Thriller')
  expect(addButton('movie')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Add Movie' })).toBeInTheDocument()
})

test('closed Quality Profile picker: name, tier, Default tag and "Used by" text that follows the pick (criterion 6)', async () => {
  stub(); await ready()
  expect(qualityButton()).toHaveTextContent('Beta Mixed')
  expect(qualityButton()).toHaveTextContent('SD to 4K')
  expect(qualityButton()).toHaveTextContent('Default')
  expect(screen.getByText('Used by 2 of your 3 shows')).toBeInTheDocument()
  expect(qualityButton()).toHaveAccessibleDescription('Used by 2 of your 3 shows')
  const listbox = await open(qualityButton())
  fireEvent.click(within(listbox).getByRole('option', { name: /Gamma Unknown/ }))
  expect(qualityButton()).toHaveTextContent('Gamma Unknown')
  expect(qualityButton()).not.toHaveTextContent('Default') // not the library default
  expect(qualityButton()).not.toHaveTextContent('HD ·') // no tier: name only
  expect(screen.getByText('Used by 1 of your 3 shows')).toBeInTheDocument()
})

test('helper text uses the movie noun, singular for one, hidden for an empty library (criterion 6, D4)', async () => {
  stub(); mount({ type: 'movie', library: [{ id: 1, qualityProfileId: 1, path: '/media/a/x' }] }); await search()
  await screen.findByText('Used by 1 of your 1 movie')
  expect(qualityButton()).toHaveTextContent('Alpha HD')
})
test('an empty library hides the helper and tags the first profile as the default (D4, D5)', async () => {
  stub(); mount({ library: [] }); await search()
  await waitFor(() => expect(qualityButton()).toHaveTextContent('Alpha HD'))
  expect(qualityButton()).toHaveTextContent('Default')
  expect(document.querySelector('.picker-helper')).toBeNull()
})

test('the open list: listbox with one option per profile, name, tier, check and Default tag (criterion 7)', async () => {
  stub(); await ready()
  const listbox = await open(qualityButton())
  const options = within(listbox).getAllByRole('option')
  expect(options).toHaveLength(3)
  expect(options[0]).toHaveTextContent('Alpha HD'); expect(options[0]).toHaveTextContent('HD · 1080p')
  expect(options[1]).toHaveTextContent('Beta Mixed'); expect(options[1]).toHaveTextContent('SD to 4K'); expect(options[1]).toHaveTextContent('Default')
  expect(options[2]).toHaveTextContent('Gamma Unknown')
  expect(options.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  expect(options[1].querySelector('svg')).not.toBeNull() // check icon
  expect(options[0].querySelector('svg')).toBeNull()
  expect(options[0]).not.toHaveTextContent('Default')
})

for (const field of ['Quality Profile', 'Root Folder']) {
  const button = () => field === 'Quality Profile' ? qualityButton() : folderButton()
  const selectedIndex = field === 'Quality Profile' ? 1 : 1
  const count = field === 'Quality Profile' ? 3 : 2

  test(`${field}: keyboard and focus model (criterion 8)`, async () => {
    stub(); await ready()
    button().focus()
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    const listbox = await screen.findByRole('listbox', { name: field })
    expect(document.activeElement).toBe(listbox)
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    const ids = within(listbox).getAllByRole('option').map(o => o.id)
    expect(new Set(ids).size).toBe(count)
    const active = () => listbox.getAttribute('aria-activedescendant')
    expect(active()).toBe(ids[selectedIndex])
    expect(document.getElementById(active())).not.toBeNull()
    // Accessible names: the button holds the label and the value, the listbox is named by the label alone.
    expect(button()).toHaveAccessibleName(new RegExp(`^${field}`))
    expect(listbox).toHaveAccessibleName(field)
    // Moves, no wrap, Home/End, and scrolling the active option into view.
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(active()).toBe(ids[Math.min(selectedIndex + 1, count - 1)])
    fireEvent.keyDown(listbox, { key: 'ArrowDown' }); fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(active()).toBe(ids[count - 1])
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(active()).toBe(ids[count - 2])
    fireEvent.keyDown(listbox, { key: 'Home' }); expect(active()).toBe(ids[0])
    fireEvent.keyDown(listbox, { key: 'ArrowUp' }); expect(active()).toBe(ids[0])
    fireEvent.keyDown(listbox, { key: 'End' }); expect(active()).toBe(ids[count - 1])
    expect(scrollSpy).toHaveBeenCalled()
    expect(scrollSpy.mock.contexts.at(-1)).toBe(document.getElementById(ids[count - 1]))
    expect(scrollSpy.mock.calls.at(-1)[0]).toEqual({ block: 'nearest' })
    // Enter picks the active option, closes and returns focus to the button.
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(button()).toHaveAttribute('aria-expanded', 'false')
    // Space does the same, and aria-selected moves.
    fireEvent.keyDown(button(), { key: 'ArrowUp' })
    const again = await screen.findByRole('listbox')
    expect(document.getElementById(again.getAttribute('aria-activedescendant'))).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(again, { key: 'Home' })
    fireEvent.keyDown(again, { key: ' ' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(button())
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    const third = await screen.findByRole('listbox')
    expect(within(third).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  test(`${field}: Escape closes only the list, Tab moves on, an outside press closes (criterion 8)`, async () => {
    stub(); await ready()
    const before = button().textContent
    let listbox = await open(button())
    fireEvent.keyDown(listbox, { key: 'End' })
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.querySelector('dialog')).toHaveAttribute('open')
    expect(document.activeElement).toBe(button())
    expect(button().textContent).toBe(before)
    expect(onClose).not.toHaveBeenCalled()

    listbox = await open(button())
    fireEvent.keyDown(listbox, { key: 'Home' })
    fireEvent.keyDown(listbox, { key: 'Tab' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(button().textContent).toBe(before)

    await open(button())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(button().textContent).toBe(before)
    // A press inside the field does not count as outside, and a click on an option picks it.
    const list = await open(button())
    fireEvent.pointerDown(list)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(within(list).getAllByRole('option')[0])
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(button().textContent).not.toBe(before)
  })
}

test('Root Folder defaults to the most used folder and shows its free space (criterion 9)', async () => {
  stub(); await ready()
  expect(folderButton()).toHaveTextContent('/media/b')
  expect(folderButton()).toHaveTextContent('2.1 TB free')
  expect(folderButton().querySelector('svg')).not.toBeNull() // folder icon
  const listbox = await open(folderButton())
  const options = within(listbox).getAllByRole('option')
  expect(options[0]).toHaveTextContent('850 GB free')
  expect(options[1]).toHaveAttribute('aria-selected', 'true')
  expect(options[1]).not.toHaveTextContent('Default')
})

test('Add Show posts the picked profile and folder (criterion 10)', async () => {
  const fetchMock = stub(); await ready()
  fireEvent.click(within(await open(qualityButton())).getByRole('option', { name: /Alpha HD/ }))
  fireEvent.click(within(await open(folderButton())).getByRole('option', { name: /\/media\/a/ }))
  fireEvent.click(screen.getByRole('switch', { name: 'Monitored' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Search for missing episodes after add' }))
  fireEvent.click(addButton('show'))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const [post] = posts(fetchMock)
  expect(post.url).toBe('/api/sonarr/series')
  expect(post.body).toMatchObject({ title: 'Result One', qualityProfileId: 1, rootFolderPath: '/media/a', monitored: false, seasonFolder: true, addOptions: { searchForMissingEpisodes: false, monitor: 'all' } })
  expect('id' in post.body).toBe(false)
  expect(onToast).toHaveBeenCalledWith('"Result One" added to Sonarr!', 'success')
  expect(onAdded).toHaveBeenCalled()
})
test('Add Movie posts the defaults when nothing is overridden, and switching results keeps the picks (criterion 10, D9)', async () => {
  const fetchMock = stub(); await ready.call(null, { type: 'movie', library: [{ id: 1, qualityProfileId: 2, rootFolderPath: '/media/b' }] })
  fireEvent.click(within(await open(qualityButton())).getByRole('option', { name: /Gamma Unknown/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Select Result Two' }))
  expect(qualityButton()).toHaveTextContent('Gamma Unknown')
  fireEvent.click(addButton('movie'))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const [post] = posts(fetchMock)
  expect(post.url).toBe('/api/radarr/movie')
  expect(post.body).toMatchObject({ title: 'Result Two', qualityProfileId: 3, rootFolderPath: '/media/b', monitored: true, addOptions: { searchForMovie: true } })
  expect(post.body.seasonFolder).toBeUndefined()
})
test('with nothing overridden the body carries the defaults of criteria 2 and 3', async () => {
  const fetchMock = stub(); await ready()
  fireEvent.click(addButton('show'))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(posts(fetchMock)[0].body).toMatchObject({ qualityProfileId: 2, rootFolderPath: '/media/b' })
})

test('Add is disabled until a result is selected and the lists are known; Cancel closes (criterion 11)', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  stubFetch({
    '/api/sonarr/qualityprofiles': async () => { await gate; return reply(PROFILES) },
    '/api/sonarr/rootfolders': () => reply(FOLDERS), '/api/sonarr/lookup': () => reply(RESULTS),
  })
  mount()
  expect(addButton('show')).toBeDisabled()
  await search()
  expect(qualityButton()).toHaveTextContent('Loading…')
  expect(folderButton()).toHaveTextContent('Loading…')
  expect(addButton('show')).toBeDisabled()
  await act(async () => { release() })
  await waitFor(() => expect(addButton('show')).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).toHaveBeenCalled()
})
test('a server error shows in the footer alert and the sheet stays open (criterion 11)', async () => {
  stub({ post: () => reply({ error: 'Series already exists' }) }); await ready()
  fireEvent.click(addButton('show'))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Series already exists')
  expect(alert.closest('.add-footer')).not.toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  expect(onToast).not.toHaveBeenCalled()
  expect(addButton('show')).toBeEnabled()
})

test('library handling: a prop means no library request; without one exactly one; a failure falls back (criterion 12)', async () => {
  let fetchMock = stub(); mount(); await search(); await waitFor(() => expect(qualityButton()).toHaveTextContent('Beta Mixed'))
  expect(libraryFetches(fetchMock)).toHaveLength(0)
  cleanup()
  fetchMock = stub(); mount({ library: undefined }); await search()
  await waitFor(() => expect(qualityButton()).toHaveTextContent('Beta Mixed'))
  expect(libraryFetches(fetchMock)).toHaveLength(1)
  expect(libraryFetches(fetchMock)[0].url).toBe('/api/sonarr/series')
  cleanup()
  fetchMock = stub(); mount({ type: 'movie', library: null }); await search()
  await waitFor(() => expect(qualityButton()).toHaveTextContent('Beta Mixed'))
  expect(libraryFetches(fetchMock).map(c => c.url)).toEqual(['/api/radarr/movies'])
  cleanup()
  stub({ libraryFails: true }); mount({ library: undefined }); await search()
  await waitFor(() => expect(qualityButton()).toHaveTextContent('Alpha HD'))
  expect(qualityButton()).not.toHaveTextContent('Default')
  expect(document.querySelector('.picker-helper')).toBeNull()
  expect(addButton('show')).toBeEnabled()
})

test('lookup is debounced by 350 ms, limited to 12 results and an empty query clears it (criterion 13)', async () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ title: `Many ${i}`, tvdbId: 100 + i, tmdbId: 100 + i, year: 2000 + i }))
  const fetchMock = stub({ lookup: many }); mount()
  const lookups = () => fetchMock.calls.filter(c => c.url.startsWith('/api/sonarr/lookup'))
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'm' } })
  fireEvent.change(input, { target: { value: 'ma' } })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(lookups()).toHaveLength(0)
  await screen.findByRole('button', { name: 'Select Many 0' })
  expect(lookups()).toHaveLength(1)
  expect(lookups()[0].url).toBe('/api/sonarr/lookup?term=ma')
  expect(screen.getAllByRole('button', { name: /^Select Many/ })).toHaveLength(12)
  fireEvent.change(input, { target: { value: '' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Select Many/ })).toBeNull())
  expect(document.querySelector('.modal-config')).toBeNull()
})

test('the search field is the active element after mount, also under StrictMode (criterion 22, supplement)', () => {
  stub(); mount({ strict: true })
  expect(document.activeElement).toBe(screen.getByRole('textbox'))
})
test('the sheet markup: grabber is one decorative element, switches are labelled, footer sits outside the scroll area (D11, D16)', async () => {
  stub(); await ready()
  const grabber = document.querySelectorAll('.add-grabber')
  expect(grabber).toHaveLength(1)
  expect(grabber[0]).toHaveAttribute('aria-hidden', 'true')
  expect(grabber[0].parentElement).toHaveClass('modal-panel')
  expect(grabber[0].parentElement.firstElementChild).toBe(grabber[0])
  expect(screen.getAllByRole('switch')).toHaveLength(2)
  expect(screen.getByRole('switch', { name: 'Monitored' })).toBeChecked()
  expect(document.querySelector('.sheet-content').contains(document.querySelector('.add-footer'))).toBe(false)
  expect(document.querySelector('dialog').lastElementChild).toHaveClass('add-footer')
})
