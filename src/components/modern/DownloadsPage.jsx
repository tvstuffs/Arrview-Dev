import { useState } from 'react'
import Icon from '../Icon.jsx'
import ConfirmSheet from '../ConfirmSheet.jsx'
import ArtImage from './ArtImage.jsx'
import PageHeader, { SettingsLink } from './PageHeader.jsx'
import { DownloadBar } from './DownloadStatus.jsx'
import { useLibraryOnce } from './LibraryProvider.jsx'
import useUpcoming from '../../hooks/useUpcoming'
import { useDownloads, useDownloadNeeds, useDownloadHistory, useNow } from '../../hooks/useDownloads.jsx'
import { checkedFetch } from '../../actions'
import { artUrl } from '../../media'
import { dayDate, entryLabel, groupByDay, timeText } from '../../upcoming'
import { buildHistoryItems, formatLeft, formatSize, idleLead, kindLabel, relativeTime, rowStatus } from '../../downloads'

const NEEDS = { sab: true, page: true, sonarr: 'always', radarr: 'always' }
const TONE = { downloading: 'live', paused: 'attn', queued: 'muted', processing: 'muted' }
const SERVICE_NAME = { sonarr: 'Sonarr', radarr: 'Radarr' }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const idOf = (prefix, key) => `${prefix}-${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}`
const href = item => (item.matched && item.mediaId != null ? `#/${item.kind === 'movie' ? 'movies' : 'shows'}/${item.mediaId}` : null)

// A category glyph on a tile. Its text alternative is the category label.
function GlyphTile({ category, large = false }) {
  return <span className={`m-dl-glyph${large ? ' is-large' : ''}`} role="img" aria-label={category.label}><Icon name={category.icon} /></span>
}

function Thumb({ item }) {
  return item.matched && item.art.thumb
    ? <ArtImage srcs={[item.art.thumb]} className="m-art-poster m-dl-thumb" width="48" height="72" icon={item.category.icon} />
    : <GlyphTile category={item.category} />
}

// Subtitle with the muted "Not in Sonarr" hint after it (D15, D16).
function Subtitle({ text, hint, className }) {
  if (!text && !hint) return null
  return <p className={className}>{text}{text && hint ? ' · ' : ''}{hint && <span className="m-dl-hint">{hint}</span>}</p>
}

function Title({ item, id, className }) {
  const link = href(item)
  return <span id={id} className={className} title={item.release}>{link ? <a href={link}>{item.title}</a> : item.title}</span>
}

// Fanart hero, poster hero (poster beside the text over a blurred copy of itself), or the glyph tile (D20).
function HeroShell({ art, category, children }) {
  const variant = art.fanart ? 'fanart' : art.poster ? 'poster' : 'glyph'
  return <section className={`m-dl-hero is-${variant}`}>
    {variant !== 'glyph' && <ArtImage ambient srcs={variant === 'fanart' ? [art.fanart, art.poster] : [art.poster]} />}
    <div className="m-dl-hero-body">{children}</div>
    {variant === 'fanart' && <div className="m-hero-art"><ArtImage srcs={[art.fanart, art.poster]} className="m-art-hero" width="1280" height="720" eager icon={category.icon} /></div>}
    {variant === 'poster' && <div className="m-dl-hero-poster"><ArtImage srcs={[art.poster]} className="m-art-poster" width="300" height="450" eager icon={category.icon} /></div>}
    {variant === 'glyph' && <div className="m-dl-hero-poster"><GlyphTile category={category} large /></div>}
  </section>
}

function Eyebrow({ kind }) {
  const tone = TONE[kind]
  return <p className={`m-dl-eyebrow m-live-eyebrow is-${tone}`}>
    <span className={`m-live-dot is-${tone}${kind === 'downloading' ? '' : ' is-static'}`} aria-hidden="true" />{kindLabel(kind)}
  </p>
}

