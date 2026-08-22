/**
 * TSM - TypeScript Module System
 * Type definitions
 */

import type { ServiceId } from './serviceId.js'

// Re-exported so `types.js` stays the one place a consumer needs
export type { ServiceId, ServiceOf } from './serviceId.js'


// Type-only, so the cycle with ConfigurationAdmin.ts exists on paper alone
import type { ConfigurationAdmin } from './ConfigurationAdmin.js'
import type { AttributeDefinition, MetatypeRegistry, ObjectClassDefinition } from './Metatype.js'

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
   * Scope of the service. See {@link ServiceScope}.
   */
  scope?: ServiceScope
}

/**
 * How many instances of a service exist, and who shares them.
 *
 * - `singleton` (default): one instance for the whole system
 * - `module`: one instance per consuming module, created on that module's first
 *   resolution and dropped when it is deactivated
 * - `transient`: a new instance for every resolution
 *
 * `module` is OSGi's `bundle` scope under the name tsm uses for a bundle. It is
 * the scope for a service that has to keep state *about* its consumer — a
 * per-module cache, a session, an undo stack — where a singleton would mix two
 * modules' state together and `transient` would lose it between two calls.
 */
export type ServiceScope = 'singleton' | 'module' | 'transient'

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
   * - static (default): the module is deactivated and waits for the service to
   *   return, then activates again
   * - dynamic: the module keeps running and is told, through `onServiceBound` and
   *   `onServiceUnbound` on its lifecycle export. Dropping the reference is then
   *   the module's own business — that is what the contract says.
   *
   * Either way the service has to be there for the module to *start*: cardinality
   * decides whether it may activate, policy only decides what a later withdrawal
   * does. Use `cardinality: '0..1'` for something that need not exist at all.
   *
   * A collection (`0..n` / `1..n`) hears about every provider joining or leaving;
   * a single-valued requirement only hears about presence, since a second
   * provider waiting on the bench is none of its business.
   *
   * The DS counterpart is a reference's policy (112.3.7), which is declared per
   * *reference of a component*. Here it is declared per requirement of a
   * **module**, and the hooks are the module's — see `docs/CONFORMANCE.md`.
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

  /**
   * What this module offers to the resolution, beyond what is derived from the
   * rest of the manifest (Core 3.3.3).
   *
   * Every module automatically has an `osgi.identity` capability, and each entry
   * in `provides` becomes an `osgi.service` capability — so this is for anything
   * else: an extender, an implementation of a contract, a theme, a data format.
   */
  capabilities?: Capability[]

  /**
   * What this module needs in order to resolve (Core 3.3.6).
   *
   * `dependencies` and `requiresService` are expressed as requirements too, so
   * this is the general form rather than a fourth mechanism.
   */
  requirements?: Requirement[]
}

/**
 * Something a module offers to the resolution, in a namespace (Core 3.3.3).
 *
 * The generic form of what `provides` and a module's identity say: a namespace
 * decides what a match *means*, the attributes are what a requirement's filter is
 * asserted against.
 */
export interface Capability {
  /** What kind of thing this is — see the `NAMESPACE` constants */
  namespace: string

  /**
   * What a requirement filters on. An attribute named `version` is compared as a
   * version, not as text, so `1.10.0` outranks `1.9.0`.
   */
  attributes?: CapabilityAttributes

  /** Free-form directives; `effective` is the one the resolver reads */
  directives?: CapabilityDirectives
}

export type CapabilityAttributes = Record<string, ServicePropertyValue>

export interface CapabilityDirectives {
  /**
   * When this capability counts. Only `resolve` (the default) is considered by
   * the resolver; anything else is left to another agent, as in OSGi.
   */
  effective?: string

  [directive: string]: string | undefined
}

/**
 * An assertion that some capability exists (Core 3.3.6).
 *
 * Resolution is static: it works on manifests and answers whether a module
 * *could* run, before anything is loaded. That a promised service is actually
 * registered at runtime is a different question, and `requiresService` is the one
 * that asks it — the specification draws the same line for `osgi.service`, where
 * a capability "is a promise" at resolve time.
 */
