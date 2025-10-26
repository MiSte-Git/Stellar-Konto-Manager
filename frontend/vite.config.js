/* eslint-env node */
// frontend/vite.config.js
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE dynamisch lesen, Fallback auf /STM/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/STM/').replace(/\/+$/, '/') // sichert endenden Slash
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
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
