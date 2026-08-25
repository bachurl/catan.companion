import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Estampa un id de build en dist/sw.js para que cada deploy genere un
// service worker distinto y el navegador detecte la actualización.
const stampServiceWorker = () => ({
  name: 'stamp-service-worker',
  apply: 'build',
  closeBundle() {
    const swPath = resolve(__dirname, 'dist/sw.js')
    try {
      const src = readFileSync(swPath, 'utf8')
      writeFileSync(swPath, src.replaceAll('__BUILD_ID__', String(Date.now())))
    } catch (e) {
      console.warn('stamp-service-worker: no se pudo estampar dist/sw.js', e.message)
    }
  },
})

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
})
