/**
 * TSM - TypeScript Module System
 * Type definitions
 */

/**
 * Module state in lifecycle
 */
export type ModuleState =
  | 'registered'   // Module manifest registered
  | 'resolving'    // Dependencies being resolved
  | 'loading'      // Module being loaded
  | 'activating'   // activate() being called
  | 'active'       // Module is running
  | 'unsatisfied'  // Loaded, waiting for required services
  | 'deactivating' // deactivate() being called
  | 'stopped'      // Module stopped
  | 'error'        // Module failed

/**
 * Dependency specification with optional version range
 */
export interface DependencySpec {
  /** Module ID */
  id: string

  /**
   * Semver version range (e.g., "^1.0.0", ">=2.0.0 <3.0.0", "~1.2.3")
   * If not specified, any version is accepted
   */
  versionRange?: string

  /** If true, this dependency is optional */
  optional?: boolean
}

/**
 * Dependency can be a simple string (module ID) or a full spec with version
 */
export type Dependency = string | DependencySpec

/**
 * Service declaration - describes a service provided by a module
 */
export interface ServiceDeclaration {
  /** Service identifier for DI container */
  id: string

  /**
   * Properties this service is published with, so a consumer can select it
   * through a target filter. Applied to a registration that passes none itself.
   */
  properties?: ServiceProperties

  /**
   * Ranking for this service, used when several modules provide the same ID.
   * The visible service is the highest ranked one; the others stay available
   * and take over when it is withdrawn. Defaults to 0.
   *
   * A ranking passed at registration time wins over this declaration.
   */
  ranking?: number

  /** Human-readable description */
  description?: string

  /**
   * Scope of the service
   * - singleton: One instance shared across all consumers (default)
   * - transient: New instance for each consumer
   */
  scope?: 'singleton' | 'transient'
}

/**
 * Service requirement - describes a service required by a module
 */
export interface ServiceRequirement {
  /** Service identifier */
  id: string

  /** If true, module can work without this service. Same as cardinality '0..1'. */
  optional?: boolean

  /**
   * How many providers this module needs. Defaults to '1..1', or '0..1' when
   * `optional` is set. The n-variants are satisfied by one provider and are
   * consumed through `getServiceReferences()`; the module is only torn down
   * when the last provider is gone.
   */
  cardinality?: ServiceCardinality

  /**
   * LDAP-style filter the provider's properties have to match, in OSGi syntax:
   * `(kind=chart)`, `(&(kind=chart)(service.ranking>=10))`, `(!(experimental=true))`.
   *
   * Narrows what satisfies this requirement and what `getServiceReferences()`
   * returns for it. An invalid filter is rejected rather than silently matching
   * nothing.
   */
  target?: string

  /**
   * What to do when a better-ranked provider appears while the module is active
   * - reluctant (default): stay with the provider already in use
   * - greedy: switch to the better one — a static requirement rebuilds the
   *   module, a dynamic one is reported as unbound and bound again
   *
   * Only meaningful once providers carry different rankings.
   */
  policyOption?: 'reluctant' | 'greedy'

  /**
   * What happens when the service is withdrawn while the module is active
   * - static (default): the module is deactivated and waits for the service to return
   * - dynamic: the module stays active and is notified
   *
   * Only 'static' is implemented; 'dynamic' is accepted and behaves as 'static'.
   */
  policy?: 'static' | 'dynamic'
}

/**
 * Module manifest - describes a loadable module
 */
export interface ModuleManifest {
  /** Unique module identifier */
  id: string

  /** Human-readable name */
  name: string

  /** Semantic version */
  version: string

  /** Description */
  description?: string

  /** URL to the module entry point (remoteEntry.js for MF) */
  entry: string

  /** Exported paths and their types */
  exports: Record<string, ModuleExport>

  /**
   * Services this module provides to other modules
   * These are registered in the DI container when the module activates
   */
  provides?: ServiceDeclaration[]

  /**
   * Services this module requires from other modules
   * These must be available in the DI container before activation
   */
  requiresService?: ServiceRequirement[]

  /**
   * Module dependencies - can be:
   * - Simple string: "moduleA" (any version)
   * - With version: { id: "moduleA", versionRange: "^1.0.0" }
   */
  dependencies?: Dependency[]

  /** Optional dependencies (loaded if available) */
  optionalDependencies?: Dependency[]

  /** Module priority for load ordering (higher = earlier) */
  priority?: number

  /**
   * Shared libraries this module requires from the host
   * These are provided globally via __tsm__.require()
   * e.g., vue, vue-router, primevue
   */
  sharedDependencies?: SharedDependency[]
}

/**
 * Shared library dependency - libraries provided by the host application
 * (e.g., Vue, PrimeVue) that plugins consume via __tsm__.require()
 */
