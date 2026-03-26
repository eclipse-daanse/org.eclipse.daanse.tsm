/**
 * Test HTTP Server for integration testing
 */

import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'

export interface TestServerOptions {
  port?: number
  basePath: string
}

export class TestServer {
  private server: http.Server | null = null
  private port: number
  private basePath: string

  constructor(options: TestServerOptions) {
    this.port = options.port ?? 0 // 0 = auto-assign
    this.basePath = options.basePath
  }

  /**
   * Start the server
   */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.on('error', reject)

      this.server.listen(this.port, () => {
        const address = this.server!.address()
        if (typeof address === 'object' && address) {
          this.port = address.port
          resolve(`http://localhost:${this.port}`)
        } else {
          reject(new Error('Failed to get server address'))
        }
      })
    })
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }

      this.server.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`
  }

  /**
   * Handle incoming requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/'

    // Parse the path
    let filePath = path.join(this.basePath, url)

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.basePath)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    // If directory, look for index.json or manifest.json
    const stats = fs.statSync(filePath)
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.json')
      const manifestPath = path.join(filePath, 'manifest.json')

      if (fs.existsSync(indexPath)) {
        filePath = indexPath
      } else if (fs.existsSync(manifestPath)) {
        filePath = manifestPath
      } else {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
    }

    // Determine content type
    const ext = path.extname(filePath).toLowerCase()
    const contentTypes: Record<string, string> = {
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.ts': 'application/typescript',
      '.html': 'text/html',
      '.css': 'text/css'
    }

    const contentType = contentTypes[ext] ?? 'application/octet-stream'

    // Read and serve file
    try {
      const content = fs.readFileSync(filePath)

      // Add CORS headers for module loading
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content)
    } catch (error) {
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  }
}

/**
 * Create and start a test server
 */
export async function createTestServer(basePath: string): Promise<TestServer> {
  const server = new TestServer({ basePath })
  await server.start()
  return server
}