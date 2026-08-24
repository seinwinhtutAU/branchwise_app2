import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'frontend/main/index.ts'
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: 'frontend/preload/index.ts'
      }
    }
  },
  renderer: {
    root: 'frontend/renderer',
    envDir: resolve('.'),
    resolve: {
      alias: {
        '@renderer': resolve('frontend/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: resolve('frontend/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
