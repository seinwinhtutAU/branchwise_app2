import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from '@renderer/lib/toast'
import { applyTheme, getCachedTheme } from '@renderer/lib/theme'
import './styles/globals.css'

// Applied before the first render, from the last theme fetched from the backend, so the
// app doesn't flash the system-default theme while it boots and re-fetches the
// business-wide setting (see lib/appSettings.ts).
applyTheme(getCachedTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
)