export interface SharedDependency {
  /** Library ID (e.g., 'vue', 'primevue', 'vue-router') */
  id: string

  /**
   * Semver version range required by this module
   * e.g., "^3.4.0", ">=3.0.0 <4.0.0"
   */
  versionRange: string
}

/**
 * Module export configuration
 */
export interface ModuleExport {
  /** Export type */
  type: 'service' | 'component' | 'adapter' | 'factory' | 'other'

  /** Description */
  description?: string

  /** Service identifier for DI registration */
  serviceId?: string
}

/**
 * Lifecycle hooks that modules can implement
 */
export interface ModuleLifecycle {
  /**
   * Called when module is activated
   * Use for initialization, registering services, etc.
   */
  activate?(context: ModuleContext): Promise<void> | void

  /**
   * Called when module is deactivated
   * Use for cleanup, unregistering services, etc.
   */
  deactivate?(context: ModuleContext): Promise<void> | void

  /**
   * A service required with `policy: 'dynamic'` became available while the
   * module is active. Not called for the services present at activation —
   * `activate()` sees those through the context.
   */
  onServiceBound?(context: ModuleContext, serviceId: string): Promise<void> | void

  /**
   * A service required with `policy: 'dynamic'` was withdrawn while the module
   * stays active. Drop any reference to it; the module is not torn down.
   */
  onServiceUnbound?(context: ModuleContext, serviceId: string): Promise<void> | void
}

/**
 * Context passed to module lifecycle hooks
 */
export interface ModuleContext {
  /** This module's manifest */
  manifest: ModuleManifest

  /** Access to other loaded modules */
  getModule<T = unknown>(moduleId: string): T | undefined

  /** Check if a module is loaded */
  isModuleLoaded(moduleId: string): boolean

  /**
   * Registry for services, scoped to this module: registrations and listeners
   * made through it are withdrawn when the module is deactivated.
   *
   * Listening is what makes a collection inside the module reactive — a
   * registry-style service can forward the change to its own consumers.
   */
  services: ObservableServiceRegistry

  /** Logger */
  log: ModuleLogger
}

/**
 * Constructor type for injectable classes
 */
export interface InjectableConstructor<T = unknown> {
  // any[] on purpose: a constructor with typed parameters has to stay assignable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]): T
}

/**
 * Options for bindClass()
 */
export interface BindClassOptions {
  /** Override the scope declared by @singleton()/@transient() decorators */
  scope?: 'singleton' | 'transient'
  /** Module that provided this service */
  providedBy?: string
  /** Higher wins when several registrations share an ID */
  ranking?: number
  /** Properties a consumer's target filter can select on */
  properties?: ServiceProperties
  /**
   * Additional service IDs this class implements.
   * The class will be resolvable under both its primary ID and all implements IDs.
   */
  implements?: string[]
}

/**
 * A value a service property may carry.
 *
 * An array matches when any of its elements does, as in OSGi: "a filter matches
 * a key that has multiple values if it matches at least one of those values".
 */
export type ServicePropertyValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number | boolean>

/** Properties a registration publishes, matched by a target filter */
export type ServiceProperties = Record<string, ServicePropertyValue>

/**
 * Handle for one registration, returned by register/bind/bindClass.
 *
 * Needed because an ID can carry several registrations: `unregister(id)` cannot
 * express which one is meant, a handle can.
 */
export interface ServiceRegistration {
  /** The service ID this registration serves */
  readonly serviceId: string

  /** Module that made the registration */
  readonly providedBy?: string

  /** Higher wins when several registrations share an ID */
  readonly ranking: number

  /** Withdraw exactly this registration. Returns false if it is already gone. */
  unregister(): boolean
}

/**
 * A registration seen from the outside, without resolving it.
 *
 * Collecting providers must not instantiate them — a factory may create an
 * object nobody asked for. A reference carries what is needed to choose, and
 * `resolveReference()` builds the one that was chosen.
 */
export interface ServiceReference {
  readonly serviceId: string
  readonly providedBy?: string
  readonly ranking: number
  readonly scope: 'singleton' | 'transient'

  /**
   * Properties this registration was made with, plus `service.ranking` and
   * `service.providedBy`. What a target filter is matched against.
   */
  readonly properties: Readonly<ServiceProperties>

  /** Whether a singleton instance for this registration already exists */
  readonly instantiated: boolean

  /** Opaque identity, used by resolveReference() */
  readonly key: string
}

/**
 * How many providers of a service a module needs
 * - 0..1 / 1..1: a single provider (1..1 is the default)
 * - 0..n / 1..n: every provider, collected via getServiceReferences()
 */
export type ServiceCardinality = '0..1' | '1..1' | '0..n' | '1..n'

/**
 * Service registry interface
 */
