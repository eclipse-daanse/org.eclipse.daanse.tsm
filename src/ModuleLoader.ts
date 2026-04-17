/**
 * TSM - TypeScript Module System
 * Module Loader - Core module loading and lifecycle management
 */

import type {
  ModuleManifest,
  ModuleLoaderOptions,
  LoadedModule,
  ModuleContext,
  ModuleLifecycle,
  ModuleEvent,
  ModuleEventListener,
  ModuleLogger,
  ServiceRegistry
} from './types.js'
import { DependencyResolver } from './DependencyResolver.js'
import { DefaultServiceRegistry } from './ServiceRegistry.js'
import { isTsmRuntimeAvailable, tsmRuntime } from './TsmRuntime.js'

// Type for Module Federation containers
declare global {
  interface Window {
    [key: string]: ModuleFederationContainer | undefined
  }
}

interface ModuleFederationContainer {
  get(module: string): Promise<() => unknown>
  init(shareScope: unknown): Promise<void>
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<ModuleLoaderOptions> = {
  loadTimeout: 10000,
  continueOnError: true,
  hotReload: false,
  serviceRegistry: undefined as unknown as ServiceRegistry,
  logger: undefined as unknown as ModuleLogger
}

/**
 * Console logger implementation
 */
class ConsoleLogger implements ModuleLogger {
  constructor(private prefix: string = '[TSM]') {}

  debug(message: string, ...args: unknown[]): void {
    console.debug(`${this.prefix} ${message}`, ...args)
  }
  info(message: string, ...args: unknown[]): void {
    console.info(`${this.prefix} ${message}`, ...args)
  }
  warn(message: string, ...args: unknown[]): void {
    console.warn(`${this.prefix} ${message}`, ...args)
  }
  error(message: string, ...args: unknown[]): void {
    console.error(`${this.prefix} ${message}`, ...args)
  }
}

/**
 * Main module loader class
 */
export class ModuleLoader {
  private modules = new Map<string, LoadedModule>()
  private manifests = new Map<string, ModuleManifest>()
  private listeners = new Set<ModuleEventListener>()
  private resolver = new DependencyResolver()
  private options: Required<ModuleLoaderOptions>
  private services: ServiceRegistry
  private logger: ModuleLogger

  constructor(options: ModuleLoaderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.services = options.serviceRegistry ?? new DefaultServiceRegistry()
    this.logger = options.logger ?? new ConsoleLogger()
  }

  /**
   * Register module manifests
   */
  register(manifests: ModuleManifest[]): void {
    for (const manifest of manifests) {
      this.manifests.set(manifest.id, manifest)
      this.emit({
        type: 'registering',
        moduleId: manifest.id,
        manifest,
        timestamp: new Date()
      })
    }
  }

  /**
   * Load all registered modules in dependency order
   */
  async loadAll(): Promise<void> {
    const manifests = Array.from(this.manifests.values())

    // Resolve dependencies
    const resolution = this.resolver.resolve(manifests)

    // Log warnings
    if (resolution.circular.length > 0) {
      this.logger.warn('Circular dependencies detected:', resolution.circular)
    }
    if (resolution.missing.length > 0) {
      this.logger.warn('Missing dependencies:', resolution.missing)
    }

    // Load in order
    this.logger.info(`Loading ${resolution.loadOrder.length} module(s)...`)

    for (const manifest of resolution.loadOrder) {
      try {
        await this.loadModule(manifest)
      } catch (error) {
        this.logger.error(`Failed to load module ${manifest.id}:`, error)
        if (!this.options.continueOnError) {
          throw error
        }
      }
    }
  }

