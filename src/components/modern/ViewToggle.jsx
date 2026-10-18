import Icon from '../Icon.jsx'

export const VIEW_OPTIONS = [
  { value: 'posters', label: 'Large posters', icon: 'squares-four' },
  { value: 'small', label: 'Small posters', icon: 'grid-nine' },
  { value: 'list', label: 'List', icon: 'list' },
]
export const VIEW_VALUES = VIEW_OPTIONS.map(option => option.value)

export default function ViewToggle({ value, onChange, options = VIEW_OPTIONS }) {
  return <div className="m-viewtoggle" role="group" aria-label="View">
    {options.map(option => <button key={option.value} aria-pressed={value === option.value} aria-label={option.label} title={option.label}
      onClick={() => onChange(option.value)}><Icon name={option.icon} /></button>)}
  </div>
}
