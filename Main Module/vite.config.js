import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/ABCRM/' : '/',
  // Dropdowns everywhere put recent and most used choices first (src/jsx).
  plugins: [react({ jsxImportSource: '@crm-jsx' })],
  resolve: {
    // Sibling module folders that the app imports directly.
    alias: {
      '@crm-jsx': fileURLToPath(new URL('./src/jsx', import.meta.url)),
      '@hot-alerts': fileURLToPath(new URL('../Hot Alerts Module', import.meta.url)),
      '@dashboard': fileURLToPath(new URL('../Dashboard Module', import.meta.url)),
      '@integrations': fileURLToPath(new URL('../Integrations Module', import.meta.url)),
      '@ceo-agent': fileURLToPath(new URL('../CEO Agent Module', import.meta.url)),
      '@calendar': fileURLToPath(new URL('../Calendar Module', import.meta.url)),
      '@email-agent': fileURLToPath(new URL('../Agent Module/13_EMail_Agent', import.meta.url)),
      '@business-development': fileURLToPath(new URL('../Business Development Module', import.meta.url)),
      '@template-hub': fileURLToPath(new URL('../Template Module', import.meta.url)),
      '@banking': fileURLToPath(new URL('../Banking Module', import.meta.url)),
      '@client-module': fileURLToPath(new URL('../Client Module', import.meta.url)),
      '@accounting': fileURLToPath(new URL('../Accounting Module', import.meta.url)),
      '@business-setup': fileURLToPath(new URL('../Business Setup Module', import.meta.url)),
      // The Template Hub lives outside this app folder, so resolve its
      // dependencies from the host app's node_modules.
      'pizzip': fileURLToPath(new URL('./node_modules/pizzip/js/index.js', import.meta.url)),
      'docxtemplater': fileURLToPath(new URL('./node_modules/docxtemplater/js/docxtemplater.js', import.meta.url)),
      'jszip': fileURLToPath(new URL('./node_modules/jszip/lib/index.js', import.meta.url)),
      'file-saver': fileURLToPath(new URL('./node_modules/file-saver/dist/FileSaver.min.js', import.meta.url)),
      'xlsx': fileURLToPath(new URL('./node_modules/xlsx/xlsx.mjs', import.meta.url)),
      // Lets those modules reuse this app's shared code (charts, Supabase client, helpers).
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Those folders have no node_modules; resolve shared packages from this app.
    dedupe: ['react', 'react-dom', '@supabase/supabase-js'],
  },
})
