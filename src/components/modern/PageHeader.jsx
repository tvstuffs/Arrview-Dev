import Icon from '../Icon.jsx'

export function SettingsLink({ className = 'm-iconbtn' }) {
  return <a className={className} href="#/settings" aria-label="Settings" title="Settings"><Icon name="gear-six" /></a>
}

// Page title row. Phones: + icon button and gear link. Wide screens: text "Add" button (the gear lives in the top bar).
export default function PageHeader({ title, phone, addLabel, onAdd, gear = false }) {
  return <header className="m-pageheader">
    <h1>{title}</h1>
    <div className="m-pageheader-actions">
      {addLabel && (phone
        ? <button className="m-iconbtn" aria-label={addLabel} title={addLabel} onClick={onAdd}><Icon name="plus" /></button>
        : <button className="btn btn-primary btn-sm" onClick={onAdd}><Icon name="plus" /> {addLabel}</button>)}
      {phone && gear && <SettingsLink />}
    </div>
  </header>
}
