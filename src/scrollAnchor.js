// Keeps "the item on screen" across a fold or unfold (Safari has no CSS scroll anchoring).
// Items that can anchor carry data-m-anchor="<family>:<stable id>" (never an index). The tracker remembers the key of the
// first fully visible one while the page scrolls; after the screen class changes, the shell asks it to scroll that item back
// to just below the fixed chrome. Scroll events right after a resize are ignored, because the reflow itself moves things.

// The visible content band: below a top bar, above a bottom bar.
export function chromeBounds(doc = document) {
  const top = doc.querySelector('.m-topbar'), bottom = doc.querySelector('.m-bottomnav')
  return { top: top ? Math.max(0, top.getBoundingClientRect().bottom) : 0, bottom: bottom ? bottom.getBoundingClientRect().top : window.innerHeight }
}

// Fully visible anchors, in reading order by their boxes (top, then left).
export function anchorsInView(root, bounds = chromeBounds()) {
  if (!root) return []
  return [...root.querySelectorAll('[data-m-anchor]')]
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.height > 0 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1)
    .sort((a, b) => Math.round(a.r.top) - Math.round(b.r.top) || a.r.left - b.r.left)
    .map(({ el }) => el)
}
export function firstVisibleAnchor(root, bounds) {
  const [first] = anchorsInView(root, bounds)
  return first ? first.getAttribute('data-m-anchor') : null
}

// Scrolls the item with `key` to the top of the content band. False (and no scroll) when there is no such item.
export function restoreAnchor(root, key, bounds = chromeBounds()) {
  if (!root || !key) return false
  const el = [...root.querySelectorAll('[data-m-anchor]')].find(item => item.getAttribute('data-m-anchor') === key)
  if (!el) return false
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - bounds.top)
  return true
}

const HOLD_AFTER_RESIZE = 600
const SETTLE = [0, 250] // re-applied on the next frame and once more, in case late layout (fonts, images) moved it
export function createScrollAnchor({ root = () => document.querySelector('.m-main'), bounds = () => chromeBounds(),
  now = () => Date.now(), schedule = fn => requestAnimationFrame(fn), later = (fn, ms) => setTimeout(fn, ms) } = {}) {
  let key = null, held = -Infinity, pending = false, started = false, generation = 0
  const read = () => { pending = false; if (now() - held < HOLD_AFTER_RESIZE) return; const next = firstVisibleAnchor(root(), bounds()); if (next) key = next }
  const onScroll = () => { if (!pending) { pending = true; schedule(read) } }
  const onResize = () => { held = now() }
  return {
    start() {
      if (started) return
      started = true
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onResize)
      if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize)
      read()
    },
    stop() {
      started = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize)
    },
    current: () => key,
    // After a screen-class change: bring the remembered item back, and keep the key through the scroll that causes.
    restore() {
      held = now()
      const mine = ++generation
      const again = () => { if (mine === generation && now() - held < HOLD_AFTER_RESIZE + 400) restoreAnchor(root(), key, bounds()) }
      for (const ms of SETTLE) later(() => schedule(again), ms)
      return restoreAnchor(root(), key, bounds())
    },
  }
}
