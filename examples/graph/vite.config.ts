import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = resolve(__dirname, '../..')

/** Runs against the package sources, so the example moves with the code */
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@eclipse-daanse/tsm/decorators': resolve(root, 'src/decorators.ts'),
      '@eclipse-daanse/tsm/devtools': resolve(root, 'src/devtools/index.ts'),
      '@eclipse-daanse/tsm': resolve(root, 'src/index.ts')
    }
  },
  server: {
    port: 5182,
    fs: { allow: ['../..'] }
  },
  esbuild: { target: 'es2022' }
})
