/**
 * TSM - TypeScript Module System
 * Module Loader - Core module loading and lifecycle management
 */

import type {
  UnresolvedRequirement,
  Wire,
  WiringResolution,
  ComponentConfigurationInfo,
  ComponentContext,
  ComponentInfo,
  ComponentOptions,
  ConfigurationPolicy,
  ConfigurationProperties,
  InjectableConstructor,
  ServiceRegistration,
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
import { SYSTEM_BUNDLE_ID, resolveWiring, systemBundle, wiringOf } from './capabilities.js'
import {
  getActivateMethod,
  getBindMethods,
  getComponentMetadata,
  getDeactivateMethod,
  getInjectMetadata,
  getModifiedMethod,
  getPropertyInjectMetadata,
  getUnbindMethods
} from './decorators.js'
import {
  CONFIGURATION_ADMIN_SERVICE_ID,
  type ConfigurationAdmin,
  type ConfigurationEvent
} from './ConfigurationAdmin.js'
import { METATYPE_SERVICE_ID, type MetatypeRegistry } from './Metatype.js'
import { isTsmRuntimeAvailable, tsmRuntime } from './TsmRuntime.js'



/**
 * Reject what cannot be a module namespace.
 *
 * Only for containers handed over explicitly — and it says so out loud rather
 * than silently falling through to the URL, because somebody who passes a
 * container means it.
 */
function assertContainer(value: unknown, moduleId: string): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new Error(
      `Container for module '${moduleId}' is ${value === null ? 'null' : typeof value}; ` +
      `expected a module namespace, as an import() resolves to`
    )
  }
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
  logger: undefined as unknown as ModuleLogger,
  configurationAdmin: undefined as unknown as ConfigurationAdmin,
  metatype: undefined as unknown as MetatypeRegistry,
  systemCapabilities: [],
  sharedLibraries: 'runtime',
  entryResolver: undefined as unknown as (manifest: ModuleManifest) => unknown
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
/**
 * A component declaration together with its running instances.
 *
 * DS separates a component *description* — what the class declared — from its
 * *configurations*, the concrete instances with their bindings and properties.
 * The distinction only becomes visible once configuration is involved: without
 * it there is exactly one instance per declaration, with a factory PID there is
 * one per configuration, and with a missing required PID there is none.
 */
interface ComponentRuntime {
  ctor: InjectableConstructor<unknown>
  options: ComponentOptions
  className: string
  /** What it injects — DS calls these the component's references (112.3) */
  references: Array<{ serviceId: string; optional: boolean }>
  /** Effective configuration PIDs, defaulting to the class name */
  pids: string[]
  policy: ConfigurationPolicy
  /** Keyed by {@link instanceKeyOf}: the PID for a factory instance, else one entry */
  instances: Map<string, ComponentInstance>
}

interface ComponentInstance {
  /** The configuration this instance runs with, if any */
  pid?: string
  /** The configuration values themselves, merged across the component's PIDs */
  configuration: ConfigurationProperties
  /** What the services registered for this instance publish */
  properties: ServiceProperties
  registration?: ServiceRegistration
  instance?: Record<string | symbol, unknown>
  /**
   * Which `@bind()` services this instance currently holds.
   *
   * Needed to tell a change from a repeat: a registry event says something moved,
   * not what this instance already has.
   */
  bound: Set<string>
}

/** What a component's configuration amounts to for one instance of it */
interface WantedInstance {
  pid?: string
  /**
   * Whether the PID identifies this instance.
   *
   * Only for a factory configuration, where each configuration *is* its own
   * component configuration. For an ordinary PID there is one instance either
   * way, and configuration appearing or disappearing changes its values rather
   * than replacing it — DS draws the same line.
   */
  factory: boolean
  values: ConfigurationProperties
}

/**
 * What a component injects, from both places `@inject()` can sit.
 *
 * These are DS' references (112.3). A mandatory one decides whether the component
 * may run at all — and only the component, not its module.
 */
function referencesOf(
  ctor: InjectableConstructor<unknown>
): Array<{ serviceId: string; optional: boolean }> {
  return [
    ...getInjectMetadata(ctor).map(entry => ({
      serviceId: entry.serviceId,
      optional: entry.optional
    })),
    ...getPropertyInjectMetadata(ctor).map(entry => ({
      serviceId: entry.serviceId,
      optional: entry.optional
    })),
    // A bound service is a reference too — the difference is only what a change
    // does: a method call instead of a rebuild
    ...getBindMethods(ctor).map(entry => ({
      serviceId: entry.serviceId,
      optional: entry.optional
    }))
  ]
}

/** Key for the one instance a component has when its PID is not a factory PID */
const SINGLETON = '\u0000singleton'

/**
 * How an instance is identified among its component's instances: by its PID when
 * a factory configuration created it, and as *the* instance otherwise.
 */
function instanceKeyOf(wanted: { pid?: string; factory: boolean }): string {
  return wanted.factory && wanted.pid !== undefined ? wanted.pid : SINGLETON
}

