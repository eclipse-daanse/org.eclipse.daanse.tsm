/**
 * TSM - TypeScript Module System
 * Module Loader - Core module loading and lifecycle management
 */

import type {
  ComponentInfo,
  ComponentOptions,
  InjectableConstructor,
  ModuleManifest,
  ModuleState,
  ModuleLoaderOptions,
  LoadedModule,
  ModuleContext,
  ModuleLifecycle,
  ModuleEvent,
  ModuleEventListener,
  ModuleLogger,
  ServiceRegistry,
  ServiceRequirement,
  ServiceProperties,
  ObservableServiceRegistry,
  ServiceRegistryListener
} from './types.js'
import { DependencyResolver } from './DependencyResolver.js'
import { DefaultServiceRegistry } from './ServiceRegistry.js'
import { ScopedServiceRegistry } from './ScopedServiceRegistry.js'
import { collectsMany } from './cardinality.js'
import {
  getActivateMethod,
  getComponentMetadata,
  getDeactivateMethod
} from './decorators.js'
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
 * Whether a global value can plausibly be a module container: a Module
 * Federation remote, or an ES module namespace with lifecycle hooks or exports.
 *
 * Needed because `window[moduleId]` is not a namespace of its own — an element
 * with a matching `id` lands there too.
 */
function isModuleContainer(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false
  }

  // A DOM node is never a container, however promising its shape
  if (typeof (value as { nodeType?: unknown }).nodeType === 'number') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.get === 'function' && typeof candidate.init === 'function') {
    return true
  }

  return typeof candidate.activate === 'function'
    || typeof candidate.deactivate === 'function'
    || candidate.default !== undefined
    || Object.keys(candidate).length > 0
}

/**
 * Default options
 */
/** How often a module may activate and park within one cascade before giving up */
const MAX_ACTIVATIONS_PER_CASCADE = 10

