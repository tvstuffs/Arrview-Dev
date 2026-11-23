import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import { config, stubFetch, stubMedia, resetEnvironment, future, series } from './modern-helpers'

// Spec criterion 32c: data-m-anchor on exactly the anchor families, with stable keys (never an index); none elsewhere.
let restoreMedia
beforeEach(() => { resetEnvironment(); restoreMedia = stubMedia({ phone: false }); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const anchors = container => [...container.querySelectorAll('[data-m-anchor]')]
const keys = container => anchors(container).map(el => el.getAttribute('data-m-anchor'))
const calendar = [1, 2, 3].map(i => ({ id: 500 + i, seriesId: series[0].id, seasonNumber: 1, episodeNumber: i, title: `Upcoming ${i}`, airDateUtc: future(i), hasFile: false, series: series[0] }))
const slot = (id, pct = 40) => ({ nzo_id: id, filename: `Fixture.Release.${id}-GRP`, status: 'Downloading', percentage: String(pct), mb: '1000', mbleft: '600', timeleft: '0:01:00', cat: 'software' })
const historySlot = id => ({ nzo_id: id, name: `Fixture.History.${id}-GRP`, bytes: 1048576, status: 'Completed', completed: Math.floor(Date.now() / 1000) - 60, category: 'software' })

async function at(hash, { view, data = {} } = {}) {
  if (view) for (const [key, value] of Object.entries(view)) localStorage.setItem(`arrview.ui.v1.${key}`, JSON.stringify(value))
  stubFetch({}, data)
  window.location.hash = hash
  return render(<Dashboard config={config} onConfigSaved={() => {}} />)
}

test('show tiles and show rows carry show:<id>', async () => {
  const { container, unmount } = await at('#/shows')
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(keys(container)).toEqual(['show:1', 'show:2', 'show:3'])
  for (const el of anchors(container)) expect(el.tagName).toBe('LI')
  expect(anchors(container)).toHaveLength(container.querySelectorAll('.m-grid > li').length)
  unmount()
  const list = await at('#/shows', { view: { 'shows.view': 'list' } })
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  expect(keys(list.container)).toEqual(['show:1', 'show:2', 'show:3'])
  expect(anchors(list.container)).toHaveLength(list.container.querySelectorAll('.m-list > li').length)
})
test('movie tiles and movie rows carry movie:<id>; the movie page carries none', async () => {
  const { container, unmount } = await at('#/movies')
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  expect(keys(container).sort()).toEqual(['movie:11', 'movie:12', 'movie:13', 'movie:14'])
  unmount()
  const list = await at('#/movies', { view: { 'movies.view': 'small' } })
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  expect(keys(list.container)).toHaveLength(4)
  list.unmount()
  const rows = await at('#/movies', { view: { 'movies.view': 'list' } })
  await screen.findByRole('heading', { level: 1, name: 'Movies' })
  for (const key of keys(rows.container)) expect(key).toMatch(/^movie:\d+$/)
  expect(keys(rows.container)).toHaveLength(rows.container.querySelectorAll('.m-list > li').length)
  rows.unmount()
  const detail = await at('#/movies/11')
  await screen.findByRole('heading', { level: 1, name: 'Movie One' })
  expect(keys(detail.container)).toEqual([])
})
test('Upcoming tiles and rows carry upcoming:<entry key>', async () => {
  const { container, unmount } = await at('#/upcoming', { data: { calendar } })
  await screen.findByRole('heading', { level: 1, name: 'Upcoming' })
  await screen.findAllByText(/Alpha Show/)
  const tiles = keys(container)
  expect(tiles.length).toBe(container.querySelectorAll('.m-agenda-tiles > li').length)
  expect(tiles.length).toBeGreaterThan(0)
  for (const key of tiles) expect(key).toMatch(/^upcoming:\S+/)
  expect(new Set(tiles).size).toBe(tiles.length)
  unmount()
  const list = await at('#/upcoming', { data: { calendar }, view: { 'upcoming.view': 'list' } })
  await screen.findAllByText(/Alpha Show/)
  expect(keys(list.container)).toEqual(tiles)
})
test('episode rows carry episode:<id>', async () => {
  const { container } = await at('#/shows/1')
  await screen.findByRole('heading', { level: 1, name: 'Alpha Show' })
  await screen.findByText('Return')
  expect(keys(container)).toEqual(['episode:203', 'episode:202', 'episode:201'])
  for (const el of anchors(container)) expect(el).toHaveClass('m-ep')
})
test('Downloads queue and history rows carry dl-queue:<key> and dl-history:<key>; the hero carries none', async () => {
  const { container } = await at('#/downloads', { data: {
    queue: { queue: { status: 'Downloading', kbpersec: '100', timeleft: '0:02:00', noofslots: 3, slots: [slot('q1', 70), slot('q2'), slot('q3')] } },
    history: { history: { noofslots: 2, slots: [historySlot('h1'), historySlot('h2')] } },
  } })
  await screen.findByText('Recent History')
  expect(keys(container)).toEqual(['dl-queue:q2', 'dl-queue:q3', 'dl-history:h1', 'dl-history:h2'])
  expect(container.querySelector('.m-dl-hero [data-m-anchor], .m-dl-hero[data-m-anchor]')).toBeNull()
})
test('Search and Settings carry no anchors', async () => {
  const search = await at('#/search')
  await screen.findByRole('heading', { level: 1, name: 'Search' })
  expect(keys(search.container)).toEqual([])
  search.unmount()
  const settings = await at('#/settings')
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  expect(keys(settings.container)).toEqual([])
})
