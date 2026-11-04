import { defineConfig, mergeConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import base from './vite.config.js'

// The Windows app's page only, with relative paths for the app's own address. No service worker or OCR files: public/ stays out.
export default mergeConfig(base, defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-desktop',
    rolldownOptions: { input: fileURLToPath(new URL('./desktop.html', import.meta.url)) },
  },
  server: { port: 5192, strictPort: true },
}))
