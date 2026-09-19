export async function checkedFetch(url, options) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}
export async function deleteAndUnmonitor(episodes) {
  // Complete deletes first; if some fail, report partial progress and never claim success.
  const results = await Promise.allSettled(episodes.map(ep => checkedFetch(`/api/sonarr/episodefile/${ep.episodeFileId}`, { method: 'DELETE' })))
  const deleted = episodes.filter((_, i) => results[i].status === 'fulfilled')
  if (deleted.length) {
    try {
      await checkedFetch('/api/sonarr/episode/monitor', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: deleted.map(ep => ep.id), monitored: false }) })
    } catch { throw new Error('Files were deleted, but Sonarr could not unmonitor the episodes. Check monitoring in Sonarr before retrying.') }
  }
  if (deleted.length !== episodes.length) throw new Error(`${deleted.length} of ${episodes.length} files deleted and unmonitored. Some deletes failed; close this sheet to refresh before retrying.`)
}
