/**
 * App Bundle - Vite Config
 *
 * Das App-Bundle BÜNDELT alle Shared Libraries (Vue, PrimeVue, etc.)
 * Diese werden dann via __tsm__.register() für Plugins bereitgestellt.
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'

// Plugin um /plugins/* aus dem plugins-Ordner zu servieren
function servePlugins() {
  return {
    name: 'serve-plugins',
    configureServer(server: any) {
      server.middlewares.use('/plugins', (req: any, res: any, next: any) => {
        const filePath = resolve(__dirname, 'plugins', req.url.slice(1) || 'index.json')

        if (existsSync(filePath)) {
          const content = readFileSync(filePath)
          const ext = filePath.split('.').pop()

          const mimeTypes: Record<string, string> = {
            'json': 'application/json',
            'js': 'application/javascript',
            'mjs': 'application/javascript'
          }

          res.setHeader('Content-Type', mimeTypes[ext || ''] || 'text/plain')
          res.end(content)
        } else {
          next()
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), servePlugins()],

  build: {
    // Output-Verzeichnis
    outDir: 'dist',

    // App Bundle bündelt ALLES - keine externals!
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },

      output: {
        // Vendor Chunks für besseres Caching
        manualChunks: {
          // Vue Ecosystem in eigenem Chunk
          'vendor-vue': ['vue', 'vue-router'],

          // PrimeVue in eigenem Chunk
          'vendor-primevue': [
            'primevue',
            'primevue/button',
            'primevue/dialog',
            'primevue/datatable',
            'primevue/column',
            'primevue/inputtext',
            '@primeuix/themes'
          ],

          // TSM Core
          'vendor-tsm': ['tsm']
        },

        // Chunk-Naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },

    // Sourcemaps für Production Debugging
    sourcemap: true
  },

  // Optimierung: Pre-bundle Dependencies
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'primevue',
      'primevue/button',
      'primevue/dialog',
      'primevue/datatable',
      'tsm'
    ]
  },

  // Dev Server
  server: {
    port: 3000,
    open: true
  }
})
