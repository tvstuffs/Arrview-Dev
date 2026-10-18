import { liveStatus } from '../../downloads'

// Thin progress bar for a download. `tone` is 'live' (cyan) or 'attn' (paused); `overlay` pins it to the bottom of a poster.
export function DownloadBar({ pct, tone = 'live', overlay = false, valueText }) {
  return <span className={`m-live-bar${tone === 'attn' ? ' is-attn' : ''}${overlay ? ' is-overlay' : ''}`} role="progressbar" aria-label="Download progress"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText}><span style={{ width: `${pct}%` }} /></span>
}

// Status line of an episode that is in the queue (D27): "Downloading", a bar, "64% · 1 min left".
export function EpisodeLive({ item }) {
  const live = liveStatus(item)
  return <div className="m-live-ep">
    <span className={`m-live-text is-${live.tone}`}>{live.label}</span>
    <DownloadBar pct={live.pct} tone={live.tone === 'attn' ? 'attn' : 'live'} />
    {live.detail && <span className="m-live-detail">{live.detail}</span>}
  </div>
}

// "Downloading · 64%", "Paused · 12%", "Queued", "Processing" for movie tiles, rows and the movie page (D28).
export function MovieLiveText({ item, className = '' }) {
  const live = liveStatus(item)
  return <span className={`m-live-text is-${live.tone}${className ? ` ${className}` : ''}`}>{live.tileText}</span>
}