function Hero({ item, onPause, onResume, onRemove }) {
  const { slot, status } = item
  const done = Number(slot.mb) - Number(slot.mbleft)
  const sizes = `${formatSize(done)} of ${formatSize(slot.mb)}`
  const left = formatLeft(slot.timeleft)
  const titleId = idOf('dl-hero-title', item.key)
  const link = href(item)
  return <HeroShell art={item.art} category={item.category}>
    <Eyebrow kind={status} />
    <h2 className="m-dl-title" id={titleId} title={item.release}>{link ? <a href={link}>{item.title}</a> : item.title}</h2>
    <Subtitle text={item.heroSubtitle} hint={item.hint} className="m-dl-sub" />
    {item.quality && <p className="m-dl-quality">{item.quality}</p>}
    {!item.matched && <p className="m-dl-release">{item.release}</p>}
    <div className="m-dl-progress">
      <DownloadBar pct={item.pct} tone={status === 'paused' ? 'attn' : 'live'} valueText={`${item.pct}%, ${sizes}`} />
      <p className="m-dl-progress-text"><span>{item.pct}% · {sizes}</span>{left && <span>{left}</span>}</p>
    </div>
    <div className="m-dl-actions">
      {status === 'paused'
        ? <button className="btn m-dl-glass" aria-describedby={titleId} onClick={() => onResume(slot.nzo_id)}><Icon name="play" weight="fill" /> Resume</button>
        : <button className="btn m-dl-glass" aria-describedby={titleId} onClick={() => onPause(slot.nzo_id)}><Icon name="pause" weight="fill" /> Pause</button>}
      <button className="btn btn-icon m-dl-glass" aria-label="Remove from SABnzbd Queue" title="Remove from SABnzbd Queue" aria-describedby={titleId} onClick={() => onRemove(item)}><Icon name="x" /></button>
    </div>
  </HeroShell>
}

function QueueRow({ item, onPause, onResume, onRemove }) {
  const { slot, status } = item
  const titleId = idOf('dl-row-title', item.key)
  const line = rowStatus(status, item.pct)
  const paused = status === 'paused'
  return <li className="m-dl-row">
    <Thumb item={item} />
    <div className="m-dl-row-main">
      <Title item={item} id={titleId} className="m-dl-row-title" />
      <Subtitle text={item.subtitle} hint={item.hint} className="m-dl-row-sub" />
      <p className={`m-dl-row-status is-${line.tone}`}>
        {line.bar && <DownloadBar pct={item.pct} tone={line.tone === 'attn' ? 'attn' : 'live'} />}
        <span className={`m-live-text is-${line.tone}`}>{line.text}</span>
      </p>
    </div>
    <div className="m-dl-row-side">
      <span>{item.quality || item.category.label}</span>
      <span>{formatSize(slot.mb)}</span>
    </div>
    <div className="m-dl-row-actions">
      {paused
        ? <button className="btn btn-icon m-dl-iconbtn" aria-label="Resume" title="Resume" aria-describedby={titleId} onClick={() => onResume(slot.nzo_id)}><Icon name="play" weight="fill" /></button>
        : <button className="btn btn-icon m-dl-iconbtn" aria-label="Pause" title="Pause" aria-describedby={titleId} onClick={() => onPause(slot.nzo_id)}><Icon name="pause" weight="fill" /></button>}
      <button className="btn btn-icon btn-icon-danger m-dl-iconbtn" aria-label="Remove from SABnzbd Queue" title="Remove from SABnzbd Queue" aria-describedby={titleId} onClick={() => onRemove(item)}><Icon name="x" /></button>
    </div>
  </li>
}

function HistoryRow({ item, now }) {
  const when = relativeTime(item.completed, now)
  const failed = item.status === 'Failed'
  return <li className="m-dl-row is-history">
    <Thumb item={item} />
    <div className="m-dl-row-main">
      <Title item={item} id={idOf('dl-hist-title', item.key)} className="m-dl-row-title" />
      <Subtitle text={item.subtitle} hint={item.hint} className="m-dl-row-sub" />
    </div>
    <div className="m-dl-row-side">
      {failed ? <span className="m-dl-failed">Failed</span> : <span className={item.status === 'Completed' ? undefined : 'm-dl-muted'}>{item.status === 'Completed' ? item.size : item.status}</span>}
      {when && <span>{when}</span>}
    </div>
  </li>
}

