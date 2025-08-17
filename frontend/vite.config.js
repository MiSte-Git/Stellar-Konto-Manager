// frontend/vite.config.js
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE dynamisch lesen, Fallback auf /STM/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = (env.VITE_BASE || '/STM/').replace(/\/+$/, '/') // sichert endenden Slash
  return {
    base,
    plugins: [react()],
  }
})
