const retryButton = document.getElementById('retry')
const statusText = document.getElementById('status')
async function retry() {
  if (retryButton.disabled) return
  retryButton.disabled = true
  statusText.textContent = 'Checking connection…'
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Unavailable')
    window.location.replace('/')
  } catch {
    statusText.textContent = 'Still unable to reach the server. Please try again.'
    retryButton.disabled = false
  }
}
retryButton.addEventListener('click', retry)
window.addEventListener('online', retry)