export interface ServiceRegistry {
  /**
   * Register a service instance directly
   * @param options Provider info and ranking
   * @returns A handle that withdraws exactly this registration
   */
  register<T>(
    id: string,
    service: T,
    options?: {
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
    }
  ): ServiceRegistration

  /**
   * Bind a factory function for lazy instantiation
   * @param id Service identifier
   * @param factory Function that creates the service
   * @param options Scope (singleton/transient) and provider info
   */
  bind<T>(
    id: string,
    factory: () => T,
    options?: {
      scope?: 'singleton' | 'transient'
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
    }
  ): ServiceRegistration

  /**
   * Bind a class with automatic constructor injection.
   * The class must be decorated with @injectable() and declare dependencies via @inject().
   * @param id Primary service identifier
   * @param ctor The injectable class constructor
   * @param options Scope override, provider info, and interface bindings
   */
  bindClass<T>(
    id: string,
    ctor: InjectableConstructor<T>,
    options?: BindClassOptions
  ): ServiceRegistration

  /** Get a service (creates singleton on first access, resolves dependencies automatically) */
  get<T>(id: string): T | undefined

  /** Get a required service - throws if not available */
  getRequired<T>(id: string): T

  /**
   * Get all instantiated services whose ID matches a wildcard pattern.
   *
   * @deprecated Predates real cardinality. It matches ID *names* rather than
   * registrations, and sees only services that have already been instantiated,
   * so a lazily bound provider is invisible until someone resolves it. Use
   * `getServiceReferences(id, target?)` to collect providers, with properties
   * instead of naming conventions.
   */
  getAll<T>(idPattern: string): T[]

  /** Check if service exists */
  has(id: string): boolean

  /** Check if all required services are available */
  checkRequirements(
    requirements: Array<{
      id: string
      optional?: boolean
      cardinality?: ServiceCardinality
      target?: string
    }>
  ): {
    satisfied: boolean
    missing: string[]
  }

  /**
   * Every registration for an ID, best first, without instantiating any of them.
   * The way to consume cardinality 0..n / 1..n.
   *
   * @param target Optional LDAP-style filter on the registrations' properties
   */
  getServiceReferences(id: string, target?: string): ServiceReference[]

  /** Resolve one reference from getServiceReferences() */
  resolveReference<T>(reference: ServiceReference): T | undefined

  /** How many registrations an ID carries, optionally matching a target filter */
  countProviders(id: string, target?: string): number

  /**
   * The best service for an ID whose properties match the filter.
   * `get(id)` ignores filters — this is the filtered counterpart.
   */
  getMatching<T>(id: string, target: string): T | undefined

  /** Unregister a service */
  unregister(id: string): boolean

  /** Get information about a binding */
  getBindingInfo(id: string): { scope: 'singleton' | 'transient'; providedBy?: string } | undefined

  /** Get all registered service IDs */
  getServiceIds(): string[]
}

/**
 * Service registry event
 */
export interface ServiceRegistryEvent {
  type: 'registered' | 'updated' | 'unregistered'
  serviceId: string
  service: unknown
}

/**
 * Service registry listener
 */
export interface ServiceRegistryListener {
  onServiceEvent(event: ServiceRegistryEvent): void
}

/**
 * A service registry that reports registrations and withdrawals.
 *
 * Kept separate from `ServiceRegistry` so a custom registry implementation
 * stays valid without it; consumers detect support at runtime.
 */
export interface ObservableServiceRegistry extends ServiceRegistry {
  addListener(listener: ServiceRegistryListener): void
  removeListener(listener: ServiceRegistryListener): void

  /**
   * Resolve once a service is available — immediately if it already is.
   * The alternative to polling `has()`/`get()` in a loop.
   */
  whenAvailable<T>(id: string, options?: { timeoutMs?: number }): Promise<T>
}

/**
 * Module logger interface
 */
export interface ModuleLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/**
 * Loaded module information
 */
export interface LoadedModule {
  /** Module manifest */
  manifest: ModuleManifest

  /** Current state */
  state: ModuleState

  /** Loaded exports */
  exports: Map<string, unknown>

  /** Raw ES module object (the result of dynamic import) */
  container?: unknown

  /** Lifecycle implementation (if provided) */
  lifecycle?: ModuleLifecycle

  /** When the module was loaded */
  loadedAt: Date

  /** Error if state is 'error' */
  error?: Error
}

/**
 * Module loader options
 */
export interface ModuleLoaderOptions {
  /** Timeout for loading modules (ms) */
  loadTimeout?: number

  /** Continue loading other modules if one fails */
  continueOnError?: boolean

  /** Enable hot reload support */
  hotReload?: boolean

  /** Custom service registry */
  serviceRegistry?: ServiceRegistry

  /**
   * Fail activation when a required service is missing, instead of parking
   * the module in 'unsatisfied' until the service appears.
   * Default: false (the module waits)
   */
  strictRequirements?: boolean