/**
 * Whether two property sets are the same, so an update that changes nothing
 * costs nothing — a re-delivered configuration must not rebuild a component.
 */
function sameProperties(left: ServiceProperties, right: ServiceProperties): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false

  return keys.every(key => {
    const a = left[key]
    const b = right[key]
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((entry, index) => entry === b[index])
    }
    return a === b
  })
}

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
   * Components switched off individually, keyed `moduleId/ClassName`.
   *
   * A dimension of its own, as with modules: a disabled component is not waiting
   * for anything, it is off. DS has the same pair (112.5.1), one level down.
   */
  private disabledComponents = new Set<string>()
  /**
   * Per module: its `@component()` classes and what became of them.
   *
   * Two things at once, and deliberately so. A service reference names the
   * module that registered it, never the class inside it, so without this the
   * components of a bundle are invisible from outside — the view DS offers as
   * `scr:list`. And a component's lifecycle is no longer its module's:
   * configuration can hold one component back or instantiate it several times
   * while the module around it just runs.
   */
  private componentRuntimes = new Map<string, ComponentRuntime[]>()
  /** Where component configuration comes from, when the host supplied one */
  private configurations?: ConfigurationAdmin
  /** Where configuration schemas are collected, when the host supplied a registry */
  private metatype?: MetatypeRegistry
  private configurationListener?: { onConfigurationEvent(event: ConfigurationEvent): void }
  /**
   * Containers handed over instead of fetched, kept so a reload can restart a
   * module that has no URL to fetch.
   */
  private preloaded = new Map<string, unknown>()
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
    this.observeConfigurations(options.configurationAdmin)
    this.publishMetatype(options.metatype)
  }

  /**
   * Take the schema registry and publish it, as the Metatype Service is a service
   * in OSGi too — so a configuration user interface can be a module.
   */
  private publishMetatype(metatype?: MetatypeRegistry): void {
    if (!metatype) return

    this.metatype = metatype
    this.services.register(METATYPE_SERVICE_ID, metatype, { providedBy: 'tsm' })
  }

  /**
   * Watch configuration, and publish the admin as a service.
   *
   * Config Admin is a service in OSGi too, and SCR is one of its clients rather
   * than part of it: everything the loader does with configuration goes through
   * PIDs and these events.
   */
  private observeConfigurations(admin?: ConfigurationAdmin): void {
    if (!admin) return

    this.configurations = admin
    this.configurationListener = {
      onConfigurationEvent: (event: ConfigurationEvent) => {
        this.enqueue(() => this.applyConfiguration(event))
      }
    }
    admin.addListener(this.configurationListener)

    this.services.register(CONFIGURATION_ADMIN_SERVICE_ID, admin, { providedBy: 'tsm' })
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
    // After the module level, because a module activating here brings services
    // that a component elsewhere may have been waiting for
    await this.reconcileComponentReferences()
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
    this.disabledComponents.clear()
    this.preloaded.clear()
    this.componentRuntimes.clear()

    if (this.configurationListener) {
      this.configurations?.removeListener(this.configurationListener)
      this.configurationListener = undefined
    }
    this.configurations = undefined
    this.metatype = undefined
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
    // Configuration first: a component requiring a PID that is already in the
    // store should start straight away rather than be parked and woken again
    await this.configurations?.ready()

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
   * What the loaded modules declared as `@component()` classes, and what became
   * of each declaration.
   *
   * The view a service reference cannot give: it names the module that registered
   * a service, never the class inside it. DS offers the same listing as
   * `scr:list`, including the distinction between a declaration and its
   * configurations — a component may currently be running once, several times, or
   * not at all.
   *
   * @param moduleId Restricts the listing to one module
   */
  getComponents(moduleId?: string): ComponentInfo[] {
    const entries = moduleId !== undefined
      ? [[moduleId, this.componentRuntimes.get(moduleId) ?? []] as const]
      : [...this.componentRuntimes.entries()]

    return entries.flatMap(([id, runtimes]) =>
      runtimes.map(runtime => this.describeComponent(id, runtime))
    )
  }

  private describeComponent(moduleId: string, runtime: ComponentRuntime): ComponentInfo {
    const activateMethod = getActivateMethod(runtime.ctor)

    const configurations: ComponentConfigurationInfo[] = [...runtime.instances.values()]
      .map(instance => ({
        pid: instance.pid,
        state: instance.instance !== undefined || this.isInstantiated(instance)
          ? 'active' as const
          : 'satisfied' as const,
        properties: instance.properties
      }))

    if (configurations.length === 0) {
      const missing = this.missingReferences(runtime)
      configurations.push(
        missing.length > 0
          ? { state: 'unsatisfied-reference', waitingFor: missing, properties: {} }
          : { state: 'unsatisfied-configuration', properties: {} }
      )
    }

    return {
      moduleId,
      className: runtime.className,
      disabled: this.isComponentDisabled(moduleId, runtime.className),
      services: runtime.options.service ?? [],
      immediate: runtime.options.immediate ?? activateMethod !== undefined,
      hasActivate: activateMethod !== undefined,
      hasDeactivate: getDeactivateMethod(runtime.ctor) !== undefined,
      hasModified: getModifiedMethod(runtime.ctor) !== undefined,
      references: runtime.references,
      configurationPid: runtime.pids,
      configurationPolicy: runtime.policy,
      configurations
    }
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
   * @param options.container A module that is already imported, handed over
   *   instead of fetched from `manifest.entry`. For an application still bundling
   *   its modules with the host, and for tests, which then need no URL at all.
   *   `ModuleLoaderOptions.entryResolver` does the same for many modules at once.
   */
  async loadModule(
    manifest: ModuleManifest,
    options: { awaitCascade?: boolean; container?: unknown } = {}
  ): Promise<LoadedModule> {
    // The system bundle stands for the runtime; there is nothing to fetch, and in
    // OSGi its start() does nothing for the same reason
    if (manifest.id === SYSTEM_BUNDLE_ID) {
      throw new Error(
        `'${SYSTEM_BUNDLE_ID}' stands for the runtime itself and cannot be loaded`
      )
    }

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

      await this.doLoad(loadedModule, options.container)

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

    // With an import map the browser resolves the specifier and there is nothing
    // here to ask; `generateImportMap()` does the checking before the map is
    // installed, which is the only moment it can be done
    if (this.options.sharedLibraries === 'import-map') {
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
  private async doLoad(loadedModule: LoadedModule, container?: unknown): Promise<void> {
    const { manifest } = loadedModule

    const entryModule = await this.loadEntry(manifest, container)

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
  /**
   * Get hold of the module: from a container that was handed over, or by
   * importing its entry.
   *
   * Order: the container passed to `loadModule`, then what `entryResolver`
   * answers, then the URL. Nothing consults a global — a module used to be handed
   * over through `window[moduleId]`, which cost collisions with DOM ids and made
   * the loader unusable in Node, where `window` does not exist.
   */
  private async loadEntry(manifest: ModuleManifest, container?: unknown): Promise<unknown> {
    // `??` would treat a passed null as "nothing given" and quietly fetch the URL
    // instead, hiding the mistake behind a network error
    const handed = container !== undefined
      ? container
      : this.preloaded.get(manifest.id) ?? this.options.entryResolver?.(manifest)

    if (handed !== undefined) {
      assertContainer(handed, manifest.id)
      // Remembered so a reload can restart a module that has no URL to fetch
      this.preloaded.set(manifest.id, handed)
      return handed
    }

    try {
      const module = await import(/* @vite-ignore */ manifest.entry)
      return (module as { default?: unknown }).default ?? module
    } catch (error) {
      throw new Error(`Failed to load module entry: ${manifest.entry} - ${error}`)
    }
  }


  /**
   * Load a specific export from a module
   */
  private async loadExport(moduleId: string, exportPath: string): Promise<unknown> {
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
      const awaitingConfiguration = this.servicesAwaitingConfiguration(manifest.id)

      for (const service of manifest.provides) {
        // A component that requires configuration it does not have registers
        // nothing, and that is a waiting state rather than drift between
        // manifest and code
        if (awaitingConfiguration.has(service.id)) {
          this.logger.info(
            `Module ${manifest.id} does not provide ${service.id} yet: ` +
            `its component waits for configuration`
          )
        } else if (this.services.has(service.id)) {
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

    const runtimes: ComponentRuntime[] = components.map(({ ctor, options }) => ({
      ctor,
      options,
      className: ctor.name,
      references: referencesOf(ctor),
      pids: this.pidsOf(ctor, options),
      policy: options.configurationPolicy ?? 'optional',
      instances: new Map()
    }))
    this.componentRuntimes.set(loadedModule.manifest.id, runtimes)

    // Schemas before instances: the declared defaults are part of what an
    // instance is configured with
    this.designateSchemas(loadedModule.manifest.id, runtimes)

    // Registration first, for every component, and only then activation: a
    // component may inject a service another component of the same module
    // offers, and constructing it earlier would find nothing. DS separates the
    // two phases for the same reason.
    // In rounds, because one component may inject the service another offers and
    // the order inside a module says nothing about which comes first. The same
    // fixpoint the module level uses.
    const registered: ComponentRuntime[] = []
    let registeredSomething = true
    while (registeredSomething) {
      registeredSomething = false

      for (const runtime of runtimes) {
        if (runtime.instances.size > 0) continue
        if (this.isComponentDisabled(loadedModule.manifest.id, runtime.className)) continue
        if (this.missingReferences(runtime).length > 0) continue

        for (const wanted of this.configurationsFor(runtime)) {
          this.registerInstance(loadedModule, runtime, wanted)
          registeredSomething = true
        }
        if (runtime.instances.size > 0) registered.push(runtime)
      }
    }

    for (const runtime of runtimes) {
      if (runtime.instances.size > 0) continue

      const missing = this.missingReferences(runtime)
      this.logger.info(
        missing.length > 0
          ? `Component ${runtime.className} of ${loadedModule.manifest.id} waits for ` +
            `service(s): ${missing.join(', ')}`
          : `Component ${runtime.className} of ${loadedModule.manifest.id} waits for ` +
            `configuration: ${runtime.pids.join(', ')}`
      )
    }

    // In the order they were registered, not the order they were declared: that
    // order is the dependency order the rounds worked out, and activating a
    // consumer first would leave the provider constructed but not yet started
    for (const runtime of registered) {
      for (const instance of [...runtime.instances.values()]) {
        await this.activateInstance(loadedModule, runtime, instance)
      }
    }
  }

  /**
   * The configuration PIDs a component reads.
   *
   * Defaults to the class name, as DS defaults to the component name — so a
   * component is configurable without declaring anything, and the PID is
   * something a person can guess.
   */
  private pidsOf(ctor: InjectableConstructor<unknown>, options: ComponentOptions): string[] {
    const declared = options.configurationPid
    if (declared === undefined) return [ctor.name]
    return Array.isArray(declared) ? declared : [declared]
  }

  /**
   * Publish what each component declared about the shape of its configuration.
   *
   * The equivalent of bnd writing a Designate element next to the component
   * descriptor: nothing in the running system needs it, and a user interface
   * cannot be written without it.
   */
  private designateSchemas(moduleId: string, runtimes: ComponentRuntime[]): void {
    const metatype = this.metatype
    if (!metatype) return

    for (const runtime of runtimes) {
      const schema = runtime.options.configurationSchema
      if (!schema || runtime.policy === 'ignore') continue

      for (const pid of runtime.pids) {
        // Two components describing one PID differently is a contradiction, not a
        // merge: whichever loads last would silently decide what the PID means
        const existing = metatype.getObjectClassDefinition(pid)
        if (existing !== undefined && existing !== schema) {
          this.logger.warn(
            `Component ${runtime.className} describes ${pid} as '${schema.id}', ` +
            `which is already described as '${existing.id}' — the later one wins`
          )
        }

        metatype.designate(pid, schema, {
          factory: runtime.options.configurationFactory,
          providedBy: moduleId
        })
      }
    }
  }

  /**
   * The declared defaults for a component's PIDs, in the same order the PIDs
   * merge, so a specific PID's default beats a shared one's.
   */
  private declaredDefaults(runtime: ComponentRuntime): ConfigurationProperties {
    if (!this.metatype) return {}

    let defaults: ConfigurationProperties = {}
    for (const pid of runtime.pids) {
      defaults = { ...defaults, ...this.metatype.defaults(pid) }
    }
    return defaults
  }

  /**
   * Which instances of a component its configuration calls for.
   *
   * Three outcomes, and they are what `configurationPolicy` means:
   * none when required configuration is missing, one for the ordinary case, and
   * one per configuration when a PID turns out to be a factory PID. In DS the
   * last one is not a separate feature either — it follows from the PID.
   */
  private configurationsFor(runtime: ComponentRuntime): WantedInstance[] {
    // Declared defaults sit underneath everything: a component reads a configured
    // value or the default it declared, and never has to invent one
    const defaults = runtime.policy === 'ignore' ? {} : this.declaredDefaults(runtime)

    const unconfigured = (): WantedInstance[] =>
      runtime.policy === 'require' ? [] : [{ factory: false, values: { ...defaults } }]

    if (runtime.policy === 'ignore' || !this.configurations) {
      return unconfigured()
    }

    // Several PIDs merge left to right, so a shared PID can carry the common
    // values and a specific one override them
    let values: ConfigurationProperties = { ...defaults }
    let pid: string | undefined
    for (const candidate of runtime.pids) {
      const properties = this.configurations.findConfiguration(candidate)?.getProperties()
      if (!properties) continue
      values = { ...values, ...properties }
      pid ??= candidate
    }

    // Whether the PID is a factory PID can be declared, and otherwise follows
    // from what exists — which is enough at runtime, and the reason a component
    // can be a template without saying so
    const declaredFactory = runtime.options.configurationFactory

    if (declaredFactory !== false) {
      for (const candidate of runtime.pids) {
        const factoryConfigurations = this.configurations.listFactoryConfigurations(candidate)
        if (factoryConfigurations.length === 0) continue

        // One instance per configuration of the factory, the singleton values
        // underneath. Only the first factory PID counts: DS allows one as well.
        return factoryConfigurations.map(configuration => ({
          pid: configuration.pid,
          factory: true,
          values: { ...values, ...configuration.getProperties() }
        }))
      }
    }

    // A component declared as a template has no single configuration of its own,
    // so a singleton configuration under that PID does not make it one
    if (declaredFactory !== true && pid !== undefined) {
      return [{ pid, factory: false, values }]
    }

    return unconfigured()
  }

  /**
   * What the services of one instance publish: what the component declared, with
   * its configuration merged over it.
   *
   * Configuration wins, as in DS — it is the later, deployment-time word on the
   * same question. Keys starting with a dot stay private to the component and
   * out of the service properties, also as in DS.
   */
  private propertiesFor(
    declared: ServiceProperties | undefined,
    configuration: ConfigurationProperties
  ): ServiceProperties {
    const properties: ServiceProperties = { ...declared }

    for (const [key, value] of Object.entries(configuration)) {
      if (key.startsWith('.')) continue
      properties[key] = value
    }

    return properties
  }

  /**
   * The ranking one instance registers with.
   *
   * `service.ranking` from configuration overrides what the class declared,
   * which is how DS lets deployment re-order providers without touching code.
   */
  private rankingFor(
    options: ComponentOptions,
    configuration: ConfigurationProperties
  ): number | undefined {
    const configured = configuration['service.ranking']
    return typeof configured === 'number' ? configured : options.ranking
  }

  /**
   * The mandatory references of a component that nothing provides.
   *
   * Empty means it may run. This is where the component level lives: a missing
   * service used to throw and take the module's start with it — now the component
   * waits and the module keeps running, as DS has it (112.5.2).
   */
  private missingReferences(runtime: ComponentRuntime): string[] {
    // A bound reference with an @unbind method is absorbed by the component
    // itself, so its absence is not a reason to stop — unless it is mandatory,
    // which DS treats the same way (112.5.18): no replacement, no component
    const absorbed = new Set(
      getUnbindMethods(runtime.ctor)
        .filter(entry => {
          const reference = runtime.references.find(
            candidate => candidate.serviceId === entry.serviceId
          )
          return reference?.optional === true
        })
        .map(entry => entry.serviceId)
    )

    return runtime.references
      .filter(reference =>
        !reference.optional &&
        !absorbed.has(reference.serviceId) &&
        !this.services.has(reference.serviceId)
      )
      .map(reference => reference.serviceId)
  }

  /**
   * Start components whose references arrived, stop those whose references left.
   *
   * Runs on every registry event, next to the module-level reconciliation. A
   * component going down withdraws its own services, which is what carries the
   * cascade on — and the queue keeps that in order.
   */
  private async reconcileComponentReferences(): Promise<void> {
    for (const [moduleId, runtimes] of [...this.componentRuntimes]) {
      const loadedModule = this.modules.get(moduleId)
      if (!loadedModule || loadedModule.state !== 'active') continue

      for (const runtime of runtimes) {
        if (this.isComponentDisabled(moduleId, runtime.className)) continue

        // A bound reference is handled first: it may be able to absorb the change
        // without the component going anywhere
        for (const instance of [...runtime.instances.values()]) {
          await this.applyBindings(loadedModule, runtime, instance)
        }

        const missing = this.missingReferences(runtime)

        if (missing.length > 0) {
          for (const [key, instance] of [...runtime.instances]) {
            this.logger.info(
              `Component ${runtime.className} of ${moduleId} stops: ` +
              `service(s) gone: ${missing.join(', ')}`
            )
            await this.stopInstance(loadedModule, runtime, key, instance)
          }
          continue
        }

        if (runtime.instances.size > 0) continue

        for (const wanted of this.configurationsFor(runtime)) {
          const created = this.registerInstance(loadedModule, runtime, wanted)
          await this.activateInstance(loadedModule, runtime, created)
        }
      }
    }
  }

  /**
   * Tell a running instance about its `@bind()` services coming and going.
   *
   * This is what a dynamic reference buys: the component stays and is handed the
   * change, where a plain `@inject()` reference would mean a rebuild.
   *
   * Without an `@unbind()` method the loss is only reported: the component keeps
   * whatever it stored, which is stale. Stopping it instead would turn an optional
   * reference into a mandatory one, so the choice is the component's — a mandatory
   * reference does go down, since nothing could keep it consistent.
   */
  private async applyBindings(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    instance: ComponentInstance
  ): Promise<void> {
    if (instance.instance === undefined) return

    const unbinds = new Map(
      getUnbindMethods(runtime.ctor).map(entry => [entry.serviceId, entry.method])
    )

    for (const binding of getBindMethods(runtime.ctor)) {
      const present = this.services.has(binding.serviceId)
      const held = instance.bound.has(binding.serviceId)

      if (present && !held) {
        instance.bound.add(binding.serviceId)
        await this.callBinding(
          loadedModule, runtime, instance, binding.method, binding.serviceId
        )
        continue
      }

      if (!present && held) {
        instance.bound.delete(binding.serviceId)

        const method = unbinds.get(binding.serviceId)
        if (method !== undefined) {
          await this.callBinding(loadedModule, runtime, instance, method, binding.serviceId)
        } else {
          this.logger.warn(
            `Component ${runtime.className} has no @unbind for ${binding.serviceId}, ` +
            `so it still holds a service that is gone`
          )
        }
      }
    }
  }

  /** Register the services of one component instance, without creating it yet */
  private registerInstance(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    wanted: WantedInstance
  ): ComponentInstance {
    const scope = this.scopeFor(loadedModule.manifest.id)
    const { options } = runtime
    const [primary, ...aliases] = options.service ?? []
    const properties = this.propertiesFor(options.properties, wanted.values)

    // Every ID this instance answers to carries the configuration too, so a
    // consumer filtering on the interface selects the same instance
    const propertiesById: Record<string, ServiceProperties> = {}
    for (const serviceId of options.service ?? []) {
      propertiesById[serviceId] = this.propertiesFor(
        options.propertiesById?.[serviceId] ?? options.properties,
        wanted.values
      )
    }

    const registration = primary === undefined
      ? undefined
      : scope.bindClass(primary, runtime.ctor, {
          implements: aliases,
          properties,
          propertiesById,
          ranking: this.rankingFor(options, wanted.values),
          scope: options.scope,
          // Only a factory configuration makes this one of several registrations
          // of the class; for an ordinary PID it is the class's one registration,
          // and a repeated one should replace it
          instanceKey: wanted.factory ? wanted.pid : undefined
        })

    const instance: ComponentInstance = {
      pid: wanted.pid,
      configuration: wanted.values,
      properties,
      registration,
      bound: new Set()
    }
    runtime.instances.set(instanceKeyOf(wanted), instance)
    return instance
  }

  /**
   * Create a component instance and run its `@activate` method.
   *
   * Only for immediate components: one that merely offers a service waits until
   * somebody resolves it, and then the registry creates it.
   */
  private async activateInstance(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    instance: ComponentInstance
  ): Promise<void> {
    if (instance.instance !== undefined) return

    const activateMethod = getActivateMethod(runtime.ctor)
    const binds = getBindMethods(runtime.ctor)
    // A component with bind methods wants to hear about services, which it cannot
    // do without existing — so it counts as immediate like one with @activate
    const immediate = runtime.options.immediate
      ?? (activateMethod !== undefined || binds.length > 0)
    if (!immediate) return

    // Resolve this registration rather than the ID: with several providers under
    // one service ID, get() would hand back somebody else's component
    const object = instance.registration
      ? instance.registration.resolve<Record<string | symbol, unknown>>()
      : this.scopeFor(loadedModule.manifest.id).construct<Record<string | symbol, unknown>>(
          runtime.ctor as InjectableConstructor<Record<string | symbol, unknown>>
        )
    if (!object) return

    instance.instance = object

    // Binding before activation, as DS orders it (112.5.10 before 112.5.11): the
    // activate method should see the services it was given
    await this.bindAvailable(loadedModule, runtime, instance)

    if (activateMethod !== undefined) {
      await this.callComponentMethod(loadedModule, instance, activateMethod)
    }
  }

  /**
   * Hand the instance every `@bind()` service that is there, in declaration order.
   */
  private async bindAvailable(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    instance: ComponentInstance
  ): Promise<void> {
    for (const binding of getBindMethods(runtime.ctor)) {
      if (instance.bound.has(binding.serviceId)) continue
      if (!this.services.has(binding.serviceId)) continue

      instance.bound.add(binding.serviceId)
      await this.callBinding(loadedModule, runtime, instance, binding.method, binding.serviceId)
    }
  }

  /**
   * Call one bind or unbind method with the service and the component's context.
   *
   * A failure is logged and does not stop the rest: the component stays as it is,
   * which is what a dynamic reference promises.
   */
  private async callBinding(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    instance: ComponentInstance,
    methodName: string | symbol,
    serviceId: string
  ): Promise<void> {
    const object = instance.instance
    if (!object) return

    const method = object[methodName]
    if (typeof method !== 'function') return

    try {
      await (method as (service: unknown, context: ComponentContext) => unknown).call(
        object,
        this.services.get(serviceId),
        this.componentContext(loadedModule, instance)
      )
    } catch (error) {
      this.logger.error(
        `${String(methodName)} of ${runtime.className} failed for ${serviceId}:`,
        error
      )
    }
  }

  /** Run one of a component's lifecycle methods with its context */
  private async callComponentMethod(
    loadedModule: LoadedModule,
    instance: ComponentInstance,
    methodName: string | symbol
  ): Promise<void> {
    const object = instance.instance
    if (!object) return

    const method = object[methodName]
    if (typeof method !== 'function') return

    await (method as (context: ComponentContext) => unknown).call(
      object,
      this.componentContext(loadedModule, instance)
    )
  }

  private componentContext(
    loadedModule: LoadedModule,
    instance: ComponentInstance
  ): ComponentContext {
    return {
      ...this.createContext(loadedModule),
      configuration: instance.configuration,
      properties: instance.properties,
      configurationPid: instance.pid
    }
  }

  /**
   * Bring a component's instances in line with its configuration.
   *
   * The component lifecycle runs on its own here, which is the whole point: the
   * module around it stays active while one of its components waits for a PID,
   * is rebuilt, or gains a second instance. In OSGi that separation is the line
   * between the framework and SCR.
   */
  private async applyConfiguration(event: ConfigurationEvent): Promise<void> {
    if (this.disposed || !this.configurations) return

    for (const [moduleId, runtimes] of [...this.componentRuntimes]) {
      const loadedModule = this.modules.get(moduleId)
      if (!loadedModule || loadedModule.state !== 'active') continue

      for (const runtime of runtimes) {
        if (!this.affects(runtime, event)) continue
        await this.reconcileComponent(loadedModule, runtime)
      }
    }
  }

  /** Whether an event concerns a component: its own PID, or its factory PID */
  private affects(runtime: ComponentRuntime, event: ConfigurationEvent): boolean {
    if (runtime.policy === 'ignore') return false

    return runtime.pids.includes(event.pid) ||
      (event.factoryPid !== undefined && runtime.pids.includes(event.factoryPid))
  }

  private async reconcileComponent(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime
  ): Promise<void> {
    const wanted = new Map(
      this.configurationsFor(runtime).map(entry => [instanceKeyOf(entry), entry])
    )

    for (const [key, instance] of [...runtime.instances]) {
      if (!wanted.has(key)) {
        await this.stopInstance(loadedModule, runtime, key, instance)
      }
    }

    for (const [key, entry] of wanted) {
      const existing = runtime.instances.get(key)

      if (!existing) {
        const created = this.registerInstance(loadedModule, runtime, entry)
        await this.activateInstance(loadedModule, runtime, created)
        continue
      }

      await this.updateInstance(loadedModule, runtime, existing, entry)
    }
  }

  /**
   * Apply changed configuration to an instance that already exists.
   *
   * Three ways, in DS' order of preference: an instance that was never created
   * only needs its properties updated, one with a `@modified()` method is handed
   * the new values, and one without is torn down and built again.
   */
  private async updateInstance(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    instance: ComponentInstance,
    wanted: WantedInstance
  ): Promise<void> {
    const properties = this.propertiesFor(runtime.options.properties, wanted.values)
    if (sameProperties(instance.properties, properties)) return

    const modifiedMethod = getModifiedMethod(runtime.ctor)
    const created = instance.instance !== undefined || this.isInstantiated(instance)

    if (created && modifiedMethod === undefined) {
      await this.stopInstance(loadedModule, runtime, instanceKeyOf(wanted), instance)
      const rebuilt = this.registerInstance(loadedModule, runtime, wanted)
      await this.activateInstance(loadedModule, runtime, rebuilt)
      return
    }

    // The PID can appear or disappear underneath the same instance: configuration
    // for an ordinary PID was created or deleted
    instance.pid = wanted.pid
    instance.configuration = wanted.values
    instance.properties = properties

    const propertiesById: Record<string, ServiceProperties> = {}
    for (const serviceId of runtime.options.service ?? []) {
      propertiesById[serviceId] = this.propertiesFor(
        runtime.options.propertiesById?.[serviceId] ?? runtime.options.properties,
        wanted.values
      )
    }
    instance.registration?.setProperties(properties, {
      ranking: this.rankingFor(runtime.options, wanted.values),
      propertiesById
    })

    if (created && modifiedMethod !== undefined) {
      await this.callComponentMethod(loadedModule, instance, modifiedMethod)
    }
  }

  /**
   * Whether the registry has built this instance, which it does for a delayed
   * component the moment a consumer resolves it — without telling the loader.
   */
  private isInstantiated(instance: ComponentInstance): boolean {
    const registration = instance.registration
    if (!registration) return false

    const registry = this.services as Partial<ServiceRegistry>
    if (typeof registry.getServiceReferences !== 'function') return false

    return registry.getServiceReferences(registration.serviceId)
      .some(reference => reference.key === registration.key && reference.instantiated)
  }

  /** Run one instance's `@deactivate` method and withdraw its services */
  private async stopInstance(
    loadedModule: LoadedModule,
    runtime: ComponentRuntime,
    key: string,
    instance: ComponentInstance
  ): Promise<void> {
    runtime.instances.delete(key)

    const deactivateMethod = getDeactivateMethod(runtime.ctor)
    if (deactivateMethod !== undefined && instance.instance) {
      try {
        await this.callComponentMethod(loadedModule, instance, deactivateMethod)
      } catch (error) {
        // A failing teardown must not keep the registration alive
        this.logger.error(
          `@deactivate of ${runtime.className} in ${loadedModule.manifest.id} failed:`,
          error
        )
      }
    }

    instance.registration?.unregister()
  }

  /** The key a component is switched off under */
  private componentKey(moduleId: string, className: string): string {
    return `${moduleId}/${className}`
  }

  private isComponentDisabled(moduleId: string, className: string): boolean {
    return this.disabledComponents.has(this.componentKey(moduleId, className))
  }

  /**
   * Switch off one component, leaving its module and its siblings running.
   *
   * DS' enabled state, one level below a module's (112.5.1): the component's
   * services are withdrawn and its `@deactivate` runs, but nothing about it is
   * waiting — it is off, and only `enableComponent()` brings it back. Whatever
   * consumed its services reacts as it would to any withdrawal.
   */
  async disableComponent(moduleId: string, className: string): Promise<boolean> {
    this.disabledComponents.add(this.componentKey(moduleId, className))

    const loadedModule = this.modules.get(moduleId)
    const runtime = this.componentRuntimes.get(moduleId)
      ?.find(candidate => candidate.className === className)
    if (!loadedModule || !runtime) return false

    for (const [key, instance] of [...runtime.instances]) {
      await this.stopInstance(loadedModule, runtime, key, instance)
    }

    this.logger.info(`Component ${className} of ${moduleId} disabled`)
    await this.settle()
    return true
  }

  /** Let a component run again, if what it needs is there */
  async enableComponent(moduleId: string, className: string): Promise<boolean> {
    if (!this.disabledComponents.delete(this.componentKey(moduleId, className))) {
      return false
    }

    this.logger.info(`Component ${className} of ${moduleId} enabled`)
    // Through the same reconciliation as any other change: it may still be
    // waiting for a service or a configuration
    this.enqueue(() => this.reconcile())
    await this.settle()
    return true
  }

  /** Components switched off individually, as `moduleId/ClassName` */
  getDisabledComponents(): string[] {
    return [...this.disabledComponents]
  }

  /**
   * Services a module declares but cannot register yet, because the components
   * offering them require configuration that does not exist.
   */
  private servicesAwaitingConfiguration(moduleId: string): Set<string> {
    const pending = new Set<string>()

    for (const runtime of this.componentRuntimes.get(moduleId) ?? []) {
      if (runtime.instances.size > 0) continue
      for (const serviceId of runtime.options.service ?? []) {
        pending.add(serviceId)
      }
    }

    return pending
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
  private async stopComponents(loadedModule: LoadedModule): Promise<void> {
    const moduleId = loadedModule.manifest.id
    const runtimes = this.componentRuntimes.get(moduleId)
    if (!runtimes) return
    this.componentRuntimes.delete(moduleId)
    // The schemas described components that are going away
    this.metatype?.removeAllOf(moduleId)

    for (const runtime of [...runtimes].reverse()) {
      for (const [key, instance] of [...runtime.instances].reverse()) {
        await this.stopInstance(loadedModule, runtime, key, instance)
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

    await this.stopComponents(loadedModule)

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
    // Let go of a handed-over container: keeping it would hold the module object
    // alive and hand the old one back on a later load
    this.preloaded.delete(moduleId)

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

    // Unloading lets go of a handed-over container, which is right when a module
    // goes for good — but a reload has to restart the same code, and there may be
    // no URL to fetch it from
    const handedOver = new Map(
      [moduleId, ...this.resolver
        .getTransitiveDependents(moduleId, Array.from(this.manifests.values()))]
        .filter(id => this.preloaded.has(id))
        .map(id => [id, this.preloaded.get(id)] as const)
    )

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

    // Reload with cache bust — only relevant for a module that has a URL
    const manifest = this.manifests.get(moduleId)!
    if (!handedOver.has(moduleId)) {
      manifest.entry = `${manifest.entry.split('?')[0]}?t=${Date.now()}`
    }

    await this.loadModule(manifest, { container: handedOver.get(moduleId) })

    // Reload the chain, nearest first — each with its own container where it had one
    for (const dependentId of affected) {
      const dependentManifest = this.manifests.get(dependentId)
      if (dependentManifest) {
        await this.loadModule(dependentManifest, { container: handedOver.get(dependentId) })
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
  /**
   * Wire the registered manifests against each other (Core 3.3).
   *
   * Static: it reads manifests, not the running system, and answers whether a
   * module *could* run. A service capability is a promise at this point — that it
   * is kept is what `requiresService` checks at runtime.
   */
  getWiring(): WiringResolution {
    // The system bundle takes part like any other module, which is the whole
    // reason it exists — no second argument, no special case in the resolver
    return resolveWiring([...this.getManifests(), this.getSystemBundle()])
  }

  /**
   * The module standing for the runtime itself, as OSGi's system bundle does.
   *
   * It carries what the environment brings: the shared libraries the host
   * registered, plus whatever `systemCapabilities` declares. Without it a module
   * with `sharedDependencies` could never resolve — its requirement comes from its
   * manifest while the library lives outside the model.
   *
   * Not part of `getManifests()`: that answers what was registered, and this was
   * not. It is not loadable either.
   *
   * With `sharedLibraries: 'import-map'` the libraries are missing from it, since
   * the browser resolves those specifiers and the loader is never told which ones
   * exist; `generateImportMap()` checks them instead.
   */
  getSystemBundle(): ModuleManifest {
    const libraries = this.options.sharedLibraries !== 'import-map' && isTsmRuntimeAvailable()
      ? tsmRuntime.getRegistered()
      : undefined

    return systemBundle({
      libraries,
      capabilities: this.options.systemCapabilities
    })
  }

  /**
   * What a module is wired to, and what is wired to it — Gogo's `inspect`.
   */
  getModuleWiring(moduleId: string): { requires: Wire[]; provides: Wire[] } {
    return wiringOf(this.getWiring(), moduleId)
  }

  /**
   * Requirements that no registered manifest can ever satisfy.
   *
   * The difference to `getUnsatisfiedModules()` is the one that matters in
   * practice: that reports a module *waiting*, this one reports a module waiting
   * **in vain**, because nothing among the manifests even promises what it needs.
   */
  getUnresolvedModules(): UnresolvedRequirement[] {
    return this.getWiring().unresolved
  }

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