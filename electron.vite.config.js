import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},

  preload: {},

  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer')
      }
    },
    plugins: [vue()],
    css: {
      preprocessorOptions: {
        less: {
          globalVars: {
            'main-color': '#21252b',
            'primary-color': '#2486d8',
            'success-color': '#6ba368',
            'danger-color': '#e71d36'
          }
        }
      }
    }
  }
})
