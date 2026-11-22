import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import Dashboard from '../../src/components/Dashboard'
import { useScreenClass } from '../../src/hooks/useScreenClass.js'
import { config, stubFetch, resetEnvironment } from './modern-helpers'

// Spec criteria 6 and 36; note 1 item 1 (the large viewport height from a 100lvh probe; <html data-screen-height>).
const state = { width: 1280, height: 900, large: null, insets: {}, coarse: false }
const queries = new Map()
let realStyle
function media(query) {
  if (!queries.has(query)) {
    const target = new EventTarget()
    target.media = query
    Object.defineProperty(target, 'matches', { get: () => /pointer:\s*coarse/.test(query) ? state.coarse : /max-width:\s*639px/.test(query) ? state.width < 640 : /hover:\s*hover/.test(query) ? !state.coarse : false })
    target.addListener = fn => target.addEventListener('change', fn)
    target.removeListener = fn => target.removeEventListener('change', fn)
    queries.set(query, target)
  }
  return queries.get(query)
}
function size(next) {
  Object.assign(state, { large: null, insets: {}, ...next })
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: state.width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: state.height })
}
const px = v => `${v || 0}px`
beforeEach(() => {
  resetEnvironment(); stubFetch(); window.scrollTo = vi.fn()
  queries.clear()
  window.matchMedia = media
  globalThis.CSS = { supports: () => true }
  realStyle = window.getComputedStyle
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => el && el.classList && el.classList.contains('screen-probe')
    ? { height: px(state.large ?? state.height), paddingTop: px(state.insets.top), paddingRight: px(state.insets.right), paddingBottom: px(state.insets.bottom), paddingLeft: px(state.insets.left) }
    : realStyle(el, pseudo))
  size({ width: 1280, height: 900 })
  delete window.visualViewport
  delete document.documentElement.dataset.screenHeight
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.visualViewport })

function Probe() {
  const sc = useScreenClass()
  return <output data-testid="sc">{JSON.stringify({ width: sc.width, height: sc.height, nav: sc.nav, railSide: sc.railSide, insets: sc.insets })}</output>
}
const read = () => JSON.parse(screen.getByTestId('sc').textContent)

test('useScreenClass returns width, height, nav and insets, and re-evaluates on resize (criterion 6)', async () => {
  render(<Probe />)
  expect(read()).toMatchObject({ width: 'regular', height: 'regular', nav: 'top', insets: { top: 0, right: 0, bottom: 0, left: 0 } })
  act(() => { size({ width: 461, height: 678, insets: { right: 84, bottom: 34 }, coarse: true }); window.dispatchEvent(new Event('resize')) })
  expect(read()).toMatchObject({ width: 'compact', height: 'short', nav: 'rail', railSide: 'right', insets: { top: 0, right: 84, bottom: 34, left: 0 } })
  expect(document.documentElement.dataset.screenHeight).toBe('short')
})
test('it re-evaluates on a visualViewport resize, an orientation change and a pointer media change', () => {
  const vv = new EventTarget(); vv.height = 900; vv.width = 1280; vv.offsetTop = 0
  window.visualViewport = vv
  render(<Probe />)
  act(() => { size({ width: 951, height: 669, insets: { right: 84 } }); vv.dispatchEvent(new Event('resize')) })
  expect(read()).toMatchObject({ nav: 'rail', railSide: 'right' })
  act(() => { size({ width: 1280, height: 600 }); window.dispatchEvent(new Event('orientationchange')) })
  expect(read()).toMatchObject({ height: 'short', nav: 'top' })
  act(() => { state.coarse = true; media('(pointer: coarse)').dispatchEvent(new Event('change')) })
  expect(read()).toMatchObject({ nav: 'rail', railSide: 'left' })
})
test('the large viewport height decides: 714/752 regular, 580/618 short, 678/678 short, 819/902 regular (note 1 item 1)', () => {
  render(<Probe />)
  for (const [inner, large, expected] of [[714, 752, 'regular'], [580, 618, 'short'], [678, 678, 'short'], [819, 902, 'regular']]) {
    act(() => { size({ width: 402, height: inner, large }); window.dispatchEvent(new Event('resize')) })
    expect(read().height, `${inner} / ${large}`).toBe(expected)
    expect(document.documentElement.dataset.screenHeight).toBe(expected)
  }
  // The keyboard only shrinks the visual viewport: the class stays.
  const vv = new EventTarget(); vv.height = 311; vv.width = 377; vv.offsetTop = 0
  window.visualViewport = vv
  act(() => { size({ width: 377, height: 580, large: 618 }); window.dispatchEvent(new Event('resize')) })
  act(() => { vv.dispatchEvent(new Event('resize')) })
  expect(read()).toMatchObject({ height: 'short', nav: 'bottom-compact' })
})
test('without lvh support the hook falls back to innerHeight', () => {
  globalThis.CSS = { supports: () => false }
  size({ width: 402, height: 714, large: 752 })
  render(<Probe />)
  expect(read().height).toBe('regular') // 714 >= 700
  act(() => { size({ width: 402, height: 690, large: 752 }); window.dispatchEvent(new Event('resize')) })
  expect(read().height).toBe('short')
})

