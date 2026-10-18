import Sheet from './Sheet'
import { useState, useEffect, useRef, useId } from 'react'
import ListPicker from './ListPicker.jsx'
import { qualityTier, defaultProfile, defaultRootFolder, usageText, formatFreeSpace } from '../addDefaults.js'
import './AddMediaModal.css'

// Returns the best poster URL from a Sonarr/Radarr result object
function getPoster(item) {
  if (item.remotePoster) return item.remotePoster
  if (item.images) {
    const img = item.images.find(i => i.coverType === 'poster')
    if (img) return img.remoteUrl || img.url
  }
  return null
}

const sameItem = (a, b, type) => !!a && !!b && (type === 'show' ? a.tvdbId === b.tvdbId : a.tmdbId === b.tmdbId)

function Poster({ item, className }) {
  const poster = getPoster(item)
  return (
    <div className={className}>
      {poster
        ? <img src={poster} alt="" loading="lazy" />
        : <div className="result-poster-placeholder">{item.title?.[0]}</div>}
    </div>
  )
}

function ResultTile({ item, selected, onSelect, type }) {
  const alreadyAdded = !!item.id
  return (
    <button
      type="button" tabIndex={alreadyAdded ? -1 : 0} aria-disabled={alreadyAdded} aria-pressed={selected}
      aria-label={`Select ${item.title}`}
      className={`result-tile${selected ? ' selected' : ''}${alreadyAdded ? ' already-added' : ''}`}
      onClick={() => { if (!alreadyAdded) onSelect(item) }}
    >
      <Poster item={item} className="result-poster" />
      <span className="result-title font-semibold">{item.title}</span>
      <span className="result-meta text-xs text-muted">{item.year > 0 ? item.year : ''}</span>
      {alreadyAdded && <span className="badge badge-muted text-xs">Already in library</span>}
    </button>
  )
}

