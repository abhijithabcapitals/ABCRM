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
      '@dashboard': fileURLToPath(new URL('../Dashboard Module', import.meta.url)),
      '@integrations': fileURLToPath(new URL('../Integrations Module', import.meta.url)),
      '@document-generator': fileURLToPath(new URL('../Document Generator', import.meta.url)),
      // The Document Generator lives outside this app folder, so resolve its
      // dependencies from the host app's node_modules.
      'pizzip': fileURLToPath(new URL('./node_modules/pizzip/js/index.js', import.meta.url)),
      'docxtemplater': fileURLToPath(new URL('./node_modules/docxtemplater/js/docxtemplater.js', import.meta.url)),
      'jszip': fileURLToPath(new URL('./node_modules/jszip/lib/index.js', import.meta.url)),
      'file-saver': fileURLToPath(new URL('./node_modules/file-saver/dist/FileSaver.min.js', import.meta.url)),
      'xlsx': fileURLToPath(new URL('./node_modules/xlsx/xlsx.mjs', import.meta.url)),
      // Lets those modules reuse this app's shared code (charts, Supabase client, helpers).
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Those folders have no node_modules; resolve React from this app.
    dedupe: ['react', 'react-dom'],
  },
})
