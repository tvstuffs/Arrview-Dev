import { useState, useEffect } from 'react'

const PHONE_QUERY = '(max-width: 639px)'

// True below 640 px: the bottom bar drops Settings and the header gear takes over.
export function usePhone() {
  const read = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches === true
  const [phone, setPhone] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setPhone(query.matches === true)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return phone
}