export interface Requirement {
  namespace: string

  /**
   * LDAP filter over the attributes of capabilities in the same namespace,
   * matched against **one capability at a time**. Without a filter, any
   * capability in the namespace satisfies it.
   *
   * Attribute names are matched case sensitively here, unlike service properties.
   */
  filter?: string

  /**
   * Semver range checked against the capability's `version` attribute.
   *
   * A departure from OSGi, which expresses versions inside the filter: a filter
   * compares text, so `(version>=1.9.0)` would accept `1.10.0` only by accident.
   * This is the correct comparison, and it composes with `filter`.
   */
  versionRange?: string

  /** `mandatory` (default) refuses to resolve without it; `optional` allows it */
  resolution?: 'mandatory' | 'optional'

  /** `single` (default) wires once, `multiple` wires to every match */
  cardinality?: 'single' | 'multiple'

  /** As on a capability: only `resolve` is considered by the resolver */
  effective?: string
}

/** One requirement, satisfied by one capability of one module */
export interface Wire {
  /** The module whose requirement this is */
  requirer: string
  requirement: Requirement
  /** The module providing the capability */
  provider: string
  capability: Capability
}

/** Why a module cannot be resolved */
export interface UnresolvedRequirement {
  moduleId: string
  requirement: Requirement
  /** What was in the way: nothing in the namespace, or nothing matching */
  reason: 'no-capability' | 'no-match'
}

/**
 * One requirement and what became of it.
 *
 * Necessary because the requirements of `dependencies`, `requiresService` and
 * `sharedDependencies` are *derived*: `requirementsOf()` builds fresh objects on
 * every call, so a consumer could not match a `Wire` against a requirement it
 * fetched itself. Here both come from the same pass.
 */
export interface RequirementReport {
  moduleId: string
  requirement: Requirement
  /** What it was wired to; empty when nothing matched */
  wires: Wire[]
  /** Set when a mandatory requirement found nothing */
  failure?: UnresolvedRequirement
}

/**
 * What the capability resolution found.
 *
 * Separate from `DependencyResolution`, which answers a different question: load
 * order. This one answers whether a module can run at all.
 */
export interface WiringResolution {
  /** Every wire, in the order the requirements were declared */
  wires: Wire[]
  /** Modules that cannot resolve, with the requirement that stopped them */
  unresolved: UnresolvedRequirement[]
  /** Module IDs that resolve — including those whose only failures were optional */
  resolved: string[]
  /**
   * Every requirement the resolver considered, with its wires or its failure.
   *
   * Requirements that are not effective at resolve time do not appear: the
   * resolver does not look at them.
   */
  requirements: RequirementReport[]
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
 * What `@component()` declares about a class.
 *
 * Together with `@activate`/`@deactivate` this replaces the imperative
 * registration in a module's `activate` export: the loader reads the declaration
 * and does the registering.
 */
export interface ComponentOptions {
  /**
   * Service IDs to register the component under. The first is the primary one,
   * the rest become aliases. Omit for a component that only has a lifecycle.
   *
   * A {@link ServiceId} carries the contract it stands for, so
   * `@component({ service: [TileService] })` reads like the Java form — and
   * `implements TileService` on the class is what makes the compiler check it.
   */
  service?: readonly (ServiceId<unknown> | string)[]

  /** Properties for the registration */
  properties?: ServiceProperties

  /** Properties per service ID, when the interface differs from the class */
  propertiesById?: Record<string, ServiceProperties>

  /** Higher wins when several components share a service ID */
  ranking?: number

  /** Scope of the registered service. Default: singleton */
  scope?: ServiceScope

  /**
   * Create the component when its module activates, even without an `@activate`
   * method. Default: true when an `@activate` method exists, false otherwise —
   * DS' immediate/delayed distinction.
   */
  immediate?: boolean

