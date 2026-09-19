import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(cleanup)
const mode = new EventTarget()
mode.matches = false
mode.media = '(display-mode: standalone)'
window.matchMedia = () => mode
window.isSecureContext = true
