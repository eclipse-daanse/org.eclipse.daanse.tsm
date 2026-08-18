import { defineConfig } from 'vite'

/** Runs against the package sources, so the example moves with the code */
export default defineConfig({
  root: __dirname,
  server: {
    port: 5181,
    fs: { allow: ['../..'] }
  },
  esbuild: { target: 'es2022' }
})
