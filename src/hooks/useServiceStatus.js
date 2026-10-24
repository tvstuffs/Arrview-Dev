import { useState, useCallback } from 'react'
import { useVisiblePolling } from './lifecycle'
import { apiFetch } from '../api'

export const SERVICE_LABELS = { sabnzbd: 'SABnzbd', nzbhydra: 'NZBHydra', sonarr: 'Sonarr', radarr: 'Radarr' }

// 60 s ping of every configured service; `check` re-runs all pings immediately.
export function useServiceStatus(config) {
  const [status, setStatus] = useState({})
  const check = useCallback(async () => {
    const checks = {}
    await Promise.allSettled(Object.keys(SERVICE_LABELS).filter(svc => config[svc]?.url && config[svc]?.apikey).map(async svc => {
      try { checks[svc] = (await apiFetch(`/api/${svc}/ping`)).ok ? 'online' : 'offline' }
      catch { checks[svc] = 'offline' }
    }))
    setStatus(checks)
  }, [config])
  useVisiblePolling(check, 60000, true, config)
  return { status, check }
}