  /**
   * Load a single module
   */
  async loadModule(manifest: ModuleManifest): Promise<LoadedModule> {
    // Check if already loaded
    const existing = this.modules.get(manifest.id)
    if (existing && existing.state === 'active') {
      return existing
    }

    // Create module entry
    const loadedModule: LoadedModule = {
      manifest,
      state: 'resolving',
      exports: new Map(),
      loadedAt: new Date()
    }
    this.modules.set(manifest.id, loadedModule)

    try {
      // Check dependencies are loaded
      await this.ensureDependencies(manifest)

      // Check shared library dependencies
      this.validateSharedDependencies(manifest)

      // Load the module
      loadedModule.state = 'loading'
      this.emit({
        type: 'loading',
        moduleId: manifest.id,
        manifest,
        timestamp: new Date()
      })

      await this.doLoad(loadedModule)

      loadedModule.state = 'activating'
      this.emit({
        type: 'loaded',
        moduleId: manifest.id,
        manifest,
        timestamp: new Date()
      })

      // Activate
      await this.activate(loadedModule)

      loadedModule.state = 'active'
      this.emit({
        type: 'activated',
        moduleId: manifest.id,
        manifest,
        timestamp: new Date()
      })

      this.logger.info(`Module ${manifest.id} activated`)
      return loadedModule

    } catch (error) {
      loadedModule.state = 'error'
      loadedModule.error = error as Error
      this.emit({
        type: 'error',
        moduleId: manifest.id,
        manifest,
        error: error as Error,
        timestamp: new Date()
      })
      throw error
    }
  }

  /**
   * Ensure all dependencies are loaded
   */
  private async ensureDependencies(manifest: ModuleManifest): Promise<void> {
    for (const dep of manifest.dependencies ?? []) {
      const depId = typeof dep === 'string' ? dep : dep.id
      if (!this.isLoaded(depId)) {
        const depManifest = this.manifests.get(depId)
        if (!depManifest) {
          throw new Error(`Missing dependency: ${depId}`)
        }
        await this.loadModule(depManifest)
      }
    }
  }

  /**
   * Validate that all shared library dependencies are available
   * Shared libraries are provided by the host via __tsm__.register()
   */
  private validateSharedDependencies(manifest: ModuleManifest): void {
    const sharedDeps = manifest.sharedDependencies
    if (!sharedDeps || sharedDeps.length === 0) {
      return
    }

    // Check if TSM runtime is available
    if (!isTsmRuntimeAvailable()) {
      throw new Error(
        `Module '${manifest.id}' requires shared libraries (${sharedDeps.map(d => d.id).join(', ')}), ` +
        `but TSM runtime is not initialized. ` +
        `Call initTsmRuntime() and register shared libraries before loading modules.`
      )
    }

    // Validate each shared dependency
    const validation = tsmRuntime.validate(sharedDeps)

    if (!validation.valid) {
      const errors: string[] = []

      if (validation.missing.length > 0) {
        errors.push(
          `Missing shared libraries: ${validation.missing.join(', ')}`
        )
      }

      if (validation.incompatible.length > 0) {
        for (const inc of validation.incompatible) {
          errors.push(
            `Incompatible version for '${inc.id}': ` +
            `requires ${inc.required}, but ${inc.available} is available`
          )
        }
      }

      throw new Error(
        `Module '${manifest.id}' has unmet shared library dependencies:\n` +
        errors.map(e => `  - ${e}`).join('\n') +
        `\n\nAvailable shared libraries:\n` +
        Array.from(tsmRuntime.getRegistered().entries())
          .map(([id, info]) => `  - ${id}@${info.version}`)
          .join('\n')
      )
    }

    this.logger.debug(
      `Module ${manifest.id}: shared dependencies validated`,
      sharedDeps.map(d => `${d.id}@${d.versionRange}`)
    )
  }

