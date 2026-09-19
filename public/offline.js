const retryButton = document.getElementById('retry')
const statusText = document.getElementById('status')
let recoveryTimer
let queuedRecovery = false
async function retry(attempts = 0) {
  if (retryButton.disabled) {
    if (attempts) queuedRecovery = true
    return
  }
  clearTimeout(recoveryTimer)
  retryButton.disabled = true
  statusText.textContent = 'Checking connection…'
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Unavailable')
    window.location.replace('/')
  } catch {
    statusText.textContent = 'Still unable to reach the server. Please try again.'
    retryButton.disabled = false
    // An online event can precede usable networking (including the worker).
    // Retry briefly, without an endless background poll or blocking manual retry.
    if (queuedRecovery || (attempts && navigator.onLine)) {
      const remaining = queuedRecovery ? 3 : attempts - 1
      queuedRecovery = false
      recoveryTimer = setTimeout(() => retry(remaining), 1000)
    }
  }
}
retryButton.addEventListener('click', () => retry())
window.addEventListener('online', () => retry(3))
window.addEventListener('pagehide', () => clearTimeout(recoveryTimer))
