import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json'
}

/**
 * Serves the built bundles under /bundles as plain files.
 *
 * They must not go through Vite's transform pipeline: they are finished
 * artefacts that the loader fetches by URL, exactly as a web server would hand
 * them over in production. Putting them in `public/` does not work — Vite
 * refuses dynamic imports from there.
 */
function serveBundles(): Plugin {
  return {
    name: 'serve-built-bundles',
    configureServer(server) {
      server.middlewares.use('/bundles', (request, response, next) => {
        const relative = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]))
        if (relative.includes('..')) return next()

        const file = join(__dirname, 'dist-bundles', relative)

        void stat(file)
          .then(stats => {
            if (!stats.isFile()) return next()
            response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
            createReadStream(file).pipe(response)
          })
          .catch(() => next())
      })
    }
  }
}

/** Runs against the package sources, so the example moves with the code */
export default defineConfig({
  root: __dirname,
  plugins: [serveBundles()],
  server: {
    port: 5181,
    fs: { allow: ['../..'] }
  },
  esbuild: { target: 'es2022' }
})
