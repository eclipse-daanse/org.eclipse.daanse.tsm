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
  ServiceRegistry,
  ObservableServiceRegistry,
  ServiceRegistryListener
} from './types.js'
import { DependencyResolver } from './DependencyResolver.js'
import { DefaultServiceRegistry } from './ServiceRegistry.js'
import { ScopedServiceRegistry } from './ScopedServiceRegistry.js'
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
/** How often a module may activate and park within one cascade before giving up */
const MAX_ACTIVATIONS_PER_CASCADE = 10

const DEFAULT_OPTIONS: Required<ModuleLoaderOptions> = {
  loadTimeout: 10000,
  continueOnError: true,
  hotReload: false,
  serviceRegistry: undefined as unknown as ServiceRegistry,
  strictRequirements: false,
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
  private serviceListener?: ServiceRegistryListener
  /** Activations per cascade, to catch a module that flips between states forever */
  private cascadeActivations = new Map<string, number>()
  private disposed = false
  /** Module-scoped registry facades, so a teardown can withdraw what a module registered */
  private scopes = new Map<string, ScopedServiceRegistry>()
  /** Serializes reactions to registry events; they are async, the events are not */
  private queue: Promise<void> = Promise.resolve()
  private pendingTasks = 0

  constructor(options: ModuleLoaderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.services = options.serviceRegistry ?? new DefaultServiceRegistry()
    this.logger = options.logger ?? new ConsoleLogger()
    this.observeServiceRegistry()
  }

  /**
   * Watch the registry for services that active modules depend on.
   *
   * Observation only: a withdrawal is reported, not acted upon. Tearing the
   * consumer down (or rebinding it) is a lifecycle change and belongs with the
   * `unsatisfied` state, not here.
   */
  private observeServiceRegistry(): void {
    const registry = this.services as Partial<ObservableServiceRegistry>
    if (typeof registry.addListener !== 'function') {
      // Custom registries need not be observable
      return
    }

    this.serviceListener = {
      onServiceEvent: () => {
        this.enqueue(() => this.reconcile())
      }
    }
    registry.addListener(this.serviceListener)
  }

  /**
   * Queue a reaction to a registry event.
   *
   * Registry listeners are synchronous while activation is not, so reactions
   * cannot run inside the event. Serializing them also keeps a cascade in
   * order when a teardown withdraws further services.
   */
  private enqueue(task: () => Promise<void>): void {
    if (this.disposed) return
    if (this.pendingTasks === 0) {
      this.cascadeActivations.clear()
    }
    this.pendingTasks++
    this.queue = this.queue
      .then(task)
      .catch(error => {
        this.logger.error('Service event reaction failed:', error)
      })
      .finally(() => {
        this.pendingTasks--
      })
  }

  /**
   * Wait until every queued reaction has run, including those a reaction caused.
   * Needed for deterministic startup and tests.
   */
  async settle(): Promise<void> {
    while (this.pendingTasks > 0) {
      await this.queue
    }
  }

  /**
   * Why a module cannot run right now: missing services, and dependencies
   * that are not active themselves.
   *
   * A module whose dependency is parked must wait too, otherwise it activates
   * against code that is not running.
   */
  private unsatisfiedReasons(manifest: ModuleManifest): {
    services: string[]
    modules: string[]
  } {
    const requirements = manifest.requiresService ?? []
    const services = requirements.length > 0
      ? this.services.checkRequirements(requirements).missing
      : []

    const modules: string[] = []
    for (const dep of manifest.dependencies ?? []) {
      const depSpec = typeof dep === 'string' ? { id: dep } : dep
      if (depSpec.optional) continue

      const depModule = this.modules.get(depSpec.id)
      // Only a module that is known but not running counts as a reason to wait;
      // a dependency that was never registered is handled by ensureDependencies
      if (depModule && depModule.state !== 'active') {
        modules.push(depSpec.id)
      }
    }

    return { services, modules }
  }

  private isSatisfied(manifest: ModuleManifest): boolean {
    const reasons = this.unsatisfiedReasons(manifest)
    return reasons.services.length === 0 && reasons.modules.length === 0
  }

  /**
   * Park a loaded module until what it needs is available.
   *
   * Kept apart from 'error': nothing failed, the module is simply not due yet.
   */
  private park(loadedModule: LoadedModule, reasons: { services: string[]; modules: string[] }): void {
    const { manifest } = loadedModule
    const waitingFor = [
      ...reasons.services,
      ...reasons.modules.map(id => `module ${id}`)
    ]

    loadedModule.state = 'unsatisfied'
    loadedModule.error = undefined

    this.logger.info(`Module ${manifest.id} waits for: ${waitingFor.join(', ')}`)
    this.emit({
      type: 'unsatisfied',
      moduleId: manifest.id,
      manifest,
      serviceIds: reasons.services,
      timestamp: new Date()
    })
  }

  /**
   * Bring loaded modules in line with what is currently available.
   *
   * Two directions, in this order: active modules whose requirements are gone
   * are torn down, then parked modules that became satisfied are activated.
   * Tearing a module down withdraws its own services, which produces further
   * registry events — that is what carries a cascade to indirect consumers.
   */
  private async reconcile(): Promise<void> {
    if (this.disposed) return
    await this.parkUnsatisfiedActive()
    await this.activateSatisfiedPending()
  }

  private async parkUnsatisfiedActive(): Promise<void> {
    // Repeat until nothing changes: parking a module can leave its dependents
    // unsatisfied in turn, and those are not announced by a registry event
    let changed = true
    while (changed) {
      changed = await this.parkUnsatisfiedActiveOnce()
    }
  }

  private async parkUnsatisfiedActiveOnce(): Promise<boolean> {
    let changed = false

    for (const loadedModule of [...this.modules.values()]) {
      if (loadedModule.state !== 'active') continue

      const reasons = this.unsatisfiedReasons(loadedModule.manifest)
      if (reasons.services.length === 0 && reasons.modules.length === 0) continue

      if (reasons.services.length > 0) {
        this.logger.warn(
          `Service(s) ${reasons.services.join(', ')} withdrawn while ` +
          `${loadedModule.manifest.id} is active and requires them`
        )
        this.emit({
          type: 'service-withdrawn',
          moduleId: loadedModule.manifest.id,
          manifest: loadedModule.manifest,
          serviceIds: reasons.services,
          timestamp: new Date()
        })
      }

      await this.deactivate(loadedModule)
      // Park with the reasons that caused the teardown. Whether they still hold
      // is decided by the next fixpoint pass, which may activate it again.
      this.park(loadedModule, reasons)
      changed = true
    }

    return changed
  }

  private async activateSatisfiedPending(): Promise<void> {
    // Repeat until nothing changes: one activation can satisfy the next module
    // even when it registers no service of its own
    let changed = true
    while (changed) {
      changed = await this.activateSatisfiedPendingOnce()
    }
  }

  private async activateSatisfiedPendingOnce(): Promise<boolean> {
    let changed = false

    for (const loadedModule of [...this.modules.values()]) {
      if (loadedModule.state !== 'unsatisfied') continue
      if (!this.isSatisfied(loadedModule.manifest)) continue

      if (this.exceedsCascadeBudget(loadedModule)) continue

      await this.activateLoaded(loadedModule)
      changed = true
    }

    return changed
  }

  /**
   * Guard against a module that keeps activating and parking within one cascade
   * (for instance one that registers a service on activate and withdraws the
   * same service on deactivate while requiring it).
   */
  private exceedsCascadeBudget(loadedModule: LoadedModule): boolean {
    const moduleId = loadedModule.manifest.id
    const attempts = (this.cascadeActivations.get(moduleId) ?? 0) + 1
    this.cascadeActivations.set(moduleId, attempts)

    if (attempts <= MAX_ACTIVATIONS_PER_CASCADE) {
      return false
    }

    const error = new Error(
      `Module ${moduleId} activated and parked ${MAX_ACTIVATIONS_PER_CASCADE} times ` +
      `in one cascade; giving up to avoid an endless loop`
    )
    loadedModule.state = 'error'
    loadedModule.error = error
    this.logger.error(error.message)
    this.emit({
      type: 'error',
      moduleId,
      manifest: loadedModule.manifest,
      error,
      timestamp: new Date()
    })
    return true
  }

  /**
   * Run activation for an already loaded module and record the outcome
   */
  private async activateLoaded(loadedModule: LoadedModule): Promise<void> {
    const { manifest } = loadedModule

    loadedModule.state = 'activating'
    try {
      await this.activate(loadedModule)
      loadedModule.state = 'active'
      this.emit({
        type: 'activated',
        moduleId: manifest.id,
        manifest,
        timestamp: new Date()
      })
      this.logger.info(`Module ${manifest.id} activated`)
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
    }
  }

  /**
   * Detach from the service registry. Call when the loader is discarded,
   * otherwise its listener outlives it.
   */
  dispose(): void {
    this.disposed = true
    const registry = this.services as Partial<ObservableServiceRegistry>
    if (this.serviceListener && typeof registry.removeListener === 'function') {
      registry.removeListener(this.serviceListener)
    }
    this.serviceListener = undefined
    this.scopes.clear()
    this.cascadeActivations.clear()
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

    // Modules parked during the run may become satisfied by later ones,
    // so the caller should see a settled state, not a half-processed queue
    await this.settle()

    const pending = this.getUnsatisfiedModules()
    if (pending.length > 0) {
      this.logger.warn(
        `${pending.length} module(s) waiting for dependencies:`,
        pending.map(entry => `${entry.moduleId} <- ${entry.waitingFor.join(', ')}`)
      )
    }
  }

  /**
   * Modules that are loaded but waiting, with what each of them waits for.
   * The answer to "why is this module not running?".
   */
  getUnsatisfiedModules(): Array<{ moduleId: string; waitingFor: string[] }> {
    const result: Array<{ moduleId: string; waitingFor: string[] }> = []

    for (const loadedModule of this.modules.values()) {
      if (loadedModule.state !== 'unsatisfied') continue

      const reasons = this.unsatisfiedReasons(loadedModule.manifest)
      result.push({
        moduleId: loadedModule.manifest.id,
        waitingFor: [
          ...reasons.services,
          ...reasons.modules.map(id => `module ${id}`)
        ]
      })
    }

    return result
  }

  /**
   * Load a single module
   */
  async loadModule(manifest: ModuleManifest): Promise<LoadedModule> {
    // Check if already loaded, or already waiting
    const existing = this.modules.get(manifest.id)
    if (existing && (existing.state === 'active' || existing.state === 'unsatisfied')) {
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

      // Wait for what is missing instead of failing on it
      const reasons = this.unsatisfiedReasons(manifest)
      if (reasons.services.length > 0 || reasons.modules.length > 0) {
        if (this.options.strictRequirements && reasons.services.length > 0) {
          throw new Error(
            `Module ${manifest.id} requires services that are not available: ${reasons.services.join(', ')}`
          )
        }
        this.park(loadedModule, reasons)
        return loadedModule
      }

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

      // This module may be what others were waiting for
      this.enqueue(() => this.reconcile())

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

    // Withdraw the module's remaining services. A module that unregisters in
    // its own hook is unaffected; one that does not no longer leaves services
    // pointing at stopped code. The resulting events cascade to consumers.
    const released = this.scopes.get(loadedModule.manifest.id)?.releaseAll() ?? []
    if (released.length > 0) {
      this.logger.debug(
        `Withdrew service(s) of ${loadedModule.manifest.id}: ${released.join(', ')}`
      )
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
      services: this.scopeFor(loadedModule.manifest.id),
      log: new ConsoleLogger(`[${loadedModule.manifest.id}]`)
    }
  }

  /**
   * The registry facade a module registers through
   */
  private scopeFor(moduleId: string): ScopedServiceRegistry {
    let scope = this.scopes.get(moduleId)
    if (!scope) {
      scope = new ScopedServiceRegistry(moduleId, this.services)
      this.scopes.set(moduleId, scope)
    }
    return scope
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
    this.scopes.delete(moduleId)
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