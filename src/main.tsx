import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Capture Google OAuth provider token directly from URL hash before Supabase client clears it
try {
  const hash = window.location.hash
  if (hash) {
    const params = new URLSearchParams(hash.substring(1))
    const providerToken = params.get('provider_token')
    if (providerToken) {
      localStorage.setItem('intrack_oauth_provider_token', providerToken)
    }
  }
} catch (e) {
  console.warn('Failed to parse provider token from hash:', e)
}

// Register Service Worker for PWA support.
//
// Gated on the legacy-purge promise set up in index.html. That purge runs once
// per browser and unregisters EVERY service worker; because it is async, it
// could otherwise resolve after this registration and immediately unregister
// the worker we had just installed — costing the whole first visit its cache.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const purged = (window as Window & { __intrackPurge?: Promise<unknown> }).__intrackPurge
      ?? Promise.resolve()
    purged
      .then(() => navigator.serviceWorker.register('/sw.js'))
      .catch(err => console.warn('SW registration failed:', err))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
