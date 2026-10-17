// Toggle buttons (aria-pressed), not a tab widget. `options` is [[value, label], ...].
export default function FilterChips({ options, value, onChange, label = 'Filter' }) {
  return <div className="m-chips" role="group" aria-label={label}>
    {options.map(([v, text]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
  </div>
}
