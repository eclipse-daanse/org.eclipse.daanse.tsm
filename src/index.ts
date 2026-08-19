/**
 * TSM - TypeScript Module System
 * Runtime module loading with dependency management, lifecycle hooks, and hot reload
 */

// Core classes
export { ModuleLoader } from './ModuleLoader.js'
export { PluginRegistry } from './PluginRegistry.js'
export { DependencyResolver } from './DependencyResolver.js'
export { DefaultServiceRegistry } from './ServiceRegistry.js'
export { ScopedServiceRegistry } from './ScopedServiceRegistry.js'
export { createServiceFilter, type ServiceFilter } from './serviceFilter.js'

// Decorators
export {
  injectable,
  inject,
  singleton,
  transient,
  component,
  activate,
  deactivate,
  modified
} from './decorators.js'

// Import maps for shared libraries
export {
  generateImportMap,
  importMapScript,
  installImportMap,
  type ImportMap,
  type ImportMapResult,
  type OfferedLibrary,
  type MissingLibrary,
  type IncompatibleLibrary
} from './importMap.js'

// Requirements and capabilities (Core 3.3)
export {
  capabilitiesOf,
  requirementsOf,
  resolveWiring,
  satisfies,
  wiringOf,
  IDENTITY_NAMESPACE,
  SERVICE_NAMESPACE,
  LIBRARY_NAMESPACE,
  MODULE_TYPE
} from './capabilities.js'

// Metatype - what a configuration looks like
export {
  MetatypeRegistry,
  objectClass,
  METATYPE_SERVICE_ID,
  type AttributeDefinition,
  type AttributeType,
  type AttributeCardinality,
  type AttributeError,
  type ObjectClassDefinition,
  type ConfigurationOf
} from './Metatype.js'
export { toJsonSchema, toMetamodelSchema, type JsonSchema } from './metatypeJsonSchema.js'

// Configuration Admin
export {
  ConfigurationAdmin,
  MemoryConfigurationStore,
  LocalStorageConfigurationStore,
  CONFIGURATION_ADMIN_SERVICE_ID,
  FACTORY_PID_SEPARATOR,
  SERVICE_PID,
  SERVICE_FACTORY_PID,
  type Configuration,
  type ConfigurationRecord,
  type ConfigurationStore,
  type ConfigurationEvent,
  type ConfigurationListener
} from './ConfigurationAdmin.js'

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
  ComponentInfo,
  ComponentConfigurationInfo,
  ComponentOptions,
  ComponentContext,
  ConfigurationPolicy,
  ConfigurationProperties,
  ServiceCardinality,
  Capability,
  CapabilityAttributes,
  CapabilityDirectives,
  Requirement,
  Wire,
  WiringResolution,
  RequirementReport,
  UnresolvedRequirement,
  ServiceQuery,
  ServiceRegistration,
  ServiceReference,
  ServiceProperties,
  ServicePropertyValue,
  ServiceRegistry,
  ObservableServiceRegistry,
  ServiceRegistryEvent,
  ServiceRegistryListener,
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
