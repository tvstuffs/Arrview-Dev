import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// LAN HTTP remains a normal website/Home Screen shortcut. Never register a
// worker on an insecure origin or let registration failure block the dashboard.
if (window.isSecureContext && 'serviceWorker' in navigator) {
  registerSW({ immediate: true, onRegisterError: () => {} })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