  /**
   * Configuration PID this component reads, defaulting to the class name.
   *
   * Several PIDs are merged left to right, so a shared PID can carry the common
   * values and a specific one override them — DS 1.3 does the same.
   *
   * When the PID names a *factory* PID, the component is instantiated once per
   * configuration of that factory, each instance with its own properties.
   */
  configurationPid?: string | string[]

  /**
   * What configuration means for this component's lifecycle, as in DS:
   * - optional (default): runs with configuration if there is any, without if not
   * - require: does not run until its configuration exists
   * - ignore: pays no attention to configuration at all
   */
  configurationPolicy?: ConfigurationPolicy

  /**
   * What this component's configuration looks like: names, types, defaults,
   * ranges. OSGi's `@Designate`, pointing at a Metatype description.
   *
   * Two things follow from declaring it. The declared defaults are applied
   * underneath the configuration, so the component reads a value rather than
   * inventing one, and a generic user interface can offer a form for a PID
   * nobody wrote a form for — which is what Metatype exists for.
   */
  configurationSchema?: ObjectClassDefinition<Record<string, AttributeDefinition>>

  /**
   * The configuration PID is a factory PID, so the component is a template:
   * one instance per configuration.
   *
   * Without it the loader decides from what exists, which is enough at runtime
   * but leaves a user interface unable to tell that it *may* add another
   * instance before the first one exists. `@Designate(factory = true)` in OSGi.
   */
  configurationFactory?: boolean

  /**
   * A filter over condition services that has to be satisfied before this
   * component runs — DS 1.5's `osgi.ds.satisfying.condition` (112.3.13).
   *
   * A condition is a service that carries no behaviour, only the statement that
   * something is the case: `(condition.id=data.loaded)`. It is the way to say
   * "not before" without inventing a service to depend on, and without the
   * component knowing who decides.
   *
   * Treated as one more mandatory reference: while nothing matches, the component
   * waits, and it starts when something does. `condition.id=true` is always
   * registered, so a filter can be written against a baseline that exists.
   */
  satisfyingCondition?: string

  /**
   * Makes this component a template that somebody instantiates by asking, rather
   * than one the loader instantiates from configuration — a **factory component**
   * (DS 112.2.4).
   *
   * The value is the factory's name. Instead of registering the component's own
   * services, the loader registers a {@link ComponentFactory} under
   * {@link COMPONENT_FACTORY_SERVICE_ID} carrying that name, and every
   * `newInstance()` builds one instance with the properties the caller passes.
   *
   * Not to be confused with a factory *configuration*, which tsm has had all
   * along. The difference is who decides there should be another one: a factory
   * configuration is data, so a management UI or a stored file creates instances;
   * a factory component is a call, so code does — "one editor per open tab" is
   * something only the code that opens tabs can know.
   *
   * `configurationPolicy: 'require'` is meaningless here, and the loader says so:
   * these instances are configured by their caller, not by a PID.
   */
  factory?: string
}

/**
 * What a factory component registers, so callers can build instances of it.
 *
 * OSGi's `ComponentFactory` (112.2.4). The properties given to `newInstance()`
 * reach the instance as its configuration, over whatever the component declared.
 */
export interface ComponentFactory<C extends object = ConfigurationProperties> {
  /** The factory name from `@component({ factory })` */
  readonly name: string

  /**
   * Build one instance and start it.
   *
   * Its services are registered as any component's are, so the instance is
   * reachable by anyone filtering on the properties passed here — not only by
   * the caller.
   */
  newInstance(properties?: C): Promise<ComponentFactoryInstance>

  /** The instances this factory built and that have not been disposed */
  readonly instances: readonly ComponentFactoryInstance[]
}

/** One instance a {@link ComponentFactory} built */
export interface ComponentFactoryInstance {
  /** The component object itself */
  readonly instance: unknown

  /** The configuration it was built with */
  readonly properties: Readonly<ConfigurationProperties>