  /**
   * Actually load the module entry point
   */
  private async doLoad(loadedModule: LoadedModule): Promise<void> {
    const { manifest } = loadedModule

    // Dynamic import of the entry point
    const entryModule = await this.loadEntry(manifest.id, manifest.entry)

    // Store container reference (raw ES module for require())
    loadedModule.container = entryModule

    // Check entry module for lifecycle hooks
    if (entryModule && typeof entryModule === 'object') {
      const moduleObj = entryModule as Record<string, unknown>

      // Check direct exports (activate, deactivate functions)
      if (
        typeof moduleObj.activate === 'function' ||
        typeof moduleObj.deactivate === 'function'
      ) {
        loadedModule.lifecycle = moduleObj as ModuleLifecycle
      }

      // Also check default export
      if (moduleObj.default && typeof moduleObj.default === 'object') {
        const defaultExport = moduleObj.default as Record<string, unknown>
        if (
          typeof defaultExport.activate === 'function' ||
          typeof defaultExport.deactivate === 'function'
        ) {
          loadedModule.lifecycle = defaultExport as ModuleLifecycle
        }
      }
    }

    // Load each export defined in manifest (if any)
    for (const [exportPath] of Object.entries(manifest.exports ?? {})) {
      try {
        const exported = await this.loadExport(manifest.id, exportPath)
        loadedModule.exports.set(exportPath, exported)
      } catch (error) {
        this.logger.warn(`Failed to load export ${exportPath} from ${manifest.id}:`, error)
      }
    }
  }

  /**
   * Load module entry point via dynamic import
   */
  private async loadEntry(moduleId: string, entryUrl: string): Promise<unknown> {
    // Check if already loaded (for MF remotes)
    if (window[moduleId]) {
      return window[moduleId]
    }

    try {
      // Dynamic import
      const module = await import(/* @vite-ignore */ entryUrl)

      // Store in window for MF compatibility
      if (module.default) {
        window[moduleId] = module.default
        return module.default
      }

      window[moduleId] = module
      return module

    } catch (error) {
      throw new Error(`Failed to load module entry: ${entryUrl} - ${error}`)
    }
  }

  /**
   * Load a specific export from a module
   */
  private async loadExport(moduleId: string, exportPath: string): Promise<unknown> {
    const container = window[moduleId] as ModuleFederationContainer | undefined

    if (container && typeof container.get === 'function') {
      // Module Federation style
      const factory = await container.get(exportPath)
      return factory()
    }

    // Already loaded as regular module
    const loadedModule = this.modules.get(moduleId)
    if (loadedModule?.exports.has(exportPath)) {
      return loadedModule.exports.get(exportPath)
    }

    throw new Error(`Export ${exportPath} not found in module ${moduleId}`)
  }

  /**
   * Activate a module (call lifecycle hook)
   */
  private async activate(loadedModule: LoadedModule): Promise<void> {
    const manifest = loadedModule.manifest

    // Check required services before activation
    if (manifest.requiresService && manifest.requiresService.length > 0) {
      const { satisfied, missing } = this.services.checkRequirements(manifest.requiresService)
      if (!satisfied) {
        const error = new Error(
          `Module ${manifest.id} requires services that are not available: ${missing.join(', ')}`
        )
        loadedModule.state = 'error'
        loadedModule.error = error
        this.emit({
          type: 'error',
          moduleId: manifest.id,
          manifest,
          error,
          timestamp: new Date()
        })
        throw error
      }
    }

    this.emit({
      type: 'activating',
      moduleId: manifest.id,
      manifest,
      timestamp: new Date()
    })

    if (loadedModule.lifecycle?.activate) {
      const context = this.createContext(loadedModule)
      await loadedModule.lifecycle.activate(context)
    }

    // Log provided services after activation
    if (manifest.provides && manifest.provides.length > 0) {
      for (const service of manifest.provides) {
        if (this.services.has(service.id)) {
          this.logger.info(`Module ${manifest.id} provides service: ${service.id} (${service.scope ?? 'singleton'})`)
        } else {
          this.logger.warn(`Module ${manifest.id} declared service ${service.id} but did not register it`)
        }
      }
    }
  }

  /**
   * Deactivate a module
   */
  private async deactivate(loadedModule: LoadedModule): Promise<void> {
    this.emit({
      type: 'deactivating',
      moduleId: loadedModule.manifest.id,
      manifest: loadedModule.manifest,
      timestamp: new Date()
    })

    loadedModule.state = 'deactivating'

    if (loadedModule.lifecycle?.deactivate) {
      const context = this.createContext(loadedModule)
      await loadedModule.lifecycle.deactivate(context)
    }

    loadedModule.state = 'stopped'

    this.emit({
      type: 'deactivated',
      moduleId: loadedModule.manifest.id,
      manifest: loadedModule.manifest,
      timestamp: new Date()
    })
  }