const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const RELATIVE = { today: 'Today', tomorrow: 'Tomorrow' }
function ComingUp({ config, now }) {
  const { entries, loading, errors, sources } = useUpcoming(config)
  if (loading || (!sources.tv && !sources.movies)) return null
  const today = localDay(new Date(now))
  const upcoming = entries.filter(entry => (entry.kind === 'movie' ? entry.dayKey >= today : entry.at >= now)).slice(0, 3)
  if (!upcoming.length && (errors.sonarr || errors.radarr)) return null
  const whenText = entry => {
    const [{ relative }] = groupByDay([entry], now)
    const day = RELATIVE[relative] || dayDate(entry.dayKey).toLocaleDateString(undefined, { weekday: 'short' })
    return `${day} · ${entry.kind === 'movie' ? (entry.release === 'physical' ? 'Physical' : 'Digital') : timeText(entry.at)}`
  }
  return <section className="m-dl-section m-dl-coming">
    <div className="m-dl-head">
      <h2>Coming up</h2>
      <a className="m-dl-seeall" href="#/upcoming">See all <Icon name="caret-right" /></a>
    </div>
    {upcoming.length === 0
      ? <p className="m-dl-note">Nothing scheduled in this window</p>
      : <ul className="m-dl-list">{upcoming.map(entry => {
        const movie = entry.kind === 'movie'
        const id = movie ? entry.movieId : entry.seriesId
        const body = <>
          <ArtImage srcs={[artUrl(movie ? entry.movie : entry.series, 'poster', 'grid')]} className="m-art-poster m-dl-thumb" width="48" height="72" icon={movie ? 'film-slate' : 'television-simple'} />
          <span className="m-dl-row-main"><span className="m-dl-row-title">{entry.title}</span><span className="m-dl-row-sub">{entry.subtitle}</span></span>
          <span className="m-dl-row-side"><span>{whenText(entry)}</span></span>
        </>
        return <li key={entry.key}>{id === null || id === undefined
          ? <div className="m-dl-row">{body}</div>
          : <a className="m-dl-row" href={`#/${movie ? 'movies' : 'shows'}/${id}`} aria-label={entryLabel(entry)}>{body}</a>}</li>
      })}</ul>}
  </section>
}

