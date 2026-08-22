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
  injectAll,
  singleton,
  perModule,
  transient,
  component,
  activate,
  deactivate,
  modified,
  bind,
  unbind
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
  libraryCapabilities,
  requirementsOf,
  resolveWiring,
  satisfies,
  wiringOf,
  IDENTITY_NAMESPACE,
  SERVICE_NAMESPACE,
  LIBRARY_NAMESPACE,
  MODULE_TYPE,
  DS_VERSION,
  METATYPE_VERSION,
  CM_VERSION,
  ENVIRONMENT,
  SYSTEM_BUNDLE_ID,
  systemBundle
} from './capabilities.js'

// Features - a set of modules and their configuration as one deployable thing
export {
  FEATURE_SERVICE_ID,
  FEATURE_IMPLEMENTATION,
  FEATURE_VERSION,
  FEATURE_RESOURCE_VERSION,
  featureService,
  readFeature,
  writeFeature,
  validateFeature,
  resolveConfigurations,
  missingVariables,
  parseFeatureId,
  formatFeatureId,
  stripComments,
  type Feature,
  type FeatureId,
  type FeatureBundle,
  type FeatureExtension,
  type FeatureProblem,
  type FeatureService,
  type ExtensionKind
} from './features.js'
export {
  installFeature,
  isComplete,
  unsatisfiedRequirements,
  type InstallOptions,
  type InstallResult,
  type ManifestResolver
} from './featureLauncher.js'

// The component layer, as a service — as SCR is a bundle in OSGi
export {
  COMPONENT_RUNTIME_SERVICE_ID,
  EXTENDER_NAMESPACE,
  COMPONENT_EXTENDER,
  METATYPE_EXTENDER,
  IMPLEMENTATION_NAMESPACE,
  CONFIGURATION_IMPLEMENTATION,
  type ServiceComponentRuntime
} from './componentRuntime.js'

// Factory components - a component somebody instantiates by asking
export {
  COMPONENT_FACTORY_SERVICE_ID,
  COMPONENT_FACTORY,
  COMPONENT_NAME,
  componentFactoryFilter
} from './componentFactory.js'

// Conditions - a service that is only a statement
export {
  CONDITION_SERVICE_ID,
  CONDITION_ID,
  TRUE_CONDITION_ID,
  TRUE_CONDITION,
  TRUE_CONDITION_FILTER,
  conditionProperties,
  conditionFilter
} from './conditions.js'

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
  TARGETED_PID_SEPARATOR,
  targetedPids,
  SERVICE_PID,
  SERVICE_FACTORY_PID,
  type Configuration,
  type ConfigurationTarget,
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
  ComponentFactory,
  ComponentFactoryInstance,
  FieldOption,
  ServiceScope,
  ModuleScopedServiceRegistry,
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