  /**
   * Create module context for lifecycle hooks
   */
  private createContext(loadedModule: LoadedModule): ModuleContext {
    return {
      manifest: loadedModule.manifest,
      getModule: <T>(moduleId: string) => this.getModuleExports<T>(moduleId),
      isModuleLoaded: (moduleId: string) => this.isLoaded(moduleId),
      services: this.services,
      log: new ConsoleLogger(`[${loadedModule.manifest.id}]`)
    }
  }

  /**
   * Unload a module
   */
  async unloadModule(moduleId: string): Promise<boolean> {
    const loadedModule = this.modules.get(moduleId)
    if (!loadedModule) return false

    // Check for dependents
    const dependents = this.resolver.getDependents(
      moduleId,
      Array.from(this.manifests.values())
    )

    const loadedDependents = dependents.filter(d => this.isLoaded(d))
    if (loadedDependents.length > 0) {
      this.logger.warn(
        `Cannot unload ${moduleId}: modules depend on it:`,
        loadedDependents
      )
      return false
    }

    // Deactivate
    if (loadedModule.state === 'active') {
      await this.deactivate(loadedModule)
    }

    // Remove
    this.modules.delete(moduleId)
    delete window[moduleId]

    this.emit({
      type: 'unloaded',
      moduleId,
      manifest: loadedModule.manifest,
      timestamp: new Date()
    })

    this.logger.info(`Module ${moduleId} unloaded`)
    return true
  }

  /**
   * Reload a module (hot reload)
   */
  async reloadModule(moduleId: string): Promise<void> {
    if (!this.options.hotReload) {
      throw new Error('Hot reload is not enabled')
    }

    const loadedModule = this.modules.get(moduleId)
    if (!loadedModule) {
      throw new Error(`Module not loaded: ${moduleId}`)
    }

    this.logger.info(`Reloading module ${moduleId}...`)

    // Get dependents to reload them too
    const dependents = this.resolver.getDependents(
      moduleId,
      Array.from(this.manifests.values())
    )

    // Unload dependents (in reverse order)
    const loadedDependents = dependents.filter(d => this.isLoaded(d))
    for (const dep of loadedDependents.reverse()) {
      await this.unloadModule(dep)
    }

    // Unload this module
    await this.unloadModule(moduleId)

    // Reload with cache bust
    const manifest = this.manifests.get(moduleId)!
    manifest.entry = `${manifest.entry.split('?')[0]}?t=${Date.now()}`

    // Reload
    await this.loadModule(manifest)

    // Reload dependents
    for (const dep of loadedDependents) {
      const depManifest = this.manifests.get(dep)
      if (depManifest) {
        await this.loadModule(depManifest)
      }
    }

    this.logger.info(`Module ${moduleId} reloaded`)
  }

  /**
   * Check if a module is loaded
   */
  isLoaded(moduleId: string): boolean {
    const mod = this.modules.get(moduleId)
    return mod?.state === 'active'
  }

  /**
   * Get a loaded module
   */
  getModule(moduleId: string): LoadedModule | undefined {
    return this.modules.get(moduleId)
  }

  /**
   * Get exports from a loaded module
   */
  getModuleExports<T>(moduleId: string): T | undefined {
    const mod = this.modules.get(moduleId)
    if (!mod) return undefined

    // Return all exports as an object
    const exports: Record<string, unknown> = {}
    for (const [path, value] of mod.exports) {
      exports[path] = value
    }
    return exports as T
  }

  /**
   * Get all loaded module IDs
   */
  getLoadedModuleIds(): string[] {
    return Array.from(this.modules.keys()).filter(id => this.isLoaded(id))
  }

  /**
   * Get service registry
   */
  getServiceRegistry(): ServiceRegistry {
    return this.services
  }

  /**
   * Add event listener
   */
  addEventListener(listener: ModuleEventListener): void {
    this.listeners.add(listener)
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: ModuleEventListener): void {
    this.listeners.delete(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: ModuleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onModuleEvent(event)
      } catch (error) {
        this.logger.error('Event listener error:', error)
      }
    }
  }
}