/** States in which loadModule() returns the existing entry instead of loading again */
const IN_FLIGHT_STATES = new Set<ModuleState>([
  'resolving',
  'loading',
  'activating',
  'active',
  'unsatisfied'
])

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
  /**
   * Per module: how many providers each of its dynamic requirements had at the
   * last check. A count, not a flag, so a module consuming cardinality 0..n
   * hears about a provider joining or leaving an already non-empty set.
   */
  private dynamicBindings = new Map<string, Map<string, number>>()
  /**
   * Per module: which registration served each of its requirements when it was
   * activated. Identity of the registration, not of the service object, so a
   * lazily bound provider is not instantiated just to be compared.
   */
  private boundRegistrations = new Map<string, Map<string, string>>()
  /** Per module: services it declared in `provides` but never registered */
  private declarationMismatches = new Map<string, string[]>()
  /**
   * Modules that must not run until enabled again.
   *
   * A separate dimension from the state, as in DS: a disabled module is not
   * broken and not waiting, it is switched off. Without this a manual stop is
   * pointless — the next reconcile would activate it right back.
   */
  private disabled = new Set<string>()
  /**
   * Per module: the component instances the loader created, so their
   * `@deactivate` methods can run when the module stops.
   */
  private componentInstances = new Map<string, Array<{
    instance: Record<string | symbol, unknown>
    method: string | symbol
  }>>()
  /**
   * Per module: what its `@component()` classes declared.
   *
   * `providedBy` on a service reference names the module, not the class inside
   * it, so without this the components of a bundle are invisible from outside —
   * which is what a listing like DS' `scr:list` shows.
   */
  private componentDeclarations = new Map<string, ComponentInfo[]>()
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
   *
   * `loadAll()`, `unloadModule()` and `reloadModule()` await this themselves.
   * After a single `loadModule()` it has to be called by the caller — or
   * `loadModule(manifest, { awaitCascade: true })` does it in one step:
   * activating one module can satisfy others, and that cascade runs in the queue.
   *
   * Do not call it from a lifecycle hook — a hook runs inside the cascade it
   * would be waiting for, which deadlocks. Whether a call sits inside a queued
   * reaction cannot be detected from here without async context tracking, so
   * this is a rule rather than a guard.
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
  private unsatisfiedReasons(
    manifest: ModuleManifest,
    mode: 'activation' | 'runtime' = 'activation'
  ): {
    services: string[]
    modules: string[]
  } {
    // Cardinality decides whether a module may activate; policy decides what a
    // withdrawal does. A dynamic requirement must be there to start, but its
    // later disappearance does not tear the module down — it is notified.
    const requirements = (manifest.requiresService ?? []).filter(
      requirement => mode === 'activation' || requirement.policy !== 'dynamic'
    )
    const services = requirements.length > 0
      ? this.services.checkRequirements(requirements).missing
      : []

    const modules: string[] = []
    for (const dep of manifest.dependencies ?? []) {
      const depSpec = typeof dep === 'string' ? { id: dep } : dep
      if (depSpec.optional) continue

      // Anything that is not active is a reason to wait: parked, still loading,
      // failed, or unloaded again. A dependency that was never registered at all
      // is rejected earlier, by ensureDependencies().
      if (!this.isLoaded(depSpec.id)) {
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
    await this.rebindGreedyRequirements()
    await this.notifyDynamicChanges()
    await this.activateSatisfiedPending()
  }

  /**
   * Move active modules to a better-ranked provider where they asked for it.
   *
   * Without `policyOption: 'greedy'` a running module stays with the provider it
   * has, even after a higher-ranked one appears — the ranking then only decides
   * what a later lookup gets. This is DS' reluctant/greedy distinction.
   */
  private async rebindGreedyRequirements(): Promise<void> {
    for (const loadedModule of [...this.modules.values()]) {
      if (loadedModule.state !== 'active') continue

      const greedy = (loadedModule.manifest.requiresService ?? [])
        .filter(requirement => requirement.policyOption === 'greedy')
      if (greedy.length === 0) continue

      const moduleId = loadedModule.manifest.id
      const bound = this.boundRegistrations.get(moduleId)
      if (!bound) continue

      for (const requirement of greedy) {
        const current = this.visibleRegistrationKey(requirement.id, requirement.target)
        const inUse = bound.get(requirement.id)
        if (current === undefined || inUse === undefined || current === inUse) continue

        if (requirement.policy === 'dynamic') {
          // Report it as a swap: the old service is gone for this module, the new one is there
          await this.callDynamicHook(loadedModule, 'onServiceUnbound', requirement.id)
          await this.callDynamicHook(loadedModule, 'onServiceBound', requirement.id)
          bound.set(requirement.id, current)
          continue
        }

        this.logger.info(
          `Rebuilding ${moduleId}: a better provider for ${requirement.id} appeared`
        )
        await this.deactivate(loadedModule)
        await this.activateLoaded(loadedModule)
        // Activation re-captured every requirement, so the remaining ones are current
        break
      }
    }
  }

  /**
   * Identity of the registration currently serving an ID, without resolving it.
   * Undefined when the registry predates references or nothing serves the ID.
   */
  private visibleRegistrationKey(serviceId: string, target?: string): string | undefined {
    const registry = this.services as Partial<ServiceRegistry>
    if (typeof registry.getServiceReferences !== 'function') return undefined
    return registry.getServiceReferences(serviceId, target)[0]?.key
  }

  private captureBoundRegistrations(manifest: ModuleManifest): void {
    const requirements = manifest.requiresService ?? []
    if (requirements.length === 0) return

    const bound = new Map<string, string>()
    for (const requirement of requirements) {
      const key = this.visibleRegistrationKey(requirement.id, requirement.target)
      if (key !== undefined) {
        bound.set(requirement.id, key)
      }
    }
    this.boundRegistrations.set(manifest.id, bound)
  }

  /**
   * Tell active modules about dynamic requirements that came or went.
   *
   * The module keeps running; dropping the reference is its job, which is the
   * contract `policy: 'dynamic'` expresses.
   */
  private async notifyDynamicChanges(): Promise<void> {
    for (const loadedModule of [...this.modules.values()]) {
      if (loadedModule.state !== 'active') continue

      const dynamic = (loadedModule.manifest.requiresService ?? [])
        .filter(requirement => requirement.policy === 'dynamic')
      if (dynamic.length === 0) continue

      const moduleId = loadedModule.manifest.id
      const previous = this.dynamicBindings.get(moduleId) ?? new Map<string, number>()
      const current = this.countDynamicProviders(dynamic)
      this.dynamicBindings.set(moduleId, current)

      for (const requirement of dynamic) {
        const before = previous.get(requirement.id) ?? 0
        const now = current.get(requirement.id) ?? 0
        if (now < before) {
          await this.callDynamicHook(loadedModule, 'onServiceUnbound', requirement.id)
        } else if (now > before) {
          await this.callDynamicHook(loadedModule, 'onServiceBound', requirement.id)
        }
      }
    }
  }

  private async callDynamicHook(
    loadedModule: LoadedModule,
    hook: 'onServiceBound' | 'onServiceUnbound',
    serviceId: string
  ): Promise<void> {
    const handler = loadedModule.lifecycle?.[hook]
    if (!handler) return

    try {
      await handler.call(loadedModule.lifecycle, this.createContext(loadedModule), serviceId)
    } catch (error) {
      // A failing hook must not stop the cascade; the module stays active,
      // which is what the dynamic contract promises
      this.logger.error(
        `${hook} of ${loadedModule.manifest.id} failed for service ${serviceId}:`,
        error
      )
    }
  }

  /**
   * Record which dynamic requirements are available, so the first reconcile
   * after activation does not report them as newly bound
   */
  private captureDynamicBindings(manifest: ModuleManifest): void {
    const dynamic = (manifest.requiresService ?? [])
      .filter(requirement => requirement.policy === 'dynamic')
    if (dynamic.length === 0) return

    this.dynamicBindings.set(manifest.id, this.countDynamicProviders(dynamic))
  }

  /**
   * What each dynamic requirement currently sees.
   *
   * A collection counts providers, so it hears about one joining or leaving.
   * A single-valued requirement only counts presence — that a second provider
   * waits on the bench is none of its business, and reporting it would double
   * up with the greedy swap.
   */
  private countDynamicProviders(requirements: ServiceRequirement[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const requirement of requirements) {
      const providers = this.countProviders(requirement.id, requirement.target)
      counts.set(
        requirement.id,
        collectsMany(requirement) ? providers : Math.min(providers, 1)
      )
    }
    return counts
  }

  private countProviders(serviceId: string, target?: string): number {
    const registry = this.services as Partial<ServiceRegistry>
    if (typeof registry.countProviders === 'function') {
      return registry.countProviders(serviceId, target)
    }
    return this.services.has(serviceId) ? 1 : 0
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

      const reasons = this.unsatisfiedReasons(loadedModule.manifest, 'runtime')
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
      if (this.disabled.has(loadedModule.manifest.id)) continue
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
      this.captureDynamicBindings(manifest)
      this.captureBoundRegistrations(manifest)
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
    this.dynamicBindings.clear()
    this.boundRegistrations.clear()
    this.declarationMismatches.clear()
    this.disabled.clear()
    this.componentInstances.clear()
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
      // A disabled module is skipped rather than reported as a failure
      if (this.disabled.has(manifest.id)) {
        this.logger.debug(`Skipping disabled module: ${manifest.id}`)
        continue
      }

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

    const mismatches = this.getDeclarationMismatches()
    if (mismatches.length > 0) {
      this.logger.warn(
        `${mismatches.length} module(s) declared services they did not register:`,
        mismatches.map(entry => `${entry.moduleId} -> ${entry.serviceIds.join(', ')}`)
      )
    }

    const pending = this.getUnsatisfiedModules()
    if (pending.length > 0) {
      this.logger.warn(
        `${pending.length} module(s) waiting for dependencies:`,
        pending.map(entry => `${entry.moduleId} <- ${entry.waitingFor.join(', ')}`)
      )
    }
  }

  /**
   * The `@component()` classes of the loaded modules, with what each declared.
   *
   * A service reference names the module that provided it, never the class, so
   * this is the only way to see the components of a bundle from outside — the
   * view DS offers as `scr:list`.
   *
   * @param moduleId Restrict to one module
   */
  getComponents(moduleId?: string): ComponentInfo[] {
    if (moduleId !== undefined) {
      return [...(this.componentDeclarations.get(moduleId) ?? [])]
    }
    return [...this.componentDeclarations.values()].flat()
  }

  /**
   * Services declared in a manifest's `provides` that the module did not
   * register on activation.
   *
   * The resolver builds load-order edges from `provides`, so a declaration
   * nothing backs orders modules after a provider that never delivers. Query
   * this in CI to catch the drift where it is cheap to fix.
   */
  getDeclarationMismatches(): Array<{ moduleId: string; serviceIds: string[] }> {
    return [...this.declarationMismatches].map(([moduleId, serviceIds]) => ({
      moduleId,
      serviceIds
    }))
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
   * Load a single module.
   *
   * Returns once this module is loaded, activated or parked. Modules that become
   * satisfied *because* of it are activated in the queued cascade afterwards.
   *
   * @param options.awaitCascade Also wait for that cascade, so the whole picture
   *   is stable on return — the behaviour OSGi gets for free, where a service
   *   registration is delivered synchronously and `registerService()` returns
   *   with the consequences already applied. Off by default, and it must not be
   *   set from a lifecycle hook: a hook runs inside the cascade it would then
   *   wait for. There is no timeout — the loader knows how many reactions are
   *   outstanding, so waiting is exact rather than a guess.
   */
  async loadModule(
    manifest: ModuleManifest,
    options: { awaitCascade?: boolean } = {}
  ): Promise<LoadedModule> {
    // A manifest handed in directly becomes known, so the rest of the loader can
    // see it: the module scope reads declared properties and rankings from here,
    // and a listing that does not know the module cannot show it.
    if (!this.manifests.has(manifest.id)) {
      this.register([manifest])
    }

    // Disabled means it must not run. Returning the existing entry is enough when
    // there is one; without it there is nothing to hand back, and quietly loading
    // anyway would defeat the flag.
    if (this.disabled.has(manifest.id)) {
      const existing = this.modules.get(manifest.id)
      if (existing) {
        this.logger.warn(`Module ${manifest.id} is disabled — enableModule() first`)
        return existing
      }
      throw new Error(`Module ${manifest.id} is disabled — enableModule() first`)
    }

    // Already loaded, waiting, or being processed right now. The last case is
    // what stops ensureDependencies() from recursing forever on a cycle: the
    // modules involved end up parked on each other instead of overflowing the
    // stack.
    const existing = this.modules.get(manifest.id)
    if (existing && IN_FLIGHT_STATES.has(existing.state)) {
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
        if (options.awaitCascade) await this.settle()
        return loadedModule
      }

      // Activate
      await this.activate(loadedModule)
      this.captureDynamicBindings(manifest)
      this.captureBoundRegistrations(manifest)

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
      if (options.awaitCascade) await this.settle()

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
    const existing = window[moduleId]
    if (existing !== undefined && isModuleContainer(existing)) {
      return existing
    }

    // Something else sits under this name — a DOM element with a matching id, or
    // a built-in property. The browser exposes every id as a global, so this is
    // reachable by accident, and treating it as a container would activate a
    // module that never ran.
    const nameTaken = existing !== undefined
    if (nameTaken) {
      this.logger.warn(
        `Global name '${moduleId}' is taken by something that is not a module container ` +
        `(an element id?). The module is imported, but Module Federation lookups by ` +
        `this name will not work — consider renaming the module or the element.`
      )
    }

    try {
      // Dynamic import
      const module = await import(/* @vite-ignore */ entryUrl)
      const container = module.default ?? module

      // Store in window for MF compatibility, unless that would overwrite
      // whatever already holds the name
      if (!nameTaken) {
        window[moduleId] = container as ModuleFederationContainer
      }
      return container

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

    await this.startComponents(loadedModule)

    // Compare what the manifest promised against what was actually registered
    if (manifest.provides && manifest.provides.length > 0) {
      const undelivered: string[] = []

      for (const service of manifest.provides) {
        if (this.services.has(service.id)) {
          this.logger.info(`Module ${manifest.id} provides service: ${service.id} (${service.scope ?? 'singleton'})`)
        } else {
          undelivered.push(service.id)
        }
      }

      if (undelivered.length > 0) {
        // A declaration nothing backs is worth more than a log line: the resolver
        // derives load order from `provides`, so drift there produces edges to a
        // module that never delivers
        this.declarationMismatches.set(manifest.id, undelivered)
        this.logger.warn(
          `Module ${manifest.id} declared service(s) it did not register: ${undelivered.join(', ')}`
        )
        this.emit({
          type: 'declaration-mismatch',
          moduleId: manifest.id,
          manifest,
          serviceIds: undelivered,
          timestamp: new Date()
        })
      } else {
        this.declarationMismatches.delete(manifest.id)
      }
    }
  }

  /**
   * Register and start the `@component()` classes a module exports.
   *
   * The declarative counterpart to registering services by hand in a module's
   * `activate` export: what a component offers stands on the class, so manifest
   * and code cannot drift apart.
   *
   * Both ways work side by side, and the imperative `activate` runs first: it may
   * set up what a component needs injected, whereas the reverse — a component
   * preparing something for `activate` — is what a declared service is for.
   */
  private async startComponents(loadedModule: LoadedModule): Promise<void> {
    const components = this.findComponents(loadedModule)
    if (components.length === 0) return

    const scope = this.scopeFor(loadedModule.manifest.id)
    const started: Array<{
      instance: Record<string | symbol, unknown>
      method: string | symbol
    }> = []

    // Registration first, for every component, and only then activation: a
    // component may inject a service another component of the same module
    // offers, and constructing it earlier would find nothing. DS separates the
    // two phases for the same reason.
    const declarations: ComponentInfo[] = []
    const registered = components.map(({ ctor, options }) => {
      const [primary, ...aliases] = options.service ?? []

      const registration = primary === undefined
        ? undefined
        : scope.bindClass(primary, ctor as InjectableConstructor<unknown>, {
            implements: aliases,
            properties: options.properties,
            propertiesById: options.propertiesById,
            ranking: options.ranking,
            scope: options.scope
          })

      const activateMethod = getActivateMethod(ctor)
      declarations.push({
        moduleId: loadedModule.manifest.id,
        className: ctor.name,
        services: options.service ?? [],
        immediate: options.immediate ?? activateMethod !== undefined,
        hasActivate: activateMethod !== undefined,
        hasDeactivate: getDeactivateMethod(ctor) !== undefined
      })

      return { ctor, options, registration }
    })

    this.componentDeclarations.set(loadedModule.manifest.id, declarations)

    for (const { ctor, options, registration } of registered) {
      const activateMethod = getActivateMethod(ctor)
      // A component with something to run is created now; one that only offers a
      // service waits until somebody resolves it
      const immediate = options.immediate ?? activateMethod !== undefined
      if (!immediate) continue

      // Resolve this registration rather than the ID: with several providers under
      // one service ID, get() would hand back somebody else's component
      const instance = registration
        ? registration.resolve<Record<string | symbol, unknown>>()
        : scope.construct<Record<string | symbol, unknown>>(
            ctor as InjectableConstructor<Record<string | symbol, unknown>>
          )
      if (!instance) continue

      if (activateMethod !== undefined) {
        const method = instance[activateMethod]
        if (typeof method === 'function') {
          await (method as (context: ModuleContext) => unknown).call(
            instance,
            this.createContext(loadedModule)
          )
        }
      }

      const deactivateMethod = getDeactivateMethod(ctor)
      if (deactivateMethod !== undefined) {
        started.push({ instance, method: deactivateMethod })
      }
    }

    if (started.length > 0) {
      this.componentInstances.set(loadedModule.manifest.id, started)
    }
  }

  /** The exported classes of a module that declare `@component()` */
  private findComponents(loadedModule: LoadedModule): Array<{
    ctor: InjectableConstructor<unknown>
    options: ComponentOptions
  }> {
    const container = loadedModule.container
    if (container === null || typeof container !== 'object') return []

    const found: Array<{ ctor: InjectableConstructor<unknown>; options: ComponentOptions }> = []

    for (const exported of Object.values(container as Record<string, unknown>)) {
      if (typeof exported !== 'function') continue

      const options = getComponentMetadata(exported)
      if (options === undefined) continue

      found.push({ ctor: exported as InjectableConstructor<unknown>, options })
    }

    return found
  }

  /** Run the `@deactivate` methods of a module's components, newest first */
  private async stopComponents(moduleId: string): Promise<void> {
    this.componentDeclarations.delete(moduleId)

    const started = this.componentInstances.get(moduleId)
    if (!started) return
    this.componentInstances.delete(moduleId)

    for (const { instance, method } of [...started].reverse()) {
      const handler = instance[method]
      if (typeof handler !== 'function') continue

      try {
        await (handler as () => unknown).call(instance)
      } catch (error) {
        // A failing teardown must not stop the rest from being torn down
        this.logger.error(`@deactivate of a component in ${moduleId} failed:`, error)
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

    await this.stopComponents(loadedModule.manifest.id)

    // Withdraw the module's remaining services. A module that unregisters in
    // its own hook is unaffected; one that does not no longer leaves services
    // pointing at stopped code. The resulting events cascade to consumers.
    const released = this.scopes.get(loadedModule.manifest.id)?.releaseAll() ?? []
    if (released.length > 0) {
      this.logger.debug(
        `Withdrew service(s) of ${loadedModule.manifest.id}: ${released.join(', ')}`
      )
    }

    this.dynamicBindings.delete(loadedModule.manifest.id)
    this.boundRegistrations.delete(loadedModule.manifest.id)
    this.declarationMismatches.delete(loadedModule.manifest.id)
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
      const declaredRankings = new Map<string, number>()
      const declaredProperties = new Map<string, ServiceProperties>()
      for (const service of this.manifests.get(moduleId)?.provides ?? []) {
        if (service.ranking !== undefined) {
          declaredRankings.set(service.id, service.ranking)
        }
        if (service.properties !== undefined) {
          declaredProperties.set(service.id, service.properties)
        }
      }
      scope = new ScopedServiceRegistry(
        moduleId,
        this.services,
        declaredRankings,
        declaredProperties
      )
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
    this.disabled.delete(moduleId)
    delete window[moduleId]

    this.emit({
      type: 'unloaded',
      moduleId,
      manifest: loadedModule.manifest,
      timestamp: new Date()
    })

    // Dependents of the unloaded module have to be re-evaluated, and the
    // withdrawal of its services has to run to completion
    this.enqueue(() => this.reconcile())
    await this.settle()

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

    // The whole chain, not just the first level: a module two steps away would
    // otherwise keep running against replaced code. Parked modules count too —
    // they hold the old container and would activate with it later.
    const affected = this.resolver
      .getTransitiveDependents(moduleId, Array.from(this.manifests.values()))
      .filter(dependentId => this.modules.has(dependentId))

    // Consumers first, so nothing is unloaded from under a running module
    for (const dependentId of [...affected].reverse()) {
      if (!await this.unloadModule(dependentId)) {
        throw new Error(
          `Cannot reload ${moduleId}: dependent ${dependentId} could not be unloaded`
        )
      }
    }

    if (!await this.unloadModule(moduleId)) {
      throw new Error(`Cannot reload ${moduleId}: it could not be unloaded`)
    }

    // Reload with cache bust
    const manifest = this.manifests.get(moduleId)!
    manifest.entry = `${manifest.entry.split('?')[0]}?t=${Date.now()}`

    // Reload
    await this.loadModule(manifest)

    // Reload the chain, nearest first
    for (const dependentId of affected) {
      const dependentManifest = this.manifests.get(dependentId)
      if (dependentManifest) {
        await this.loadModule(dependentManifest)
      }
    }

    await this.settle()

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
   * Stop a module and keep it stopped.
   *
   * Deactivating alone would not last: the module is satisfied, so the next
   * reconcile activates it again. A disabled module stays stopped until
   * `enableModule()`, which is what makes a manual stop meaningful — the
   * `enabled` flag of DS components.
   *
   * Its services are withdrawn, so consumers are parked in the usual cascade.
   */
  async disableModule(moduleId: string): Promise<boolean> {
    if (!this.manifests.has(moduleId)) return false

    this.disabled.add(moduleId)

    const loadedModule = this.modules.get(moduleId)
    if (loadedModule && loadedModule.state === 'active') {
      await this.deactivate(loadedModule)
    }

    this.enqueue(() => this.reconcile())
    await this.settle()

    this.logger.info(`Module ${moduleId} disabled`)
    return true
  }

  /**
   * Allow a disabled module to run again. It activates as soon as what it needs
   * is available — immediately, if that is already the case.
   */
  async enableModule(moduleId: string): Promise<boolean> {
    if (!this.disabled.delete(moduleId)) return false

    // Never loaded, because it was disabled before anyone tried: load it now,
    // otherwise enabling would leave a module that exists only as a manifest
    const manifest = this.manifests.get(moduleId)
    if (manifest && !this.modules.has(moduleId)) {
      await this.loadModule(manifest, { awaitCascade: true })
      this.logger.info(`Module ${moduleId} enabled`)
      return true
    }

    const loadedModule = this.modules.get(moduleId)
    if (loadedModule && loadedModule.state === 'stopped') {
      // Hand it back to the reconciler rather than activating here: it decides
      // on the same conditions as for any other waiting module
      this.park(loadedModule, this.unsatisfiedReasons(loadedModule.manifest))
    }

    this.enqueue(() => this.reconcile())
    await this.settle()

    this.logger.info(`Module ${moduleId} enabled`)
    return true
  }

  /** Whether a module is switched off */
  isDisabled(moduleId: string): boolean {
    return this.disabled.has(moduleId)
  }

  /** Every module that is currently switched off */
  getDisabledModules(): string[] {
    return [...this.disabled]
  }

  /**
   * Which modules declared a requirement on a service, and how.
   *
   * The counterpart to `getBindingInfo().providedBy`: that answers who offers a
   * service, this answers who asked for it — `inspect service` in OSGi terms.
   * Derived from the manifests, so it also covers modules that are not running.
   */
  getServiceConsumers(serviceId: string): Array<{
    moduleId: string
    state: ModuleState | 'not loaded'
    requirement: ServiceRequirement
  }> {
    const consumers: Array<{
      moduleId: string
      state: ModuleState | 'not loaded'
      requirement: ServiceRequirement
    }> = []

    for (const manifest of this.manifests.values()) {
      const requirement = manifest.requiresService?.find(entry => entry.id === serviceId)
      if (!requirement) continue

      consumers.push({
        moduleId: manifest.id,
        state: this.modules.get(manifest.id)?.state ?? 'not loaded',
        requirement
      })
    }

    return consumers
  }

  /**
   * Every registered manifest, whether the module is loaded or not.
   *
   * `getLoadedModuleIds()` answers what is running; this answers what is known,
   * which is what a listing needs in order to show a module as not loaded.
   */
  getManifests(): ModuleManifest[] {
    return Array.from(this.manifests.values())
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