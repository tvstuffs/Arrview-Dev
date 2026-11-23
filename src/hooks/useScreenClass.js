import { useSyncExternalStore } from 'react'
import { SCREEN, classifyScreen, readInsets, readLargeHeight } from '../screenClass.js'

// One store for the screen class, shared by every subscriber. It re-measures on resize, a visualViewport resize, an
// orientation change, the width/height/pointer media queries changing, and a resize of the hidden probe (whose height is
// 100lvh and whose padding is the four --sa-* insets, so an inset change alone is seen too). It never reloads.
// The height class is also written to <html data-screen-height> so CSS and shared components (sheets) in both layouts
// can follow it. The keyboard only shrinks the visual viewport, so it never changes the class.
const QUERIES = ['(pointer: coarse)', `(max-width: ${SCREEN.compactBelow - 1}px)`, `(max-height: ${SCREEN.shortBelow - 1}px)`]
const listeners = new Set()
let current = null
let probe = null
let detach = null

function ensureProbe() {
  if (probe && probe.isConnected) return probe
  probe = document.createElement('div')
  probe.className = 'screen-probe'
  probe.setAttribute('aria-hidden', 'true')
  // Off-screen (a fixed element touching an edge can tint the browser's own bars); content-box so height is 100lvh exactly.
  probe.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:100vh;height:100lvh;box-sizing:content-box;'
    + 'padding:var(--sa-top) var(--sa-right) var(--sa-bottom) var(--sa-left);visibility:hidden;pointer-events:none;'
  document.body.append(probe)
  return probe
}

const coarsePointer = () => typeof window.matchMedia === 'function' && window.matchMedia(QUERIES[0]).matches === true

export function measureScreen() {
  const el = ensureProbe()
  const insets = readInsets(el)
  const height = readLargeHeight(el, window.innerHeight)
  return { ...classifyScreen({ width: window.innerWidth, height, insets, coarse: coarsePointer() }), insets, viewport: { width: window.innerWidth, height } }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function refresh() {
  const next = measureScreen()
  const changed = !current || !same(next, current)
  if (changed) current = next
  document.documentElement.dataset.screenHeight = current.height
  return changed
}
function update() { if (refresh()) for (const listener of [...listeners]) listener() }

function attach() {
  const offs = []
  const on = (target, type) => { target.addEventListener(type, update); offs.push(() => target.removeEventListener(type, update)) }
  on(window, 'resize'); on(window, 'orientationchange')
  if (window.visualViewport) on(window.visualViewport, 'resize')
  if (typeof window.matchMedia === 'function') for (const query of QUERIES) {
    const list = window.matchMedia(query)
    if (list && typeof list.addEventListener === 'function') on(list, 'change')
  }
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(update)
    observer.observe(ensureProbe(), { box: 'border-box' })
    offs.push(() => observer.disconnect())
  }
  return () => offs.forEach(off => off())
}

export function subscribeScreen(listener) {
  listeners.add(listener)
  if (!detach) { detach = attach(); update() }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && detach) { detach(); detach = null }
  }
}
export function screenSnapshot() {
  if (!detach || !current) refresh()
  return current
}

// Keeps <html data-screen-height> current for the whole app (both layouts), from startup.
export function watchScreen() { return subscribeScreen(() => {}) }

export function useScreenClass() {
  return useSyncExternalStore(subscribeScreen, screenSnapshot, screenSnapshot)
}
