/* eslint-env node */
// frontend/vite.config.js
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Fallback auf Root '/', Produktionsbuild kann VITE_BASE=/SKM/ setzen
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/').replace(/\/+$/, '/') // sichert endenden Slash
  const devProxyTargetRaw = (env.VITE_DEV_PROXY_TARGET || '').trim()
  const devProxyTarget = devProxyTargetRaw || `http://localhost:${env.BACKEND_PORT || env.PORT || 3000}`
  const devProxyIsHttps = /^https:/i.test(devProxyTarget)
  return {
    base,
    plugins: [react()],
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
    test: {
      environment: 'jsdom',
      setupFiles: 'src/test/setupTests.js',
      globals: true,
      css: true,
    },
  }
})
