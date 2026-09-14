import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: register the service worker for offline support (production builds only;
// the dev server has no generated sw.js, and registering there just 404s).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    void navigator.serviceWorker.register('/sw.js').catch(function (e) {
      console.error('service worker registration failed', e)
    })
  })
}
