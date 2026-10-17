import { useState, useEffect } from 'react'
import Icon from '../Icon.jsx'
import { MonitorToggle, supportsMovieRemoval } from '../MediaControls'
import ReleaseSearchModal from '../ReleaseSearchModal'
import { MovieDeleteSheet } from '../MediaSheets'
import { isMovieMissing } from '../../media'

// True when the primary pointer can hover. The tile overlay is only rendered then.
export function useHoverCapable() {
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches === true
  const [capable, setCapable] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(hover: hover)')
    const update = () => setCapable(query.matches === true)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return capable
}

// Download, Interactive Search, Monitored and Delete for one movie.
// variant: 'page' (text buttons), 'row' (icons, Download with text), 'overlay' (as row), 'overlay-small' (icons only).
export default function MovieActions({ movie, actions, identity, onChanged, onToast, onRemoved, variant = 'row' }) {
  const [searching, setSearching] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const text = variant === 'page'
  const iconOnly = variant === 'overlay-small'
  async function download() { setSearching(true); try { await actions.searchMovie(movie) } finally { setSearching(false) } }
  const downloadIcon = searching ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon name="download-simple" />
  return <>
    {isMovieMissing(movie) && (iconOnly
      ? <button className="btn btn-icon m-attn-btn" aria-label="Download" title="Download" disabled={searching} onClick={download}>{downloadIcon}</button>
      : <button className="btn btn-attn btn-sm" disabled={searching} onClick={download}>{downloadIcon} Download</button>)}
    {text
      ? <button className="btn btn-secondary btn-sm" onClick={() => setInteractive(true)}><Icon name="magnifying-glass" /> Interactive Search</button>
      : <button className="btn btn-icon" aria-label="Interactive Search" title="Interactive Search" onClick={() => setInteractive(true)}><Icon name="magnifying-glass" /></button>}
    <MonitorToggle media={movie} service="radarr" onChanged={onChanged} onToast={onToast} />
    {text
      ? <button className="btn btn-secondary btn-sm" onClick={() => setConfirm(true)}><Icon name="trash" /> Delete…</button>
      : <button className="btn btn-icon btn-icon-danger" aria-label={`Delete ${movie.title}`} title={`Delete ${movie.title}`} onClick={() => setConfirm(true)}><Icon name="trash" /></button>}
    {interactive && <ReleaseSearchModal movie={movie} onClose={() => setInteractive(false)} onToast={onToast} />}
    {confirm && <MovieDeleteSheet movie={movie} canRemove={supportsMovieRemoval(identity)}
      onUnmonitor={() => actions.unmonitorMovie(movie)}
      onRemove={async () => { await actions.removeMovie(movie); onRemoved?.() }}
      onClose={() => { setConfirm(false); onChanged() }} />}
  </>
}