  /**
   * Deactivate it and withdraw its services.
   *
   * Nothing else will: an instance nobody configured is not reclaimed by
   * configuration going away, so its lifetime is the caller's business. Calling
   * it twice is harmless.
   */
  dispose(): Promise<void>
}

export type ConfigurationPolicy = 'optional' | 'require' | 'ignore'

/**
 * What happens to a collection field when the set of providers changes —
 * DS 112.3.9's field option.
 *
 * - `replace` (default): the field is assigned a new array. Safe, and what a
 *   component that only reads it wants.
 * - `update`: the array the component holds is mutated in place. Its identity
 *   stays, which is what a reactive view bound to it needs — with `replace`, a
 *   template holding the old array would never see the change, and one watching
 *   the field re-renders everything on every arrival.
 *
 * `update` asks something of the component in return: the field has to be
 *   initialised (`= []`), because there is nothing to mutate otherwise, and it
 *   must not be handed out as if it were immutable.
 */
export type FieldOption = 'replace' | 'update'

/**
 * Context handed to a component's `@activate`, `@modified` and `@deactivate`
 * methods.
 *
 * Extends the module context, so a component that only needs services and the
 * logger can keep taking a `ModuleContext`. DS makes the same distinction
 * between `BundleContext` and `ComponentContext`.
 *
 * @typeParam C Shape of the configuration, for a component that knows what it
 *   expects: `@activate() start(context: ComponentContext<TileConfig>)`
 */
export interface ComponentContext<C extends object = ConfigurationProperties>
  extends ModuleContext {
  /**
   * The configuration this instance runs with — an empty object when it has
   * none, so reading a value never needs a null check first.
   */
  readonly configuration: Readonly<C>

  /**
   * The properties of the services this instance registered: what the component
   * declared, with the configuration merged over it. What a consumer's target
   * filter selects this instance by.
   */
  readonly properties: Readonly<ServiceProperties>

  /** PID of the configuration behind this instance, if there is one */
  readonly configurationPid?: string
}

/**
 * What a loaded `@component()` class declared, for listing purposes.
 *
 * Not the instance: a delayed component may not exist yet, and its declaration
 * is what a listing wants to show.
 */
export interface ComponentInfo {
  moduleId: string
  /** Name of the class, as far as the bundler preserved it */
  className: string
  /** Service IDs it is registered under; empty for a lifecycle-only component */
  services: string[]
  /** Whether it was created with its module rather than on first resolution */
  immediate: boolean
  /**
   * Switched off with `disableComponent()`.
   *
   * A dimension of its own, as with a module: not waiting for anything, just off.
   */
  disabled: boolean
  hasActivate: boolean
  hasDeactivate: boolean
  /** Whether it can take changed configuration without being rebuilt */
  hasModified: boolean
  /**
   * Services it injects, through `@inject()` on a constructor parameter or a
   * property. A mandatory one has to be there for the component to run — DS calls
   * these its references (112.3).
   */
  references: Array<{ serviceId: string; optional: boolean }>
  /** Configuration PIDs it reads, defaulting to the class name */
  configurationPid: string[]
  configurationPolicy: ConfigurationPolicy

  /**
   * Collections it injects with `@injectAll()` — cardinality 0..n on a field.
   *
   * Never a reason to wait: an empty collection satisfies 0..n. Listed so a
   * listing can show what a component is watching, not only what it needs.
   */
  collections: Array<{ serviceId: string; target?: string; fieldOption: FieldOption }>

  /**
   * The condition filter this component waits for, if it named one.
   *
   * Shows up in `configurations[].waitingFor` as well while it is unsatisfied;
   * here it is visible even once the condition holds.
   */
  satisfyingCondition?: string

  /**
   * The factory's name, for a factory component — and what it has built.
   *
   * `registered: false` means the component is not satisfied, so the factory is
   * withdrawn and nobody can ask for an instance of something that cannot run.
   */
  factory?: {
    name: string
    registered: boolean
    instances: number
  }

