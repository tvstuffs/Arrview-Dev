import { test, expect, vi, afterEach } from 'vitest'
import { anchorsInView, firstVisibleAnchor, restoreAnchor, createScrollAnchor, chromeBounds } from '../../src/scrollAnchor.js'

// Spec criteria 32 and 36: the key of the first fully visible [data-m-anchor] (by rects), restored after a screen-class change.
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

function page(items) {
  const main = document.createElement('main')
  main.className = 'm-main'
  for (const { key, top, left = 0, height = 100, width = 100 } of items) {
    const el = document.createElement('li')
    el.setAttribute('data-m-anchor', key)
    el.getBoundingClientRect = () => ({ top, left, bottom: top + height, right: left + width, width, height })
    main.append(el)
  }
  document.body.append(main)
  return main
}

test('the first fully visible anchor is chosen by its rect (top, then left), not by DOM order or index', () => {
  const main = page([
    { key: 'show:1', top: -50 }, // cut off at the top
    { key: 'show:3', top: 60, left: 200 },
    { key: 'show:2', top: 60, left: 0 },
    { key: 'show:4', top: 700 }, // below the bottom
  ])
  expect(anchorsInView(main, { top: 0, bottom: 678 }).map(el => el.getAttribute('data-m-anchor'))).toEqual(['show:2', 'show:3'])
  expect(firstVisibleAnchor(main, { top: 0, bottom: 678 })).toBe('show:2')
  // Fixed chrome above: an item under the top bar is not fully visible.
  expect(firstVisibleAnchor(main, { top: 80, bottom: 678 })).toBe(null)
  expect(firstVisibleAnchor(page([]), { top: 0, bottom: 678 })).toBe(null)
})

test('restore scrolls the element with the key to just below the chrome; no anchor, no scroll', () => {
  const main = page([{ key: 'episode:7', top: 900 }, { key: 'episode:8', top: 1000 }])
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 })
  expect(restoreAnchor(main, 'episode:8', { top: 56 })).toBe(true)
  expect(window.scrollTo).toHaveBeenCalledWith(0, 300 + 1000 - 56)
  window.scrollTo.mockClear()
  expect(restoreAnchor(main, 'episode:99', { top: 0 })).toBe(false)
  expect(restoreAnchor(main, null, { top: 0 })).toBe(false)
  expect(window.scrollTo).not.toHaveBeenCalled()
})

test('chromeBounds: the bottom of a top bar and the top of a bottom bar', () => {
  const bar = document.createElement('header'); bar.className = 'm-topbar'
  bar.getBoundingClientRect = () => ({ top: 0, bottom: 90, left: 0, right: 400, height: 90, width: 400 })
  const bottom = document.createElement('nav'); bottom.className = 'm-bottomnav'
  bottom.getBoundingClientRect = () => ({ top: 610, bottom: 678, left: 0, right: 400, height: 68, width: 400 })
  document.body.append(bar, bottom)
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 678 })
  expect(chromeBounds()).toEqual({ top: 90, bottom: 610 })
  bar.remove(); bottom.remove()
  expect(chromeBounds()).toEqual({ top: 0, bottom: 678 })
})

test('the tracker keeps the key up to date while scrolling, holds it through a resize, and restores it', () => {
  const main = page([{ key: 'movie:1', top: 0 }, { key: 'movie:2', top: 120 }])
  window.scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  let now = 1000
  const tracker = createScrollAnchor({ root: () => main, now: () => now, schedule: fn => fn() })
  tracker.start()
  expect(tracker.current()).toBe('movie:1')
  main.children[0].getBoundingClientRect = () => ({ top: -80, bottom: 20, left: 0, right: 100, height: 100, width: 100 })
  window.dispatchEvent(new Event('scroll'))
  expect(tracker.current()).toBe('movie:2')
  // A resize reflows the page; scroll events right after it must not replace the key.
  window.dispatchEvent(new Event('resize'))
  main.children[1].getBoundingClientRect = () => ({ top: 900, bottom: 1000, left: 0, right: 100, height: 100, width: 100 })
  main.children[0].getBoundingClientRect = () => ({ top: 10, bottom: 110, left: 0, right: 100, height: 100, width: 100 })
  now += 50
  window.dispatchEvent(new Event('scroll'))
  expect(tracker.current()).toBe('movie:2')
  expect(tracker.restore()).toBe(true)
  expect(window.scrollTo).toHaveBeenCalledWith(0, 900)
  now += 2000
  window.dispatchEvent(new Event('scroll'))
  expect(tracker.current()).toBe('movie:1')
  tracker.stop()
  main.children[0].getBoundingClientRect = () => ({ top: -500, bottom: -400, left: 0, right: 100, height: 100, width: 100 })
  window.dispatchEvent(new Event('scroll'))
  expect(tracker.current()).toBe('movie:1')
})
