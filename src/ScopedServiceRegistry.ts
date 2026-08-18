/**
 * TSM - TypeScript Module System
 * Module-scoped service registry
 */

import type {
  ObservableServiceRegistry as IObservableServiceRegistry,
  ServiceRegistry as IServiceRegistry,
  InjectableConstructor,
  BindClassOptions,
  ServiceCardinality,
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

  private propertiesFor(
    id: string,
    given?: ServiceProperties
  ): ServiceProperties | undefined {
    return given ?? this.declaredProperties.get(id)
  }

  register<T>(
    id: string,
    service: T,
    options: {
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
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
    id: string,
    factory: () => T,
    options: {
      scope?: 'singleton' | 'transient'
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
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
    id: string,
    ctor: InjectableConstructor<T>,
    options: BindClassOptions = {}
  ): ServiceRegistration {
    // Alias registrations from `implements` are removed with their primary,
    // so they need no separate tracking
    return this.track(this.target.bindClass(id, ctor, {
      ...options,
      providedBy: options.providedBy ?? this.moduleId,
      ranking: this.rankingFor(id, options.ranking),
      properties: this.propertiesFor(id, options.properties)
    }))
  }

  private track(registration: ServiceRegistration): ServiceRegistration {
    this.ownRegistrations.push(registration)
    return registration
  }

  get<T>(id: string): T | undefined {
    return this.target.get<T>(id)
  }

  getRequired<T>(id: string): T {
    return this.target.getRequired<T>(id)
  }

  getAll<T>(idPattern: string): T[] {
    return this.target.getAll<T>(idPattern)
  }

  has(id: string): boolean {
    return this.target.has(id)
  }

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
  } {
    return this.target.checkRequirements(requirements)
  }

  getServiceReferences(id: string, target?: string): ServiceReference[] {
    return this.target.getServiceReferences(id, target)
  }

  resolveReference<T>(reference: ServiceReference): T | undefined {
    return this.target.resolveReference<T>(reference)
  }

  countProviders(id: string, target?: string): number {
    return this.target.countProviders(id, target)
  }

  getMatching<T>(id: string, target: string): T | undefined {
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

  getBindingInfo(id: string): { scope: 'singleton' | 'transient'; providedBy?: string } | undefined {
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
  addListener(listener: ServiceRegistryListener): void {
    const target = this.target as Partial<IObservableServiceRegistry>
    if (typeof target.addListener !== 'function') {
      throw new Error(
        `Service registry does not support listeners, so module ${this.moduleId} cannot observe it`
      )
    }
    this.ownListeners.add(listener)
    target.addListener(listener)
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
    const target = this.target as Partial<IObservableServiceRegistry>
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
    return released
  }
}
