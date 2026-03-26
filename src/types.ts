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

  /** If true, module can work without this service */
  optional?: boolean
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

  /** Registry for services */
  services: ServiceRegistry

  /** Logger */
  log: ModuleLogger
}

/**
 * Constructor type for injectable classes
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InjectableConstructor<T = unknown> {
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
  /**
   * Additional service IDs this class implements.
   * The class will be resolvable under both its primary ID and all implements IDs.
   */
  implements?: string[]
}

/**
 * Service registry interface
 */
export interface ServiceRegistry {
  /** Register a service instance directly */
  register<T>(id: string, service: T): void

  /**
   * Bind a factory function for lazy instantiation
   * @param id Service identifier
   * @param factory Function that creates the service
   * @param options Scope (singleton/transient) and provider info
   */
  bind<T>(
    id: string,
    factory: () => T,
    options?: { scope?: 'singleton' | 'transient'; providedBy?: string }
  ): void

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
  ): void

  /** Get a service (creates singleton on first access, resolves dependencies automatically) */
  get<T>(id: string): T | undefined

  /** Get a required service - throws if not available */
  getRequired<T>(id: string): T

  /** Get all services matching a pattern */
  getAll<T>(idPattern: string): T[]

  /** Check if service exists */
  has(id: string): boolean

  /** Check if all required services are available */
  checkRequirements(requirements: Array<{ id: string; optional?: boolean }>): {
    satisfied: boolean
    missing: string[]
  }

  /** Unregister a service */
  unregister(id: string): boolean

  /** Get information about a binding */
  getBindingInfo(id: string): { scope: 'singleton' | 'transient'; providedBy?: string } | undefined

  /** Get all registered service IDs */
  getServiceIds(): string[]
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

  /** Custom logger */
  logger?: ModuleLogger
}

/**
 * Module events
 */
export interface ModuleEvent {
  type: 'registering' | 'loading' | 'loaded' | 'activating' | 'activated' |
        'deactivating' | 'deactivated' | 'error' | 'unloaded'
  moduleId: string
  manifest?: ModuleManifest
  error?: Error
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