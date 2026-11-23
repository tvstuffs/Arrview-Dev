import { useSyncExternalStore } from 'react'

// The height class the screen-class store writes to <html data-screen-height> ('short' or 'regular'), read live.
// Shared components (sheets, in both layouts) follow it instead of a height media query.
const read = () => (typeof document === 'undefined' ? 'regular' : document.documentElement.dataset.screenHeight === 'short' ? 'short' : 'regular')
function subscribe(listener) {
  if (typeof MutationObserver !== 'function') return () => {}
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-screen-height'] })
  return () => observer.disconnect()
}
export function useScreenHeight() {
  return useSyncExternalStore(subscribe, read, read)
}
