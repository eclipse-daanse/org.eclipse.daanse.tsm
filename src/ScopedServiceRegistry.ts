/**
 * TSM - TypeScript Module System
 * Module-scoped service registry
 */

import type {
  ObservableServiceRegistry as IObservableServiceRegistry,
  ModuleScopedServiceRegistry as IModuleScopedServiceRegistry,
  ServiceRegistry as IServiceRegistry,
  ServiceId,
  ServiceScope,
  InjectableConstructor,
  BindClassOptions,
  ServiceQuery,
  ServiceProperties,
  ServiceReference,
  ServiceRegistration,
  ServiceRegistryListener
} from './types.js'

/**
 * A registry facade bound to one module.
 *
 * Every registration made through it is attributed to that module and can be
 * withdrawn again in one step, which is what makes a module teardown complete
 * without relying on the module's own cleanup code. This mirrors the role of
 * `BundleContext` in OSGi, where the framework unregisters a bundle's services
 * when it stops.
 *
 * Reads are passed straight through: a module sees every service, not only its own.
 */
export class ScopedServiceRegistry implements IObservableServiceRegistry {
  /** Registrations made through this facade, in registration order */
  private ownRegistrations: ServiceRegistration[] = []
  /** Listeners this module added, so they do not outlive it */
  private ownListeners = new Set<ServiceRegistryListener>()

  /**
   * @param declaredRankings Rankings from the manifest's `provides`, applied when
   *   a registration passes none of its own
   */
  constructor(
    private readonly moduleId: string,
    private readonly target: IServiceRegistry,
  private readonly declaredRankings: Map<string, number> = new Map(),
    private readonly declaredProperties: Map<string, ServiceProperties> = new Map()
  ) {}

  private rankingFor(id: string, given?: number): number | undefined {
    return given ?? this.declaredRankings.get(id)
  }

  /**
   * Merge the manifest's declared properties with the ones passed at
   * registration, per key.
   *
   * Not "one or the other": the manifest describes where a service belongs —
   * deployment information a module should not have to repeat — while the code
   * adds what only it knows. Replacing wholesale would silently drop a declared
   * property as soon as the code passes any property at all.
   */
  private propertiesFor(
    id: string,
    given?: ServiceProperties
  ): ServiceProperties | undefined {
    const declared = this.declaredProperties.get(id)
    if (!declared) return given
    if (!given) return declared

    return { ...declared, ...given }
  }

  register<T>(
    id: ServiceId<T>,
    service: NoInfer<T>,
    options: {
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
      instanceKey?: string
    } = {}
  ): ServiceRegistration {
    return this.track(this.target.register(id, service, {
      ...options,
      providedBy: options.providedBy ?? this.moduleId,
      ranking: this.rankingFor(id, options.ranking),
      properties: this.propertiesFor(id, options.properties)
    }))
  }

  bind<T>(
    id: ServiceId<T>,
    factory: (consumer?: string) => NoInfer<T>,
    options: {
      scope?: ServiceScope
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
      instanceKey?: string
    } = {}
  ): ServiceRegistration {
    return this.track(this.target.bind(id, factory, {
      ...options,
      providedBy: options.providedBy ?? this.moduleId,
      ranking: this.rankingFor(id, options.ranking),
      properties: this.propertiesFor(id, options.properties)
    }))
  }

  bindClass<T>(
    id: ServiceId<T>,
    ctor: InjectableConstructor<NoInfer<T>>,
    options: BindClassOptions = {}
  ): ServiceRegistration {
    // Alias registrations from `implements` are removed with their primary,
    // so they need no separate tracking
    // Every ID this class answers to can have its own declared properties, so
    // the manifest can describe the interface differently from the class itself
    const propertiesById: Record<string, ServiceProperties> = {}
    for (const serviceId of [id, ...(options.implements ?? [])]) {
      const properties = this.propertiesFor(serviceId, options.propertiesById?.[serviceId])
      if (properties) propertiesById[serviceId] = properties
    }

    return this.track(this.target.bindClass(id, ctor, {
      ...options,
      providedBy: options.providedBy ?? this.moduleId,
      ranking: this.rankingFor(id, options.ranking),
      properties: this.propertiesFor(id, options.properties),
      propertiesById
    }))
  }

  /**
   * Remember a registration for the teardown, and keep the manifest's declared
   * properties in play for later property changes.
   *
   * A component updating its properties from configuration passes what it and
   * its configuration know; where the service belongs is still the manifest's
   * business, exactly as at registration time.
   */
  private track(registration: ServiceRegistration): ServiceRegistration {
    const scoped: ServiceRegistration = {
      ...registration,
      unregister: () => registration.unregister(),
      resolve: <T>() => registration.resolve<T>(),
      setProperties: (properties, options = {}) => {
        const byId: Record<string, ServiceProperties> = {}
        for (const [serviceId, own] of Object.entries(options.propertiesById ?? {})) {
          const merged = this.propertiesFor(serviceId, own)
          if (merged) byId[serviceId] = merged
        }

        return registration.setProperties(
          this.propertiesFor(registration.serviceId, properties) ?? properties,
          { ...options, propertiesById: byId }
        )
      }
    }

    this.ownRegistrations.push(scoped)
    return scoped
  }

  /**
   * Construct a class for this module, so a `module`-scoped dependency is this
   * module's own instance.
   *
   * The path a component without a service of its own takes, which makes it the
   * one that must not lose the consumer.
   */
  construct<T>(ctor: InjectableConstructor<T>): T {
    const target = this.target as Partial<IModuleScopedServiceRegistry>
    return typeof target.constructFor === 'function'
      ? target.constructFor<T>(this.moduleId, ctor)
      : this.target.construct(ctor)
  }

