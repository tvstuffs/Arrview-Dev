import { useState, useCallback } from 'react'

// Only view preferences belong here. Never persist config, keys or API data.
export function usePreference(key, fallback, valid = () => true) {
  const storageKey = `arrview.ui.v1.${key}`
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      const saved = raw === null ? fallback : JSON.parse(raw)
      return valid(saved) ? saved : fallback
    } catch { return fallback }
  })
  const update = useCallback(next => {
    setValue(previous => {
      const value = typeof next === 'function' ? next(previous) : next
      try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* private mode / quota */ }
      return value
    })
  }, [storageKey])
  return [value, update]
}
export const textPreference = value => typeof value === 'string' && value.length <= 500
export const oneOf = values => value => values.includes(value)
export const idList = value => Array.isArray(value) && value.length <= 1000 && value.every(Number.isSafeInteger)
