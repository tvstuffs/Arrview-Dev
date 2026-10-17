import Icon from '../Icon.jsx'

// One strip per offline service the page depends on, in matrix order.
export default function ServiceBanner({ services, onRetry }) {
  if (!services.length) return null
  return <div className="m-banners">
    {services.map(({ id, label }) => <div className="m-banner" role="status" key={id}>
      <Icon name="warning" />
      <span className="m-banner-text">Can't reach {label}</span>
      <button className="m-banner-btn" aria-label={`Retry ${label}`} onClick={onRetry}>Retry</button>
      <a className="m-banner-btn" href="#/settings">Settings</a>
    </div>)}
  </div>
}
