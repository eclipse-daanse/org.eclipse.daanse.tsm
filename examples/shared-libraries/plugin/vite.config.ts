/**
 * Plugin bundle — Vite config
 *
 * The plugin bundles none of the shared libraries. Vue, Vue Router and PrimeVue
 * come from the host at runtime; the plugin only imports them.
 *
 * What decides that is the **manifest**: `createTsmExternals(manifest)` reads its
 * `sharedDependencies`, so the declaration the loader validates and the build that
 * has to honour it are the same sentence. Passing the manifest to `tsmPlugin` adds
 * the check in the other direction — the build fails if one of those libraries
 * ends up in the bundle after all, which would give this plugin its own copy of
 * Vue and thus a second reactivity system.
 */

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { tsmPlugin, createTsmExternals } from 'tsm/vite'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [
    vue(),

    // Transforms bare imports into `__tsm__.require()`:
    //   import { ref } from 'vue'            → __tsm__.require('vue')
    //   import Button from 'primevue/button' → __tsm__.require('primevue/button')
    //
    // With an import map instead (see SPEC 6.3) this transform is unnecessary —
    // the import stays an import and the host only supplies the URL.
    tsmPlugin({
      manifest,
      sharedModules: ['vue', 'vue-router', 'primevue']
    })
  ],

  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MyPlugin',
      fileName: 'index',
      formats: ['es']
    },

    rollupOptions: {
      external: createTsmExternals(manifest, {
        // Packages the shared libraries bring along without this plugin importing
        // them by name. They do not belong in the manifest — the plugin depends on
        // `vue`, not on `@vue/runtime-core`.
        alwaysExternal: ['@vue', '@primevue']
      })
    },

    minify: false,
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true
  },

  optimizeDeps: {
    exclude: ['vue', 'vue-router', 'primevue']
  }
})
