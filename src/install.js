// Start listening before React mounts: Chromium can offer installation before
// Settings opens. A prompt event can be used only once and is never persisted.
import { useSyncExternalStore } from 'react'

const displayMode = window.matchMedia('(display-mode: standalone)')
const listeners = new Set()
let promptEvent = null
let snapshot = { installed: displayMode.matches || navigator.standalone === true, canInstall: false }
function notify() {
  snapshot = { ...snapshot, canInstall: !snapshot.installed && promptEvent !== null }
  listeners.forEach(listener => listener())
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  promptEvent = event
  notify()
})
window.addEventListener('appinstalled', () => {
  promptEvent = null
  snapshot = { ...snapshot, installed: true }
  notify()
})
displayMode.addEventListener('change', event => {
  snapshot = { ...snapshot, installed: event.matches || navigator.standalone === true }
  notify()
})

export async function requestInstall() {
  const event = promptEvent
  if (!event) return null
  promptEvent = null
  notify()
  await event.prompt()
  return (await event.userChoice).outcome
}

export function useInstallStatus() {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => snapshot)
}

export function installPlatform() {
  // iPadOS can use a desktop Mac user agent.
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/i.test(navigator.userAgent)) return 'android'
  return 'desktop'
}
