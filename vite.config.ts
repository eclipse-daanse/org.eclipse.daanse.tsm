import { defineConfig } from 'vite'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: './demo',
  server: {
    port: 3000,
    open: true
  },
  resolve: {
    alias: {
      '/src': path.resolve(__dirname, 'src')
    }
  },
  plugins: [
    {
      name: 'serve-plugins',
      configureServer(server) {
        // Serve plugin fixtures under /plugins/
        server.middlewares.use('/plugins', (req, res, next) => {
          const pluginsPath = path.resolve(__dirname, 'src/__tests__/fixtures/plugins')
          servePlugins(pluginsPath, req, res)
        })

        // Serve second repo under /plugins2/
        server.middlewares.use('/plugins2', (req, res, next) => {
          const pluginsPath = path.resolve(__dirname, 'src/__tests__/fixtures/plugins2')
          servePlugins(pluginsPath, req, res)
        })

        function servePlugins(pluginsPath: string, req: any, res: any) {
          const requestedPath = path.join(pluginsPath, req.url || '/')

          // Security check
          if (!requestedPath.startsWith(pluginsPath)) {
            res.statusCode = 403
            res.end('Forbidden')
            return
          }

          // Check if path exists
          if (!fs.existsSync(requestedPath)) {
            res.statusCode = 404
            res.end('Not Found')
            return
          }

          const stats = fs.statSync(requestedPath)

          // If directory, serve index.json or manifest.json
          let filePath = requestedPath
          if (stats.isDirectory()) {
            const indexPath = path.join(requestedPath, 'index.json')
            const manifestPath = path.join(requestedPath, 'manifest.json')

            if (fs.existsSync(indexPath)) {
              filePath = indexPath
            } else if (fs.existsSync(manifestPath)) {
              filePath = manifestPath
            } else {
              res.statusCode = 404
              res.end('Not Found')
              return
            }
          }

          // Determine content type
          const ext = path.extname(filePath).toLowerCase()
          const contentTypes: Record<string, string> = {
            '.json': 'application/json',
            '.js': 'application/javascript',
            '.mjs': 'application/javascript'
          }

          const contentType = contentTypes[ext] || 'application/octet-stream'

          // Read and serve
          const content = fs.readFileSync(filePath)
          res.setHeader('Content-Type', contentType)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.end(content)
        }
      }
    }
  ]
})