function metaLine(item, type) {
  const parts = [
    item.year > 0 ? item.year : null,
    type === 'show' ? item.network : item.studio,
    Array.isArray(item.genres) && item.genres.length ? item.genres.slice(0, 3).join(', ') : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

// `library` is the list the page already holds (series or movies); without it the sheet fetches the list once.
export default function AddMediaModal({ type, library, onClose, onAdded, onToast }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)

  // Config options
  const [qualityProfiles, setQualityProfiles] = useState([])
  const [rootFolders, setRootFolders] = useState([])
  const [fetchedLibrary, setFetchedLibrary] = useState({ status: 'loading', items: null })
  const [pickedProfile, setPickedProfile] = useState(null)
  const [pickedFolder, setPickedFolder] = useState(null)
  const [monitored, setMonitored] = useState(true)
  const [searchOnAdd, setSearchOnAdd] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(null)

  const inputRef = useRef(null)
  const usageId = useId()
  const prefix = type === 'show' ? '/api/sonarr' : '/api/radarr'
  const needsLibraryFetch = !Array.isArray(library)

  // Load quality profiles + root folders
  useEffect(() => {
    Promise.all([
      fetch(`${prefix}/qualityprofiles`).then(r => r.json()),
      fetch(`${prefix}/rootfolders`).then(r => r.json()),
    ]).then(([qp, rf]) => {
      setQualityProfiles(Array.isArray(qp) ? qp : [])
      setRootFolders(Array.isArray(rf) ? rf : [])
    }).catch(() => {})
  }, [prefix])

  // The library, only when the page did not hand it over
  useEffect(() => {
    if (!needsLibraryFetch) return
    let cancelled = false
    fetch(`${prefix}/${type === 'show' ? 'series' : 'movies'}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setFetchedLibrary(Array.isArray(data) ? { status: 'ok', items: data } : { status: 'failed', items: null }) })
      .catch(() => { if (!cancelled) setFetchedLibrary({ status: 'failed', items: null }) })
    return () => { cancelled = true }
  }, [prefix, type, needsLibraryFetch])

  // Debounced lookup
  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`${prefix}/lookup?term=${encodeURIComponent(q)}`)
        const data = await r.json()
        if (cancelled) return
        const list = Array.isArray(data) ? data.slice(0, 12) : []
        setResults(list)
        setSelected(current => current ?? list.find(item => !item.id) ?? null)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, prefix])

  const lib = Array.isArray(library) ? library : fetchedLibrary.items
  const libraryKnown = Array.isArray(lib)
  const settled = qualityProfiles.length > 0 && rootFolders.length > 0 && (libraryKnown || fetchedLibrary.status === 'failed')
  const defProfile = settled ? defaultProfile(qualityProfiles, libraryKnown ? lib : null) : null
  const defFolder = settled ? defaultRootFolder(rootFolders, libraryKnown ? lib : null) : null
  const qualityProfileId = pickedProfile ?? (defProfile ? String(defProfile.id) : '')
  const rootFolderPath = pickedFolder ?? (defFolder ? defFolder.path : '')

  const profileOptions = !settled ? [] : qualityProfiles.map(p => ({
    value: String(p.id), name: p.name, hint: qualityTier(p),
    tag: libraryKnown && defProfile && p.id === defProfile.id ? 'Default' : null,
  }))
  const folderOptions = !settled ? [] : rootFolders.map(f => {
    const free = formatFreeSpace(f.freeSpace)
    return { value: f.path, name: f.path, hint: free ? `${free} free` : null }
  })
  const usage = libraryKnown && qualityProfileId ? usageText(qualityProfileId, lib, type) : null

  async function handleAdd() {
    if (!selected || !qualityProfileId || !rootFolderPath) return
    setAdding(true)
    setAddError(null)
    try {
      const endpoint = type === 'show' ? `${prefix}/series` : `${prefix}/movie`
      const body = type === 'show'
        ? {
            ...selected,
            id: undefined, // strip id so Sonarr treats it as new
            qualityProfileId: parseInt(qualityProfileId),
            rootFolderPath,
            monitored,
            seasonFolder: true,
            addOptions: { searchForMissingEpisodes: searchOnAdd, monitor: 'all' },
          }
        : {
            ...selected,
            id: undefined,
            qualityProfileId: parseInt(qualityProfileId),
            rootFolderPath,
            monitored,
            addOptions: { searchForMovie: searchOnAdd },
          }

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      onToast(`"${selected.title}" added to ${type === 'show' ? 'Sonarr' : 'Radarr'}!`, 'success')
      onAdded?.()
      onClose()
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAdding(false)
    }
  }

  const label = type === 'show' ? 'Show' : 'Movie'
  const canAdd = selected && settled && qualityProfileId && rootFolderPath

  const footer = (
    <div className="add-footer">
      {addError && <div className="error-banner" role="alert">{addError}</div>}
      <div className="add-footer-buttons">
        <button type="button" className="btn btn-secondary" disabled={adding} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={!canAdd || adding}>
          {adding
            ? <><span className="spinner" style={{width:14,height:14}} /> Adding…</>
            : `Add ${label}`
          }
        </button>
      </div>
    </div>
  )

  return (
    <Sheet title={`Add ${label}`} onClose={onClose} busy={adding} footer={footer} initialFocus={inputRef}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="add-grabber" aria-hidden="true" />

        {/* Search */}
        <div className="modal-search">
          <input
            ref={inputRef}
            type="text"
            aria-label={`Search for a ${type === 'show' ? 'show' : 'movie'}`}
            placeholder={`Search for a ${type === 'show' ? 'tv show' : 'movie'}…`}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null); setAddError(null) }}
          />
          {searching && <span className="spinner modal-search-spinner" />}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="modal-results">
            {results.map((item, i) => (
              <ResultTile
                key={item.tvdbId || item.tmdbId || i}
                item={item}
                selected={sameItem(selected, item, type)}
                onSelect={setSelected}
                type={type}
              />
            ))}
          </div>
        )}

        {/* No results */}
        {query.trim() && !searching && results.length === 0 && (
          <div className="modal-empty text-muted text-sm">No results found for "{query}"</div>
        )}

        {/* Selected item details and config */}
        {selected && (
          <div className="modal-config">
            <div className="selected-preview">
              <Poster item={selected} className="selected-poster" />
              <div className="selected-text">
                <div className="selected-title font-semibold">{selected.title}</div>
                {metaLine(selected, type) && <div className="selected-meta text-sm text-muted">{metaLine(selected, type)}</div>}
                {selected.overview && <p className="selected-overview text-sm text-secondary">{selected.overview}</p>}
              </div>
            </div>

            <div className="config-fields">
              <ListPicker
                label="Quality Profile" options={profileOptions} value={qualityProfileId}
                onChange={setPickedProfile} describedBy={usage ? usageId : undefined}
              />
              {usage && <p className="picker-helper text-sm text-muted" id={usageId}>{usage}</p>}
              <ListPicker
                label="Root Folder" icon="folder-simple" options={folderOptions} value={rootFolderPath}
                onChange={setPickedFolder}
              />

              <div className="config-switches">
                <label className="switch-label">
                  <input type="checkbox" role="switch" checked={monitored} onChange={e => setMonitored(e.target.checked)} />
                  Monitored
                </label>
                <label className="switch-label">
                  <input type="checkbox" role="switch" checked={searchOnAdd} onChange={e => setSearchOnAdd(e.target.checked)} />
                  {type === 'show' ? 'Search for missing episodes after add' : 'Search for movie after add'}
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
