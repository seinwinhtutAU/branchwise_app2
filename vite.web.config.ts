import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain web build of the renderer, for hosting on Vercel/etc. as a browser SPA.
// Separate from electron.vite.config.ts, which also builds the Electron main/preload
// processes that don't apply to a browser deploy.
export default defineConfig({
  root: 'frontend/renderer',
  envDir: resolve('.'),
  resolve: {
    alias: {
      '@renderer': resolve('frontend/renderer/src')
    }
  },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true
  },
  plugins: [react()]
})
