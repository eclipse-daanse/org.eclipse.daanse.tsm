/**
 * Plugin Bundle - Vite Config
 *
 * Das Plugin EXTERNALISIERT alle Shared Libraries und nutzt
 * tsm: Imports die zur Build-Zeit zu __tsm__.require() transformiert werden.
 *
 * WICHTIG: Das Plugin bündelt NICHT Vue, PrimeVue etc.!
 * Diese werden zur Runtime vom Host bereitgestellt.
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { tsmPlugin } from 'tsm/vite'

export default defineConfig({
  plugins: [
    // Vue SFC Compiler
    vue(),

    // TSM Plugin: transformiert Imports zu __tsm__.require()
    //
    // Mit sharedModules werden auch bare imports transformiert:
    //   import { ref } from 'vue'           → __tsm__.require('vue')
    //   import { openBlock } from 'vue'     → __tsm__.require('vue')  (SFC-generiert)
    //   import Button from 'primevue/button' → __tsm__.require('primevue/button')
    //
    tsmPlugin({
      sharedModules: ['vue', 'vue-router', 'primevue']
    })
  ],

  build: {
    // Als ES Module Library bauen
    lib: {
      entry: 'src/index.ts',
      name: 'MyPlugin',
      fileName: 'index',
      formats: ['es']  // Nur ES Module für dynamic import()
    },

    rollupOptions: {
      // ============================================================
      // EXTERNAL - Das ist der wichtigste Teil!
      // ============================================================
      // Alles was hier steht wird NICHT gebündelt, sondern
      // als externer Import belassen.
      //
      external: [
        // ----- Vue Ecosystem -----
        'vue',
        'vue-router',
        /^vue\/.*/,           // vue/reactivity, vue/runtime-core, etc.
        /^@vue\/.*/,          // @vue/runtime-core, @vue/reactivity, etc.

        // ----- PrimeVue -----
        'primevue',
        /^primevue\/.*/,      // primevue/button, primevue/dialog, etc.
        /^@primevue\/.*/,     // @primevue/core, etc.

        // ----- TSM -----
        'tsm',
        /^tsm\/.*/,           // tsm/vite, etc.

        // ----- tsm: Imports -----
        // Diese werden vom tsmPlugin transformiert, aber
        // wir markieren sie trotzdem als external für den Fall
        // dass die Transformation nicht greift
        /^tsm:/
      ],

      output: {
        // Keine Globals nötig für ES Module
        // Aber falls jemand UMD braucht:
        globals: {
          'vue': 'Vue',
          'vue-router': 'VueRouter',
          'primevue': 'PrimeVue'
        },

        // Preserve module structure
        preserveModules: false,

        // Export-Format
        exports: 'named'
      }
    },

    // Kein Minify für besseres Debugging (optional)
    minify: false,

    // Sourcemaps für Debugging
    sourcemap: true,

    // Output-Verzeichnis
    outDir: 'dist',

    // Leere dist vor Build
    emptyOutDir: true
  },

  // Keine Optimierung für Library-Mode
  optimizeDeps: {
    exclude: ['vue', 'vue-router', 'primevue']
  }
})