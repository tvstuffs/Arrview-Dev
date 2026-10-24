import { createContext, useContext } from 'react'

// { status, refresh } from App: status is the body of GET /api/auth/status, refresh() asks again.
// Without a provider (Settings rendered on its own) the value is null and the Security card is not shown.
export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)