  /**
   * What this declaration currently amounts to at runtime.
   *
   * Usually one entry; none while the component requires configuration that does
   * not exist; several when its PID is a factory PID. DS draws the same line
   * between a component *description* and its *configurations*.
   */
  configurations: ComponentConfigurationInfo[]
}

/**
 * One runtime instance of a component declaration.
 *
 * States as in DS, minus the ones tsm settles at module level: a missing service
 * parks the whole module, so `unsatisfied-configuration` is the only kind of
 * unsatisfiedness a single component can be in.
 */
export interface ComponentConfigurationInfo {
  /** PID of the configuration behind it, absent when it runs unconfigured */
  pid?: string
  /**
   * - unsatisfied-configuration: required configuration is missing
   * - unsatisfied-reference: a service it injects is missing
   * - satisfied: registered, not instantiated yet (a delayed component)
   * - active: an instance exists
   *
   * The two unsatisfied states are DS' own distinction (112.5.2), and neither
   * touches the module: it keeps running while the component waits.
   */
  state: 'unsatisfied-configuration' | 'unsatisfied-reference' | 'satisfied' | 'active'
  /** Service IDs it is waiting for, when the state is `unsatisfied-reference` */
  waitingFor?: string[]
  /** The merged properties its registrations carry */
  properties: Readonly<ServiceProperties>
}

/**
 * Options for bindClass()
 */
export interface BindClassOptions {
  /** Override the scope declared by @singleton()/@perModule()/@transient() */
  scope?: ServiceScope
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
  /**
   * Properties for a specific ID, used instead of `properties` for that one.
   *
   * A class registered under its own ID and offered as an interface usually
   * carries different properties for each: the interface is what consumers
   * select on. The module scope fills this in from the manifest's `provides`.
   */
  propertiesById?: Record<string, ServiceProperties>

  /**
   * Distinguishes several registrations of the same class in the same module.
   *
   * Without it a class registering twice under one ID replaces its own earlier
   * registration — which is what should happen for a repeated registration, and
   * not what should happen when one component class is instantiated once per
   * factory configuration. The loader passes the configuration's PID here.
   */
  instanceKey?: string
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
 * Configuration values, as Configuration Admin holds them per PID.
 *
 * The same type as service properties on purpose: a component's configuration is
 * merged into the properties of the services it registers, so a configuration
 * value has to be something a target filter can match. That is also why OSGi
 * restricts configuration to these types.
 */
export type ConfigurationProperties = ServiceProperties

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

  /**
   * Identity of this registration, the same value {@link ServiceReference.key}
   * carries — so a registrant can find its own reference among an ID's providers.
   */
  readonly key: string

  /**
   * Replace the properties a target filter selects this registration by, without
   * withdrawing it: the service object stays, consumers keep their reference.
   *
   * OSGi's `ServiceRegistration.setProperties`, and what lets a component react
   * to changed configuration in a `@modified()` method instead of being rebuilt.
   * A ranking passed here re-decides which registration for the ID is the
   * visible one. Alias registrations from `implements` are updated as well, since
   * a component publishes one set of properties across its services —
   * `propertiesById` gives an individual ID its own set.
   *
   * The properties replace the previous ones rather than merging into them: a
   * value that configuration no longer carries has to disappear.
   *
   * Returns false when the registration is already gone.
   */
  setProperties(
    properties: ServiceProperties,
    options?: { ranking?: number; propertiesById?: Record<string, ServiceProperties> }
  ): boolean

  /**
   * Resolve exactly this registration, not whatever currently answers to the ID.
   *
   * With several providers under one ID, `get(id)` returns the visible one — the
   * registrant needs its own. OSGi has the same pair: `ServiceRegistration`
   * yields a `ServiceReference`, and that resolves to its own service.
   */
  resolve<T>(): T | undefined
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
  readonly scope: ServiceScope

  /**
   * Properties this registration was made with, plus `service.ranking` and
   * `service.providedBy`. What a target filter is matched against.
   */
  readonly properties: Readonly<ServiceProperties>

  /** Whether a shared instance for this registration already exists */
  readonly instantiated: boolean

