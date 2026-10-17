import { useState } from 'react'
import Icon from '../Icon.jsx'

// Artwork with an ordered fallback chain. `srcs` holds already-validated URLs (see artUrl in media.js).
// A load error advances to the next URL; only an exhausted (or empty) list shows the placeholder.
export default function ArtImage({ srcs = [], className = '', width, height, eager = false, ambient = false, icon = 'film-slate' }) {
  const list = srcs.filter(Boolean)
  const key = list.join('\n')
  const [failure, setFailure] = useState({ key, count: 0 })
  const index = failure.key === key ? failure.count : 0
  const src = list[index]
  const onError = () => setFailure({ key, count: index + 1 })
  if (ambient) {
    return src ? <img key={src} className="m-ambient" src={src} alt="" aria-hidden="true" decoding="async" referrerPolicy="no-referrer" onError={onError} /> : null
  }
  return <span className={`m-art ${className}`}>
    {src
      ? <img key={src} src={src} alt="" width={width} height={height} loading={eager ? undefined : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={onError} />
      : <span className="m-art-empty" aria-hidden="true"><Icon name={icon} /></span>}
  </span>
}