  /**
   * Reads pass through, but no longer anonymously: the facade knows which module
   * is asking, and that is the whole of what `module` scope needs.
   *
   * A target registry without `getFor` falls back to the plain read, where a
   * `module`-scoped registration behaves as a singleton.
   */
  get<T>(id: ServiceId<T>): T | undefined {
    const target = this.target as Partial<IModuleScopedServiceRegistry>
    return typeof target.getFor === 'function'
      ? target.getFor<T>(this.moduleId, id)
      : this.target.get<T>(id)
  }

  getRequired<T>(id: ServiceId<T>): T {
    const service = this.get<T>(id)
    if (service === undefined) {
      // Same message the shared registry would give, so the module sees no
      // difference between asking it and asking through the facade
      return this.target.getRequired<T>(id)
    }
    return service
  }

  getAll<T>(idPattern: string): T[] {
    return this.target.getAll<T>(idPattern)
  }

  has(id: string): boolean {
    return this.target.has(id)
  }

  checkRequirements(requirements: ServiceQuery[]): {
    satisfied: boolean
    missing: string[]
  } {
    return this.target.checkRequirements(requirements)
  }

  getServiceReferences(id: string, target?: string): ServiceReference[] {
    return this.target.getServiceReferences(id, target)
  }

  /**
   * Every service under an id, best first — resolved as this module, so a
   * `module`-scoped provider hands over this module's own instance.
   */
  getServices<T>(id: ServiceId<T>, target?: string): T[] {
    return this.getServiceReferences(id, target)
      .map(reference => this.resolveReference<T>(reference))
      .filter((service): service is T => service !== undefined)
  }

  resolveReference<T>(reference: ServiceReference): T | undefined {
    const target = this.target as Partial<IModuleScopedServiceRegistry>
    return typeof target.resolveReferenceFor === 'function'
      ? target.resolveReferenceFor<T>(this.moduleId, reference)
      : this.target.resolveReference<T>(reference)
  }

  countProviders(id: string, target?: string): number {
    return this.target.countProviders(id, target)
  }

  getMatching<T>(id: ServiceId<T>, target: string): T | undefined {
    return this.target.getMatching<T>(id, target)
  }

  /**
   * Withdraw this module's registrations for an ID.
   *
   * Only its own: with several providers per ID, delegating to the shared
   * `unregister(id)` would take other modules' registrations along. An ID this
   * module never registered still falls through to the shared registry.
   */
  unregister(id: string): boolean {
    const mine = this.ownRegistrations.filter(registration => registration.serviceId === id)
    if (mine.length === 0) {
      return this.target.unregister(id)
    }

    this.ownRegistrations = this.ownRegistrations.filter(
      registration => registration.serviceId !== id
    )
    return mine.map(registration => registration.unregister()).some(removed => removed)
  }

  getBindingInfo(id: string): { scope: ServiceScope; providedBy?: string } | undefined {
    return this.target.getBindingInfo(id)
  }

  getServiceIds(): string[] {
    return this.target.getServiceIds()
  }

  /**
   * Listen for service registrations and withdrawals.
   *
   * The listener is removed when the module is deactivated, so a collection
   * held by the module cannot keep reacting after the module stopped.
   *
   * Requires an observable target registry; a custom `ServiceRegistry` without
   * listener support cannot provide this.
   */
  addListener(listener: ServiceRegistryListener, options: { filter?: string } = {}): void {
    const target = this.target as Partial<IObservableServiceRegistry>
    if (typeof target.addListener !== 'function') {
      throw new Error(
        `Service registry does not support listeners, so module ${this.moduleId} cannot observe it`
      )
    }
    this.ownListeners.add(listener)
    target.addListener(listener, options)
  }

  /**
   * Resolve once a service is available.
   *
   * A pending wait is not cancelled when the module is deactivated; keep the
   * `timeoutMs` in mind if the service may never arrive.
   */
  whenAvailable<T>(id: string, options: { timeoutMs?: number } = {}): Promise<T> {
    const target = this.target as Partial<IObservableServiceRegistry>
    if (typeof target.whenAvailable !== 'function') {
      return Promise.reject(new Error(
        `Service registry does not support waiting, so module ${this.moduleId} cannot await ${id}`
      ))
    }
    return target.whenAvailable<T>(id, options)
  }

  removeListener(listener: ServiceRegistryListener): void {
    const target = this.target as Partial<IObservableServiceRegistry>
    this.ownListeners.delete(listener)
    if (typeof target.removeListener === 'function') {
      target.removeListener(listener)
    }
  }

  /** IDs this module registered and has not withdrawn itself */
  getOwnServiceIds(): string[] {
    return [...new Set(this.ownRegistrations.map(registration => registration.serviceId))]
  }

  /**
   * Withdraw everything this module registered.
   * Returns the IDs that were actually removed.
   */
  releaseAll(): string[] {
    const target = this.target as
      Partial<IObservableServiceRegistry> & Partial<IModuleScopedServiceRegistry>
    for (const listener of this.ownListeners) {
      target.removeListener?.(listener)
    }
    this.ownListeners.clear()

    const released: string[] = []
    // Reverse order, so a service registered later is withdrawn first
    for (const registration of [...this.ownRegistrations].reverse()) {
      if (registration.unregister()) {
        released.push(registration.serviceId)
      }
    }
    this.ownRegistrations = []

    // What this module *held* under `module` scope goes too. Its own
    // registrations are gone above; these are other modules' services that were
    // instantiated for this one, and nothing else would ever drop them
    target.releaseConsumer?.(this.moduleId)

    return released
  }
}
