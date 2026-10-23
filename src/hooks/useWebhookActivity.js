import { useCallback, useState } from 'react'
import { useVisiblePolling } from './lifecycle'
import { readActivity } from '../webhooks'

export const ACTIVITY_POLL_MS = 5000

// What Sonarr and Radarr last delivered (GET /api/webhooks/last), asked for every few seconds while the page is
// in view and `enabled`, and at once when it comes back into view.
// status: 'loading' until the first answer, then 'ready' (data and the time it arrived), 'error' (could not be
// read and nothing older to show) or 'old' (a server without the route: that is remembered and asking stops).
// A failed poll keeps the last good answer rather than flashing an error.
export function useWebhookActivity(enabled) {
  const [state, setState] = useState({ status: 'loading', data: null, receivedAt: 0 })
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/webhooks/last', { cache: 'no-store' })
      if (response.status === 404) { setState({ status: 'old', data: null, receivedAt: 0 }); return }
      const data = response.ok ? readActivity(await response.json()) : null
      if (!data) throw new Error('unreadable answer')
      setState({ status: 'ready', data, receivedAt: Date.now() })
    } catch {
      setState(previous => previous.status === 'ready' ? previous : { status: 'error', data: null, receivedAt: 0 })
    }
  }, [])
  useVisiblePolling(refresh, ACTIVITY_POLL_MS, enabled && state.status !== 'old')
  return state
}
