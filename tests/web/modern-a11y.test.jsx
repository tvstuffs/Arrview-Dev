import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import { config, stubFetch, stubMedia, resetEnvironment } from './modern-helpers'

const GLYPHS = /[\u{1F000}-\u{1FAFF}←-⇿⌀-⏿①-➿⤀-⯿ℹ■-◿️]/u
let restoreMedia
beforeEach(() => { resetEnvironment(); stubFetch(); window.scrollTo = vi.fn() })
afterEach(() => { restoreMedia?.(); vi.unstubAllGlobals() })

const ROUTES = [['#/downloads', 'Downloads'], ['#/shows', 'TV Shows'], ['#/shows/1', 'Alpha Show'], ['#/upcoming', 'Upcoming'], ['#/movies', 'Movies'],
  ['#/movies/12', 'Movie Two'], ['#/search', 'Search'], ['#/settings', 'Settings']]
const settle = async title => {
  await screen.findByRole('heading', { level: 1, name: title })
  await waitFor(() => expect(document.querySelector('.m-main .empty-state .spinner')).toBeNull())
}

for (const [phone, hover] of [[false, true], [true, false]]) {
  test(`every Modern control has a name, icons are decorative, artwork has empty alt (${phone ? 'phone' : 'wide'}) (criterion 32)`, async () => {
    restoreMedia = stubMedia({ phone, hover })
    for (const [hash, title] of ROUTES) {
      window.location.hash = hash
      const { unmount } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
      await settle(title)
      for (const el of document.querySelectorAll('.m-shell button, .m-shell a[href], .m-shell select, .m-shell input')) {
        expect(el, `${hash}: ${el.outerHTML.slice(0, 90)}`).toHaveAccessibleName()
        const label = el.getAttribute('aria-label') ?? el.textContent.replace(/\s+/g, ' ').trim()
        expect(label, hash).not.toMatch(GLYPHS)
      }
      for (const svg of document.querySelectorAll('.m-shell svg')) expect(svg, hash).toHaveAttribute('aria-hidden', 'true')
      for (const img of document.querySelectorAll('.m-shell img')) expect(img.getAttribute('alt'), hash).toBe('')
      const navs = [...document.querySelectorAll('.m-shell nav')].map(nav => nav.getAttribute('aria-label'))
      expect(new Set(navs).size, hash).toBe(navs.length)
      expect(navs.filter(label => label === 'Main navigation'), hash).toHaveLength(1)
      unmount()
    }
  })
}
test('icon-only Modern controls are named: nav links, gear, Add, view toggle, More, Monitored, overlay buttons, back (criterion 32)', async () => {
  restoreMedia = stubMedia({ phone: true, hover: false })
  window.location.hash = '#/shows'
  const first = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await settle('TV Shows')
  for (const name of ['Settings', 'Add Show', 'Large posters', 'Small posters', 'List']) expect(screen.getAllByRole(name === 'Settings' ? 'link' : 'button', { name }).length).toBeGreaterThan(0)
  for (const name of ['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search']) expect(screen.getByRole('link', { name })).toBeInTheDocument()
  first.unmount()
  window.location.hash = '#/shows/1'
  const second = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await settle('Alpha Show')
  for (const name of ['More actions for Alpha Show', 'Monitored: Alpha Show']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to TV Shows' })).toBeInTheDocument()
  second.unmount()
  restoreMedia(); restoreMedia = stubMedia({ phone: false, hover: true })
  window.location.hash = '#/movies'
  render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await settle('Movies')
  expect(screen.getAllByRole('button', { name: 'Interactive Search' }).length).toBe(4)
  expect(screen.getAllByRole('button', { name: /^Delete Movie/ }).length).toBe(4)
  expect(screen.getAllByRole('button', { name: /^Monitored: Movie/ }).length).toBe(4)
})
