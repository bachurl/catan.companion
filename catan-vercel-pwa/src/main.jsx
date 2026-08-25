import React from 'react'
import ReactDOM from 'react-dom/client'
import CatanApp from './CatanApp.jsx'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import { useSWUpdate } from './useSWUpdate.js'
import './index.css'

function UpdateBanner() {
  const { updateReady, applyUpdate } = useSWUpdate()
  if (!updateReady) return null
  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
      background: '#1e293b', border: '1px solid rgba(212,168,83,.5)', color: '#f0e6d3',
      padding: '12px 16px', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', gap: 12, maxWidth: 'calc(100vw - 32px)',
      fontFamily: "'Nunito', system-ui, sans-serif", fontSize: 14, fontWeight: 700,
    }}>
      <span>✨ Hay una versión nueva</span>
      <button
        onClick={applyUpdate}
        style={{
          background: 'linear-gradient(135deg,#d4a853,#b8902e)', color: '#fff', border: 'none',
          borderRadius: 10, padding: '8px 16px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        Actualizar
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CatanApp />
      <UpdateBanner />
    </ErrorBoundary>
  </React.StrictMode>,
)
