import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The bundle sources in examples/ import the package by name, as a deployed
  // module does; here that resolves to the sources under test
  resolve: {
    alias: {
      '@eclipse-daanse/tsm/decorators': resolve(__dirname, 'src/decorators.ts'),
      '@eclipse-daanse/tsm/devtools': resolve(__dirname, 'src/devtools/index.ts'),
      '@eclipse-daanse/tsm/vite': resolve(__dirname, 'src/vite/index.ts'),
      '@eclipse-daanse/tsm': resolve(__dirname, 'src/index.ts')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // The schema-to-type inference is only provable by a type check, so those
    // assertions live in *.test-d.ts and run through `npm run typecheck:types`
    typecheck: {
      include: ['src/__tests__/**/*.test-d.ts'],
      tsconfig: 'tsconfig.types.json'
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts']
    }
  }
})