test('ModernShell writes the screen class to .m-shell as data attributes and custom properties (criterion 6)', async () => {
  size({ width: 461, height: 678, insets: { right: 84, bottom: 34 }, coarse: true })
  window.location.hash = '#/shows'
  const { container } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const shell = container.querySelector('.m-shell')
  expect(shell.dataset).toMatchObject({ width: 'compact', height: 'short', nav: 'rail', railSide: 'right', railPlacement: 'inside', railAnchor: 'bottom', railStyle: 'ios' })
  expect(shell.dataset.railLabels).toBeUndefined()
  expect(shell.style.getPropertyValue('--m-keepout')).toBe('258px')
  expect(shell.style.getPropertyValue('--m-rail-w')).toBe('84px')
  act(() => { size({ width: 678, height: 461, insets: { left: 84 }, coarse: true }); window.dispatchEvent(new Event('resize')) })
  expect(shell.dataset).toMatchObject({ width: 'regular', nav: 'rail', railSide: 'left', railLabels: 'off' })
  expect(shell.style.getPropertyValue('--m-keepout')).toBe('141px')
  act(() => { size({ width: 1280, height: 900 }); window.dispatchEvent(new Event('resize')) })
  expect(shell.dataset).toMatchObject({ width: 'regular', height: 'regular', nav: 'top' })
  expect(shell.dataset.railSide).toBeUndefined()
})

test('changing the navigation does not remount the page: main, the page root and an open sheet survive (criterion 36)', async () => {
  window.location.hash = '#/shows'
  const { container } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  fireEvent.click(screen.getByRole('button', { name: 'Add Show' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for a show' }), { target: { value: 'kept' } })
  const main = container.querySelector('.m-main'), root = main.firstElementChild
  expect(container.querySelector('.m-topbar')).not.toBeNull()
  act(() => { size({ width: 461, height: 678, insets: { right: 84, bottom: 34 }, coarse: true }); window.dispatchEvent(new Event('resize')) })
  await waitFor(() => expect(container.querySelector('.m-shell').dataset.nav).toBe('rail'))
  expect(container.querySelector('.m-topbar')).toBeNull()
  expect(container.querySelector('.m-rail')).not.toBeNull()
  expect(container.querySelector('.m-main')).toBe(main)
  expect(main.firstElementChild).toBe(root)
  expect(screen.getByRole('dialog')).toBe(dialog)
  expect(screen.getByRole('textbox', { name: 'Search for a show' })).toHaveValue('kept')
  act(() => { size({ width: 951, height: 669, insets: { right: 84, bottom: 34 }, coarse: true }); window.dispatchEvent(new Event('resize')) })
  act(() => { size({ width: 402, height: 874 }); window.dispatchEvent(new Event('resize')) })
  await waitFor(() => expect(container.querySelector('.m-shell').dataset.nav).toBe('bottom'))
  expect(container.querySelector('.m-main')).toBe(main)
  expect(main.firstElementChild).toBe(root)
  expect(screen.getByRole('dialog')).toBe(dialog)
})

test('the rail: labelled outside a column with Settings last; ios inside one with Settings in the top pill (criteria 14, 18; note 2)', async () => {
  size({ width: 951, height: 537, insets: { bottom: 34 }, coarse: true })
  window.location.hash = '#/shows'
  const { container } = render(<Dashboard config={config} onConfigSaved={() => {}} />)
  await screen.findByRole('heading', { level: 1, name: 'TV Shows' })
  const names = () => [...screen.getByRole('navigation', { name: 'Main navigation' }).querySelectorAll('a')].map(a => a.getAttribute('aria-label'))
  expect(container.querySelector('.m-shell').dataset.railStyle).toBe('labelled')
  expect(names()).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search', 'Settings'])
  expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
  act(() => { size({ width: 951, height: 669, insets: { right: 84, bottom: 34 }, coarse: true }); window.dispatchEvent(new Event('resize')) })
  expect(container.querySelector('.m-shell').dataset.railStyle).toBe('ios')
  expect(names()).toEqual(['Downloads', 'Shows', 'Upcoming', 'Movies', 'Search'])
  for (const a of screen.getByRole('navigation', { name: 'Main navigation' }).querySelectorAll('a')) expect(a.getAttribute('title')).toBe(a.getAttribute('aria-label'))
  const top = container.querySelector('.m-rail-pill.is-top')
  expect([...top.querySelectorAll('a')].map(a => a.getAttribute('aria-label'))).toEqual(['Settings'])
  expect(screen.getAllByRole('link', { name: 'Settings' })).toHaveLength(1)
  window.location.hash = '#/shows/1'
  await screen.findByRole('heading', { level: 1, name: 'Alpha Show' })
  expect([...container.querySelector('.m-rail-pill.is-top').querySelectorAll('a')].map(a => a.getAttribute('aria-label'))).toEqual(['Back to TV Shows', 'Settings'])
  expect(container.querySelector('.m-hero-nav')).toBeNull()
  expect(screen.getAllByRole('link', { name: 'Back to TV Shows' })).toHaveLength(1)
})