  /** Opaque identity, used by resolveReference() */
  readonly key: string
}

/**
 * What the registry needs to know about a requirement in order to answer whether
 * it is met. A `ServiceRequirement` from a manifest satisfies this; the extra
 * fields there (policy, policyOption) are the loader's business, not the
 * registry's.
 */
export interface ServiceQuery {
  id: string
  optional?: boolean
  cardinality?: ServiceCardinality
  target?: string
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
    id: ServiceId<T>,
    service: NoInfer<T>,
    options?: {
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
      /**
       * Tells two registrations of one id from one provider apart.
       *
       * Without it a second `register()` under the same id *replaces* the first,
       * so a module offering several objects under one id — the whiteboard
       * pattern — would keep only the last. Registering the same thing twice by
       * accident still replaces, which is what the default is for.
       */
      instanceKey?: string
    }
  ): ServiceRegistration

  /**
   * Bind a factory function for lazy instantiation
   * @param id Service identifier
   * @param factory Function that creates the service
   * @param options Scope (see {@link ServiceScope}) and provider info
   */
  bind<T>(
    id: ServiceId<T>,
    factory: () => NoInfer<T>,
    options?: {
      scope?: ServiceScope
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
      /** As on `register()` — see there */
      instanceKey?: string
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
    id: ServiceId<T>,
    ctor: InjectableConstructor<NoInfer<T>>,
    options?: BindClassOptions
  ): ServiceRegistration

  /**
   * Construct an `@injectable()` class with its dependencies injected, without
   * registering the result as a service — for an object that belongs to nobody
   * else, such as a component that only has a lifecycle.
   */
  construct<T>(ctor: InjectableConstructor<T>): T

  /**
   * Get a service (creates singleton on first access, resolves dependencies
   * automatically).
   *
   * With a {@link ServiceId} the type follows from the id and needs no type
   * argument; with a plain string it is `unknown` unless one is given.
   */
  get<T>(id: ServiceId<T>): T | undefined

  /** Get a required service - throws if not available */
  getRequired<T>(id: ServiceId<T>): T

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
  checkRequirements(requirements: ServiceQuery[]): {
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

  /**
   * Every registration for a typed id, best first.
   *
   * The typed counterpart of `getServiceReferences`, for consuming 0..n without
   * naming the contract a second time at every `resolveReference`.
   */
  getServices<T>(id: ServiceId<T>, target?: string): T[]

  /** How many registrations an ID carries, optionally matching a target filter */
  countProviders(id: string, target?: string): number

  /**
   * The best service for an ID whose properties match the filter.
   * `get(id)` ignores filters — this is the filtered counterpart.
   */
  getMatching<T>(id: ServiceId<T>, target: string): T | undefined

  /** Unregister a service */
  unregister(id: string): boolean

  /** Get information about a binding */
  getBindingInfo(id: string): { scope: ServiceScope; providedBy?: string } | undefined

  /** Get all registered service IDs */
  getServiceIds(): string[]
}

/**
 * A registry that can tell *who* is asking, and so can hold one instance per
 * consuming module — `module` scope.
 *
 * Kept apart from `ServiceRegistry` for the same reason as
 * `ObservableServiceRegistry`: a custom registry stays valid without it, and
 * support is detected at runtime. Without it a `module`-scoped registration
 * behaves as a singleton, which is the safe direction to degrade in.
 */
export interface ModuleScopedServiceRegistry extends ServiceRegistry {
  /**
   * Resolve a service on behalf of a module.
   *
   * For anything but `module` scope this is `get(id)`. For `module` scope it is
   * what makes the instance the consumer's own.
   */
  getFor<T>(consumer: string, id: string): T | undefined

  /** Resolve one reference on behalf of a module */
  resolveReferenceFor<T>(consumer: string, reference: ServiceReference): T | undefined

  /**
   * Construct a class on behalf of a module — the counterpart of `getFor` for a
   * component that has no service of its own.
   */
  constructFor<T>(consumer: string, ctor: InjectableConstructor<T>): T

  /**
   * Drop the instances held for a module, and tell them so.
   *
   * Called when the module is deactivated: a per-module instance outliving its
   * module is the leak this scope would otherwise introduce. A held instance
   * with a `dispose()` method has it called, as OSGi calls `ungetService`.
   */
  releaseConsumer(consumer: string): string[]
}

/**
 * Service registry event
 */
export interface ServiceRegistryEvent {
  /**
   * What happened. `modified-endmatch` reaches only a listener that was added
   * with a filter: the service's properties changed such that it *stopped*
   * matching that filter. OSGi calls it MODIFIED_ENDMATCH (Core 5.6.1).
   *
   * Without it a filtering listener could not tell "no longer interesting" from
   * "nothing happened" — a property change that ends the match looks like
   * silence, and whatever the listener collected stays in its collection.
   */
  type: 'registered' | 'updated' | 'unregistered' | 'modified-endmatch'
  serviceId: string
  service: unknown

  /**
   * The properties the service now has, for a listener deciding what changed.
   *
   * On `modified-endmatch` these are the properties that no longer match — the
   * ones that ended it, not the ones that used to match.
   */
  properties?: Readonly<ServiceProperties>
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
  /**
   * Hear about registrations and withdrawals.
   *
   * With a `filter` the listener hears only about services whose properties
   * match it — and, uniquely, about one that stops matching, as
   * `modified-endmatch`. That is the difference between filtering inside the
   * callback and filtering here: a listener that tests properties itself never
   * learns that a service it had accepted no longer qualifies.
   */
  addListener(listener: ServiceRegistryListener, options?: { filter?: string }): void
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

  /**
   * Hand the loader modules that are already imported, instead of letting it
   * fetch them from their `entry` URL.
   *
   * Returns the module namespace for a manifest, or undefined to fall through to
   * the URL. This is the path for an application migrating from a bundler
   * monolith: the modules still live in the host bundle, but the loader runs them
   * with everything else — manifests, ordering, components, lifecycle.
   *
   * ```typescript
   * const preloaded = new Map([['tiles', await import('./modules/tiles.js')]])
   * new ModuleLoader({ entryResolver: manifest => preloaded.get(manifest.id) })
   * ```
   */
  entryResolver?: (manifest: ModuleManifest) => unknown | undefined

  /**
   * Configuration Admin the loader reads component configuration from.
   *
   * Without one, `configurationPolicy: 'require'` can never be met and those
   * components stay unsatisfied; everything else behaves as if no configuration
   * existed. The admin is also registered as a service under
   * `tsm.configuration.admin`, so a module can configure another one.
   */
  configurationAdmin?: ConfigurationAdmin

  /**
   * Where a module's shared libraries come from.
   *
   * - `runtime` (default): the host registers them with `initTsmRuntime()` and
   *   modules receive them through `__tsm__.require()`, which the Vite plugin's
   *   transform arranges. The loader validates presence and version before a
   *   module is activated.
   * - `import-map`: the modules simply `import` them and the browser resolves the
   *   specifier. The loader then validates nothing, because there is nothing it
   *   could ask — check the map against the manifests with `generateImportMap()`
   *   before installing it, which reports what is missing or incompatible.
   */
  sharedLibraries?: 'runtime' | 'import-map'

  /**
   * What the environment brings, beyond the shared libraries it registered.
   *
   * These hang on the system bundle — the counterpart to OSGi's
   * `org.osgi.framework.system.capabilities.extra`, whose own example is a screen:
   *
   * ```typescript
   * systemCapabilities: [
   *   { namespace: 'acme.screen', attributes: { width: 640, height: 480, card: 'GeForce' } }
   * ]
   * ```
   *
   * A module can then require them like anything else, and the resolution says so
   * before the module is fetched.
   */
  systemCapabilities?: Capability[]

  /**
   * Where component configuration schemas are collected.
   *
   * The loader registers what each `@component()` declared as
   * `configurationSchema` and applies the declared defaults. It is also published
   * as a service under `tsm.metatype`, so a configuration user interface can be a
   * module of its own.
   *
   * Pass the same registry to `ConfigurationAdmin` to have values validated
   * against the schemas as well; the loader does not do that on its own, and
   * neither does Config Admin in OSGi.
   */
  metatype?: MetatypeRegistry
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