import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/ABCRM/' : '/',
  plugins: [react()],
  resolve: {
    // Sibling module folders that the app imports directly.
    alias: {
      '@hot-alerts': fileURLToPath(new URL('../Hot Alerts Module', import.meta.url)),
    },
    // Those folders have no node_modules; resolve React from this app.
    dedupe: ['react', 'react-dom'],
  },
})