export default function DownloadsPage({ config, phone, onToast, canSearch = false }) {
  useDownloadNeeds(NEEDS)
  const dl = useDownloads()
  const now = useNow(30000)
  const [limit, setLimit] = useState(15)
  const [removing, setRemoving] = useState(null)
  const library = useLibraryOnce({ series: dl.configured.sonarr, movies: dl.configured.radarr })
  const history = useDownloadHistory({ slots: dl.slots, limit, enabled: dl.configured.sab })

  async function post(mode, nzoId) {
    try {
      const r = await fetch('/api/sabnzbd/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, nzo_id: nzoId }) })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      dl.refresh()
    } catch (e) { onToast(`Error: ${e.message}`, 'error') }
  }
  async function remove(item) {
    await checkedFetch('/api/sabnzbd/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'queue', name: 'delete', value: item.slot.nzo_id }) })
    onToast('Item removed from the SABnzbd queue', 'info')
    dl.refresh()
  }

  const gear = phone && <div className="m-gear-row"><SettingsLink /></div>
  // `ready` stays latched once reached, so a page opened later also waits for its own arr answers (no unmatched flash).
  const awaitingArr = dl.slots.length > 0 && ['sonarr', 'radarr'].some(service => dl.arr[service] === 'idle' || dl.arr[service] === 'pending')
  if (!dl.ready || awaitingArr) return <div className="empty-state" role="status"><h1 className="m-sr" data-m-placeholder>Downloads</h1><span className="spinner" /><span>Loading downloads…</span></div>
  if (dl.error) return <>
    {gear}
    <div className="empty-state">
      <h1 className="m-sr">Downloads</h1>
      <div className="empty-state-icon"><Icon name="warning" /></div>
      <strong>Cannot reach SABnzbd</strong>
      <p className="text-sm text-muted">{dl.error}</p>
      <button className="btn btn-secondary mt-4" onClick={dl.refresh}>Retry</button>
    </div>
  </>

  const { items, active, queue } = dl
  const idle = items.length === 0
  const historyItems = buildHistoryItems(history.slots || [], library, { sonarr: dl.arr.sonarr === 'ok', radarr: dl.arr.radarr === 'ok' })
  const historyLoaded = history.slots !== null || history.error !== null
  const lead = idle ? idleLead(historyItems) : null
  const rest = items.filter(item => item !== active)
  const downloading = queue?.status === 'Downloading'
  const left = formatLeft(queue?.timeleft)
  const more = limit < 1000 && (history.total != null ? historyItems.length < history.total : historyItems.length >= limit)
  const plainHeader = idle && historyLoaded && !lead
  const downloadedAt = lead ? relativeTime(lead.completed, now) : null

  return <div className="m-page m-dl">
    {!plainHeader && gear}
    {plainHeader
      ? <><PageHeader title="Downloads" phone={phone} gear /><p className="m-meta">Nothing is downloading</p></>
      : <h1 className="m-sr">Downloads</h1>}
    {active && <Hero item={active} onPause={id => post('pause', id)} onResume={id => post('resume', id)} onRemove={setRemoving} />}
    {lead && <HeroShell art={lead.art} category={lead.category}>
      <p className="m-dl-eyebrow m-dl-done"><Icon name="check" />{downloadedAt ? `Downloaded ${downloadedAt}` : 'Downloaded'}</p>
      <h2 className="m-dl-title"><a href={href(lead)}>{lead.title}</a></h2>
      <Subtitle text={lead.subtitle} className="m-dl-sub" />
      {(lead.quality || lead.size) && <p className="m-dl-quality">{[lead.quality, lead.size].filter(Boolean).join(' · ')}</p>}
    </HeroShell>}
    <div className="m-dl-cols">
      <section className="m-dl-section">
        <div className="m-dl-head">
          <div>
            <h2>Queue</h2>
            <p className="m-dl-count">{plural(items.length, 'item', 'items')}{left && ` · ${left}`}</p>
          </div>
          <div className="m-dl-head-actions">
            {canSearch && <a className="btn btn-secondary btn-sm m-dl-search" href="#/search"><Icon name="magnifying-glass" /> Search NZBs</a>}
            {!idle && (downloading
              ? <button className="btn btn-secondary btn-sm" onClick={() => post('pause')}><Icon name="pause" weight="fill" /> Pause All</button>
              : <button className="btn btn-secondary btn-sm" onClick={() => post('resume')}><Icon name="play" weight="fill" /> Resume All</button>)}
          </div>
        </div>
        {['sonarr', 'radarr'].filter(service => dl.arr[service] === 'error').map(service =>
          <p key={service} className="m-dl-note" role="status">Could not reach {SERVICE_NAME[service]}, so matches may be missing.</p>)}
        {idle
          ? <p className="m-dl-note">Nothing is downloading. When Sonarr or Radarr grabs an episode or movie, it appears here.</p>
          : rest.length === 0
            ? <p className="m-dl-note">Nothing else is queued.</p>
            : <ul className="m-dl-list">{rest.map(item => <QueueRow key={item.key} item={item} onPause={id => post('pause', id)} onResume={id => post('resume', id)} onRemove={setRemoving} />)}</ul>}
      </section>
      {historyItems.length > 0 && <section className="m-dl-section">
        <div className="m-dl-head"><h2>Recent History</h2></div>
        <ul className="m-dl-list">{historyItems.map(item => <HistoryRow key={item.key} item={item} now={now} />)}</ul>
        {more && <button className="btn btn-secondary" onClick={() => setLimit(value => Math.min(1000, value + 15))}>Load more</button>}
      </section>}
    </div>
    {idle && <ComingUp config={config} now={now} />}
    {removing && <ConfirmSheet title="Remove download?" description={`Remove “${removing.release}” from the SABnzbd queue. This does not remove it from Sonarr or Radarr.`}
      actions={[{ label: 'Remove from SABnzbd Queue', run: () => remove(removing) }]} onClose={() => setRemoving(null)} />}
  </div>
}
