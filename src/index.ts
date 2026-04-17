/**
 * TSM - TypeScript Module System
 * Runtime module loading with dependency management, lifecycle hooks, and hot reload
 */

// Core classes
export { ModuleLoader } from './ModuleLoader.js'
export { PluginRegistry } from './PluginRegistry.js'
export { DependencyResolver } from './DependencyResolver.js'
export { DefaultServiceRegistry } from './ServiceRegistry.js'

// Decorators
export { injectable, inject, singleton, transient } from './decorators.js'

// Runtime (for host applications)
export {
  tsmRuntime,
  initTsmRuntime,
  isTsmRuntimeAvailable,
  type TsmRuntime,
  type SharedLibrary,
  type SharedValidationResult
} from './TsmRuntime.js'

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
} from './types.js'
