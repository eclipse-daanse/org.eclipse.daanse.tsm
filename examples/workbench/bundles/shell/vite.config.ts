import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { tsmPlugin } from '../../../../src/vite/index.js'

const root = resolve(__dirname, '../../../..')

/**
 * Builds this bundle on its own, the way a deployed module is built. `provides`
 * is not written by hand: `components: 'derive'` reads the `@component()`
 * declarations and emits a manifest with them.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@eclipse-daanse/tsm/decorators': resolve(root, 'src/decorators.ts'),
      '@eclipse-daanse/tsm': resolve(root, 'src/index.ts')
    }
  },
  plugins: [
    tsmPlugin({
      manifest: resolve(__dirname, 'manifest.json'),
      components: 'derive',
      // The bundle imports nothing through the tsm: scheme
      strict: false,
      // The contract sits outside every bundle on purpose; the tsm sources come
      // in through an alias here, where a deployed build resolves them from
      // node_modules
      boundary: { allow: ['../contracts.ts', '../../../../src'] }
    })
  ],
  build: {
    target: 'es2022',
    minify: false,
    outDir: resolve(__dirname, '../../dist-bundles/shell'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js'
    }
  }
})
