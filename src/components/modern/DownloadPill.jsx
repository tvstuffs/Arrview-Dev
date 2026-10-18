import { useDownloads, useDownloadNeeds } from '../../hooks/useDownloads.jsx'
import { formatSpeed } from '../../downloads'

const RADIUS = 8
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// Top-bar pill (640 px and wider): a progress ring and the speed while something is downloading.
// It is mounted whenever the top bar is, so it also registers the SABnzbd need even when it renders nothing.
export default function DownloadPill() {
  useDownloadNeeds({ sab: true })
  const { pill, configured, speed } = useDownloads()
  if (!configured.sab || !pill) return null
  const text = formatSpeed(speed)
  return <a className="m-live-pill" href="#/downloads" aria-label={`Downloads, ${pill.pct}%, ${text}`}>
    <span className="m-live-ring" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pill.pct}>
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle className="m-live-ring-track" cx="10" cy="10" r={RADIUS} fill="none" strokeWidth="2.5" />
        <circle className="m-live-ring-fill" cx="10" cy="10" r={RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - pill.pct / 100)} transform="rotate(-90 10 10)" />
      </svg>
    </span>
    <span className="m-live-speed">{text}</span>
  </a>
}
