import { useMemo } from 'react'
import { useCommandPolling } from './useCommandPolling'
import { checkedFetch, deleteAndUnmonitor, deleteMovieAndUnmonitor } from '../actions'
import { isMovieMissing } from '../media'

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// Search and removal actions (and their toast wording) shared by the Classic and Modern layouts.
export function useMediaActions(onToast) {
  const pollCommand = useCommandPolling()
  return useMemo(() => ({
    async searchSeries(show) {
      try {
        const r = await post('/api/sonarr/command', { name: 'SeriesSearch', seriesId: show.id })
        const data = await r.json()
        if (data.error) throw new Error(data.error)
        onToast(`Searching all missing episodes of "${show.title}"…`, 'info')
        pollCommand(data.id, (status, result) => {
          if (status === 'completed' && result === 'successful') {
            onToast(`Search complete for "${show.title}" — check downloads`, 'success')
          } else if (status === 'completed' && result === 'skipped') {
            onToast(`Search skipped for "${show.title}" (no indexer results)`, 'info')
          } else if (status === 'failed' || result === 'unsuccessful') {
            onToast(`Search failed for "${show.title}"`, 'error')
          } else if (status === 'timeout') {
            onToast(`"${show.title}" search is taking a while — check Sonarr`, 'info')
          }
        })
      } catch (e) {
        onToast(`Search failed: ${e.message}`, 'error')
      }
    },
    async searchEpisode(episodeId) {
      try {
        const r = await post('/api/sonarr/command', { name: 'EpisodeSearch', episodeIds: [episodeId] })
        const data = await r.json()
        if (data.error) throw new Error(data.error)
        onToast('Episode search queued…', 'info')
        pollCommand(data.id, (status, result) => {
          if (status === 'completed' && result === 'successful') {
            onToast('Episode search completed — check downloads', 'success')
          } else if (status === 'completed' && result === 'skipped') {
            onToast('Episode search skipped (no indexers returned results)', 'info')
          } else if (status === 'failed' || result === 'unsuccessful') {
            onToast('Episode search failed — no results found', 'error')
          } else if (status === 'timeout') {
            onToast('Episode search is taking a while — check Sonarr for status', 'info')
          }
        })
      } catch (e) {
        onToast(`Search failed: ${e.message}`, 'error')
      }
    },
    async searchSeason(sn, ids) {
      if (!ids.length) return
      try {
        const r = await post('/api/sonarr/command', { name: 'EpisodeSearch', episodeIds: ids })
        const data = await r.json()
        if (data.error) throw new Error(data.error)
        onToast(`Searching ${ids.length} missing episodes in S${sn}…`, 'info')
        pollCommand(data.id, (status, result) => {
          if (status === 'completed' && result === 'successful') {
            onToast(`S${sn} search complete — check downloads`, 'success')
          } else if (status === 'failed' || result === 'unsuccessful') {
            onToast(`S${sn} search failed — no results found`, 'error')
          } else if (status === 'timeout') {
            onToast(`S${sn} search is taking a while — check Sonarr`, 'info')
          }
        })
      } catch (e) {
        onToast(`Failed: ${e.message}`, 'error')
      }
    },
    async deleteSeasonFiles(sn, episodes) {
      const eps = (episodes || []).filter(e => e.seasonNumber === sn && e.hasFile)
      if (!eps.length) throw new Error('No downloaded files remain. Check episode monitoring in Sonarr.')
      await deleteAndUnmonitor(eps)
      onToast(`Season ${sn}: files deleted and episodes unmonitored in Sonarr`, 'info')
    },
    async deleteEpisode(ep) {
      try { await deleteAndUnmonitor([ep]) }
      catch (error) { onToast(`Delete failed: ${error.message}`, 'error'); throw error }
      onToast('Episode deleted and unmonitored', 'info')
    },
    async removeSeries(show, deleteFiles) {
      await checkedFetch(`/api/sonarr/series/${show.id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' })
      onToast(`“${show.title}” removed from Sonarr${deleteFiles ? ' and files deleted' : '; files kept'}`, 'info')
    },
    async searchMovie(movie) {
      try {
        const r = await post('/api/radarr/command', { name: 'MoviesSearch', movieIds: [movie.id] })
        const data = await r.json()
        if (!r.ok || data.error) throw new Error(data.error)
        onToast(`Searching for "${movie.title}"`, 'success')
      } catch (e) {
        onToast(`Search failed: ${e.message}`, 'error')
      }
    },
    async downloadAllMissing(movies) {
      const missing = movies.filter(isMovieMissing)
      if (!missing.length) return
      try {
        await checkedFetch('/api/radarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'MoviesSearch', movieIds: missing.map(m => m.id) }),
        })
        onToast(`Searching for ${missing.length} missing movies`, 'success')
      } catch (e) {
        onToast(`Failed: ${e.message}`, 'error')
      }
    },
    async unmonitorMovie(movie) {
      await deleteMovieAndUnmonitor(movie)
      onToast('Movie deleted and unmonitored', 'success')
    },
    async removeMovie(movie) {
      await checkedFetch(`/api/radarr/movie/${movie.id}?deleteFiles=true`, { method: 'DELETE' })
      onToast('Movie removed from Radarr', 'success')
    },
  }), [onToast, pollCommand])
}
