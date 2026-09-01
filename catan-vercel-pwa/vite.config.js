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

// URL absoluta del sitio, para og:image (los scrapers de WhatsApp/Twitter no
// resuelven bien las relativas). Se toma, en orden: VITE_SITE_URL si se seteó a
// mano, el dominio de producción que expone Vercel, la URL del deploy puntual
// (útil en previews) y, si no hay nada, se cae a una URL relativa — que es
// peor para los scrapers pero no queda roto como un placeholder sin resolver.
const siteUrl = () => {
  const explicit = process.env.VITE_SITE_URL || process.env.SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return ''
}

const injectSiteUrl = () => ({
  name: 'inject-site-url',
  transformIndexHtml(html) {
    return html.replaceAll('%SITE_URL%', siteUrl())
  },
})

export default defineConfig({
  plugins: [react(), injectSiteUrl(), stampServiceWorker()],
})
