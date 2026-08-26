import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from '@renderer/lib/toast'
import { applyTheme, getStoredTheme } from '@renderer/lib/theme'
import './styles/globals.css'

// Applied before the first render so a saved light/dark override takes effect immediately
// instead of flashing the system-default theme while React mounts.
applyTheme(getStoredTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