  /** Custom logger */
  logger?: ModuleLogger
}

/**
 * Module events
 */
export interface ModuleEvent {
  type: 'registering' | 'loading' | 'loaded' | 'activating' | 'activated' |
        'deactivating' | 'deactivated' | 'error' | 'unloaded' |
        /** A service listed in requiresService was withdrawn while the module was active */
        'service-withdrawn' |
        /** Module is loaded but waiting for required services */
        'unsatisfied' |
        /** Module declared services in `provides` that it did not register */
        'declaration-mismatch'
  moduleId: string
  manifest?: ModuleManifest
  error?: Error

  /**
   * Service IDs this event refers to (set for 'service-withdrawn',
   * 'unsatisfied' and 'declaration-mismatch')
   */
  serviceIds?: string[]

  timestamp: Date
}

/**
 * Module event listener
 */
export interface ModuleEventListener {
  onModuleEvent(event: ModuleEvent): void
}

/**
 * Version conflict information
 */
export interface VersionConflict {
  /** Module ID that has conflicting requirements */
  moduleId: string

  /** Available version of the module */
  availableVersion: string

  /** Modules requiring this dependency with incompatible ranges */
  requirements: Array<{
    requiredBy: string
    versionRange: string
  }>
}

/**
 * Dependency resolution result
 */
export interface DependencyResolution {
  /** Modules in load order (dependencies first) */
  loadOrder: ModuleManifest[]

  /** Circular dependencies detected */
  circular: string[][]

  /** Missing dependencies */
  missing: Array<{ moduleId: string; missingDep: string }>

  /** Version conflicts (dependency required with incompatible versions) */
  versionConflicts: VersionConflict[]

  /** Resolved versions for each dependency */
  resolvedVersions: Map<string, string>
}

// ============================================================================
// Plugin Registry Types
// ============================================================================

/**
 * Repository index file format
 * Located at: {repositoryUrl}/index.json
 */
export interface RepositoryIndex {
  /** Repository name */
  name: string

  /** Repository description */
  description?: string

  /** Repository version/revision */
  version?: string

  /** List of available module IDs */
  modules: string[]

  /** When the index was last updated */
  updatedAt?: string
}

/**
 * Plugin repository configuration
 */
export interface PluginRepository {
  /** Unique repository identifier */
  id: string

  /** Repository name */
  name: string

  /** Base URL of the repository */
  url: string

  /** Optional authentication token */
  token?: string

  /** Whether this repository is enabled */
  enabled?: boolean

  /** Priority for version resolution (higher = preferred) */
  priority?: number
}

/**
 * Discovered module with source information
 */
export interface DiscoveredModule {
  /** The module manifest */
  manifest: ModuleManifest

  /** Repository it was discovered from */
  repository: PluginRepository

  /** Full URL to the manifest */
  manifestUrl: string
}

/**
 * Update information for a module
 */
export interface ModuleUpdate {
  /** Module ID */
  moduleId: string

  /** Currently loaded version */
  currentVersion: string

  /** Available version */
  availableVersion: string

  /** Repository with the update */
  repository: PluginRepository
}

/**
 * Plugin registry options
 */
export interface PluginRegistryOptions {
  /** Timeout for fetching manifests (ms) */
  fetchTimeout?: number

  /** Custom fetch function (for testing or custom auth) */
  fetchFn?: typeof fetch

  /** Logger */
  logger?: ModuleLogger

  /** Cache TTL in ms (0 = no cache) */
  cacheTtl?: number
}

/**
 * Registry event types
 */
export interface RegistryEvent {
  type: 'repository-added' | 'repository-removed' | 'modules-discovered' |
        'discovery-error' | 'update-available'
  repository?: PluginRepository
  modules?: DiscoveredModule[]
  updates?: ModuleUpdate[]
  error?: Error
  timestamp: Date
}

/**
 * Registry event listener
 */
export interface RegistryEventListener {
  onRegistryEvent(event: RegistryEvent): void
}

// ============================================================================
// Shared Module Types
// ============================================================================

/**
 * Shared module configuration
 * Defines modules that should be shared between host and plugins
 */
export interface SharedModuleConfig {
  /** Module specifier (e.g., '@gene/storage-core') */
  name: string

  /**
   * Factory function to load the module
   * Usually: () => import('@gene/storage-core')
   */
  factory: () => Promise<unknown>

  /**
   * URL to use in import map (for production)
   * If not provided, module will be exposed via global
   */
  importMapUrl?: string
}

/**
 * Shared module loader options
 */
export interface SharedModuleLoaderOptions {
  /** Shared modules configuration */
  modules: SharedModuleConfig[]

  /** Use import maps (browser standard) vs global object */
  useImportMaps?: boolean

  /** Logger */
  logger?: ModuleLogger
}