// frontend/vite.config.js
import process from 'node:process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Gemeinsames Header-Modul (CommonJS, auch von server.js genutzt)
const require = createRequire(import.meta.url)
const {
  renderHtaccess,
  frontendHeaders,
  extraConnectSrcFromEnv,
} = require('../services/securityHeaders.js')
const HTACCESS_TEMPLATE = fileURLToPath(new URL('./.htaccess.template', import.meta.url))

// Erzeugt dist/.htaccess aus .htaccess.template (SPA-Rewrite + Security-Header).
// VITE_CSP_REPORT_ONLY=1 setzt Content-Security-Policy-Report-Only statt der scharfen CSP.
function skmHtaccessPlugin({ base, env }) {
  return {
    name: 'skm-htaccess',
    apply: 'build',
    generateBundle() {
      const template = fs.readFileSync(HTACCESS_TEMPLATE, 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: '.htaccess',
        source: renderHtaccess(template, {
          base: base.replace(/\/+$/, ''),
          extraConnectSrc: extraConnectSrcFromEnv(env),
          reportOnly: env.VITE_CSP_REPORT_ONLY === '1',
        }),
      })
    },
  }
}

// Fallback auf Root '/', Produktionsbuild kann VITE_BASE=/SKM/ setzen
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/').replace(/\/+$/, '/') // sichert endenden Slash
  const devProxyTargetRaw = (env.VITE_DEV_PROXY_TARGET || '').trim()
  const devProxyTarget = devProxyTargetRaw || `http://localhost:${env.BACKEND_PORT || env.PORT || 3000}`
  const devProxyIsHttps = /^https:/i.test(devProxyTarget)
  return {
    base,
    plugins: [react(), skmHtaccessPlugin({ base, env })],
    // vite preview mit denselben Headern wie Produktion (ohne HSTS, da http).
    // Kein CSP im Dev-Server: HMR braucht Inline-Script und WebSocket.
    preview: {
      headers: frontendHeaders({
        extraConnectSrc: extraConnectSrcFromEnv(env, { includeLocal: true }),
        reportOnly: env.VITE_CSP_REPORT_ONLY === '1',
      }),
    },
    server: {
      proxy: {
        '/horizon': {
          target: 'https://horizon.stellar.org',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/horizon/, ''),
        },
        '/expert': {
          target: 'https://api.stellar.expert',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/expert/, ''),
        },
        // Proxy backend API during development so /api/* works from Vite dev server
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          secure: !devProxyIsHttps ? false : true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 5000,
    },
    test: {
      environment: 'jsdom',
      setupFiles: 'src/test/setupTests.js',
      globals: true,
      css: true,
    },
  }
})
