import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import ConfigPage from '../../src/components/ConfigPage'
import PageHeader, { OpenServiceLink } from '../../src/components/modern/PageHeader'
import { ScreenContext, REGULAR_SCREEN } from '../../src/components/modern/ScreenContext'
import { serviceHref } from '../../src/serviceLinks'
import { config, movies, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

// The apps behind ArrView open from Modern as Classic's status pills open them: each page links to the app it shows, the movie
// page to the movie in Radarr (as the show page already did for Sonarr), and Settings to every saved service. Every link opens
// the address saved in Settings, in a new tab.

let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const go = hash => { window.location.hash = hash }
const view = (cfg = config) => render(<Dashboard config={cfg} onConfigSaved={() => {}} />)
const newTab = link => { expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer') }

test('serviceHref: the saved address of a set-up service, http(s) only, without login details or a doubled slash', () => {
  expect(serviceHref(config, 'sonarr')).toBe('http://sonarr.invalid')
  expect(serviceHref({ sonarr: { url: 'http://nas.invalid:8989/', apikey: 'k' } }, 'sonarr')).toBe('http://nas.invalid:8989')
  expect(serviceHref({ sonarr: { url: 'https://nas.invalid/sonarr/', apikey: 'k' } }, 'sonarr', 'series/alpha-show')).toBe('https://nas.invalid/sonarr/series/alpha-show')
  expect(serviceHref({ radarr: { url: ' http://nas.invalid:7878 ', apikey: 'k' } }, 'radarr', '/movie/the-film-603')).toBe('http://nas.invalid:7878/movie/the-film-603')
  expect(serviceHref({ sabnzbd: { url: 'http://user:secret@nas.invalid:8080', apikey: 'k' } }, 'sabnzbd')).toBe('http://nas.invalid:8080')
  for (const saved of [undefined, {}, { url: 'http://nas.invalid:8989' }, { apikey: 'k' }, { url: 'ftp://nas.invalid', apikey: 'k' },
    { url: 'javascript:alert(1)', apikey: 'k' }, { url: 'not an address', apikey: 'k' }]) {
    expect(serviceHref({ sonarr: saved }, 'sonarr'), JSON.stringify(saved)).toBeNull()
  }
})

test('each Modern page links to the app behind it, in a new tab: TV Shows, Movies, Downloads and Search', async () => {
  stubFetch()
  go('#/shows'); view()
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const sonarr = screen.getByRole('link', { name: 'Open Sonarr' })
  expect(sonarr).toHaveAttribute('href', 'http://sonarr.invalid'); expect(sonarr).toHaveAttribute('title', 'Open Sonarr'); newTab(sonarr)
  go('#/movies'); await screen.findByRole('heading', { level: 1, name: 'Movies' })
  const radarr = screen.getByRole('link', { name: 'Open Radarr' })
  expect(radarr).toHaveAttribute('href', 'http://radarr.invalid'); newTab(radarr)
  expect(screen.queryByRole('link', { name: 'Open Sonarr' })).toBeNull()
  go('#/downloads'); await screen.findByRole('heading', { level: 1, name: 'Downloads' })
  const sab = await screen.findByRole('link', { name: 'Open SABnzbd' })
  expect(sab).toHaveAttribute('href', 'http://sab.invalid'); newTab(sab)
  go('#/search'); await screen.findByRole('heading', { level: 1, name: 'Search' })
  const hydra = screen.getByRole('link', { name: 'Open NZBHydra' })
  expect(hydra).toHaveAttribute('href', 'http://hydra.invalid'); newTab(hydra)
})

test('on a phone the page link sits before Add and the gear', async () => {
  restoreMedia(); restoreMedia = stubMedia({ phone: true }); stubFetch()
  go('#/shows'); view()
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const actions = screen.getByRole('link', { name: 'Open Sonarr' }).closest('.m-pageheader-actions')
  expect([...actions.querySelectorAll('a, button')].map(el => el.getAttribute('aria-label'))).toEqual(['Open Sonarr', 'Add Show', 'Settings'])
})

test('a condensed (short) header puts the link at the start of its sideways-scrolling toolbar row; without a toolbar, in the title row', () => {
  const short = { ...REGULAR_SCREEN, width: 'compact', height: 'short', nav: 'bottom-compact' }
  const header = props => <ScreenContext.Provider value={short}>
    <PageHeader title="TV Shows" phone addLabel="Add Show" onAdd={() => {}} gear open={<OpenServiceLink config={config} service="sonarr" />} {...props} />
  </ScreenContext.Provider>
  const { container, rerender } = render(header({ search: <input aria-label="Search shows" /> }))
  const toolbar = container.querySelector('.m-toolbar')
  expect(toolbar.firstElementChild).toBe(screen.getByRole('link', { name: 'Open Sonarr' }))
  expect(container.querySelector('.m-titlerow').querySelector('a[target="_blank"]')).toBeNull()
  rerender(header({}))
  expect(container.querySelector('.m-toolbar')).toBeNull()
  expect(container.querySelector('.m-titlerow .m-pageheader-actions').firstElementChild).toBe(screen.getByRole('link', { name: 'Open Sonarr' }))
})

test('no link for an address that is not http(s); Upcoming, with two apps behind it, has none', async () => {
  stubFetch()
  go('#/shows'); view({ ...config, sonarr: { url: 'ftp://sonarr.invalid', apikey: 'k' } })
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(screen.queryByRole('link', { name: 'Open Sonarr' })).toBeNull()
  go('#/upcoming'); await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
})

test('the movie page opens the movie in Radarr; a movie without a slug has no link', async () => {
  stubFetch({}, { movies: movies.map(m => (m.id === 11 ? { ...m, titleSlug: 'movie-one-11' } : m)) })
  go('#/movies/11'); view()
  await screen.findByRole('heading', { level: 1, name: 'Movie One' })
  const link = screen.getByRole('link', { name: 'Open in Radarr' })
  expect(link).toHaveAttribute('href', 'http://radarr.invalid/movie/movie-one-11'); expect(link).toHaveAttribute('title', 'Open in Radarr'); newTab(link)
  go('#/movies/12'); await screen.findByRole('heading', { level: 1, name: 'Movie Two' })
  expect(screen.queryByRole('link', { name: 'Open in Radarr' })).toBeNull()
})

test('Settings: a saved service opens at its saved address from its panel; a service not saved has no link', async () => {
  stubFetch()
  render(<ConfigPage initialConfig={{ sonarr: { url: 'http://sonarr.example.invalid:8989', apikey: '••••abcd' }, envManaged: {} }} onSave={() => {}} />)
  expect(screen.queryByRole('link', { name: 'Open Sonarr' })).toBeNull() // the saved row starts closed
  fireEvent.click(screen.getByRole('button', { name: 'Sonarr' }))
  const link = screen.getByRole('link', { name: 'Open Sonarr' })
  expect(link).toHaveAttribute('href', 'http://sonarr.example.invalid:8989'); newTab(link)
  fireEvent.change(screen.getByLabelText('Server URL', { selector: '#sonarr-url' }), { target: { value: 'http://elsewhere.invalid:8989' } })
  expect(screen.getByRole('link', { name: 'Open Sonarr' })).toHaveAttribute('href', 'http://sonarr.example.invalid:8989')
  expect(screen.queryByRole('link', { name: 'Open Radarr' })).toBeNull()
})
