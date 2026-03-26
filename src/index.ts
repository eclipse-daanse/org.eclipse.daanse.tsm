/**
 * TSM - TypeScript Module System
 * Runtime module loading with dependency management, lifecycle hooks, and hot reload
 */

// Core classes
export { ModuleLoader } from './ModuleLoader'
export { PluginRegistry } from './PluginRegistry'
export { DependencyResolver } from './DependencyResolver'
export { DefaultServiceRegistry } from './ServiceRegistry'

// Decorators
export { injectable, inject, singleton, transient } from './decorators'

// Runtime (for host applications)
export {
  tsmRuntime,
  initTsmRuntime,
  isTsmRuntimeAvailable,
  type TsmRuntime,
  type SharedLibrary,
  type SharedValidationResult
} from './TsmRuntime'

// Types
export type {
  // Module types
  ModuleManifest,
  ModuleExport,
  LoadedModule,
  ModuleState,
  ModuleContext,
  ModuleLifecycle,
  ModuleLoaderOptions,

  // Service/DI types
  ServiceDeclaration,
  ServiceRequirement,
  ServiceRegistry,
  InjectableConstructor,
  BindClassOptions,

  // Dependency types
  Dependency,
  DependencySpec,
  DependencyResolution,
  VersionConflict,

  // Registry types
  PluginRepository,
  PluginRegistryOptions,
  RepositoryIndex,
  DiscoveredModule,
  ModuleUpdate,

  // Shared library types
  SharedDependency,

  // Event types
  ModuleEvent,
  ModuleEventListener,
  RegistryEvent,
  RegistryEventListener,

  // Logger
  ModuleLogger
} from './types'
