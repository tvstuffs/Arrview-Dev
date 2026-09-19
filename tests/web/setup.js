import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(cleanup)
const mode = new EventTarget()
mode.matches = false
mode.media = '(display-mode: standalone)'
window.matchMedia = () => mode
window.isSecureContext = true
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
// Node 26 exposes an unavailable native localStorage global; provide a browser-like
// Storage boundary for unit tests. Real persistence is exercised in Chromium.
const storage = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
} })
