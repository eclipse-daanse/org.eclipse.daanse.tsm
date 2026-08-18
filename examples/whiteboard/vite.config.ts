import { defineConfig } from 'vite'

/**
 * Runs against the package sources rather than a build, so the example moves
 * with the code. `fs.allow` covers the repository root for that reason.
 */
export default defineConfig({
  root: __dirname,
  server: {
    port: 5180,
    fs: { allow: ['../..'] }
  },
  esbuild: {
    target: 'es2022'
  }
})
