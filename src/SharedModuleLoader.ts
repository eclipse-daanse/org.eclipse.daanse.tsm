/**
 * SharedModuleLoader - Manages shared modules between host and plugins
 *
 * Shared modules are loaded once by the host and made available to plugins.
 * This prevents duplicate instances and enables singleton patterns.
 */

import type { SharedModuleConfig, SharedModuleLoaderOptions, ModuleLogger } from './types.js'

// Global namespace for shared modules
declare global {
  interface Window {
    __TSM_SHARED__: Record<string, unknown>
  }
}

/**
 * Default logger that does nothing
 */
const nullLogger: ModuleLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

/**
 * SharedModuleLoader manages shared modules that are available to all plugins
 */
export class SharedModuleLoader {
  private modules: Map<string, SharedModuleConfig> = new Map()
  private loaded: Map<string, unknown> = new Map()
  private logger: ModuleLogger
  private initialized = false

  constructor(options: SharedModuleLoaderOptions = { modules: [] }) {
    this.logger = options.logger ?? nullLogger

    // Initialize global namespace
    if (typeof window !== 'undefined') {
      window.__TSM_SHARED__ = window.__TSM_SHARED__ || {}
    }

    // Register shared modules
    for (const config of options.modules) {
      this.modules.set(config.name, config)
    }
  }

  /**
   * Add a shared module configuration
   */
  addModule(config: SharedModuleConfig): void {
    this.modules.set(config.name, config)
  }

  /**
   * Load all shared modules
   * Call this before loading any plugins
   */
  async loadAll(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('Shared modules already initialized')
      return
    }

    this.logger.info(`Loading ${this.modules.size} shared modules...`)

    const promises: Promise<void>[] = []

    for (const [name, config] of this.modules) {
      promises.push(this.loadModule(name, config))
    }

    await Promise.all(promises)

    this.initialized = true
    this.logger.info('All shared modules loaded')
  }

  /**
   * Load a single shared module
   */
  private async loadModule(name: string, config: SharedModuleConfig): Promise<void> {
    try {
      this.logger.debug(`Loading shared module: ${name}`)

      const module = await config.factory()

      this.loaded.set(name, module)

      // Expose on global
      if (typeof window !== 'undefined') {
        window.__TSM_SHARED__[name] = module
      }

      this.logger.debug(`Shared module loaded: ${name}`)
    } catch (error) {
      this.logger.error(`Failed to load shared module: ${name}`, error)
      throw error
    }
  }

  /**
   * Get a loaded shared module
   */
  get<T = unknown>(name: string): T | undefined {
    return this.loaded.get(name) as T | undefined
  }

  /**
   * Check if a module is registered as shared
   */
  isShared(name: string): boolean {
    return this.modules.has(name)
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(name: string): boolean {
    return this.loaded.has(name)
  }

  /**
   * Get all shared module names
   */
  getSharedModuleNames(): string[] {
    return Array.from(this.modules.keys())
  }

  /**
   * Get the global require function for plugins
   * Plugins can use: const mod = __TSM_SHARED__['@gene/storage-core']
   */
  static getGlobal(name: string): unknown {
    if (typeof window !== 'undefined' && window.__TSM_SHARED__) {
      return window.__TSM_SHARED__[name]
    }
    return undefined
  }
}
