/**
 * TSM - TypeScript Module System
 * Module-scoped service registry
 */

import type {
  ObservableServiceRegistry as IObservableServiceRegistry,
  ServiceRegistry as IServiceRegistry,
  InjectableConstructor,
  BindClassOptions,
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
  /** Primary IDs registered through this facade, in registration order */
  private ownIds = new Set<string>()
  /** Listeners this module added, so they do not outlive it */
  private ownListeners = new Set<ServiceRegistryListener>()

  constructor(
    private readonly moduleId: string,
    private readonly target: IServiceRegistry
  ) {}

  register<T>(id: string, service: T, options: { providedBy?: string } = {}): void {
    this.ownIds.add(id)
    this.target.register(id, service, { providedBy: options.providedBy ?? this.moduleId })
  }

  bind<T>(
    id: string,
    factory: () => T,
    options: { scope?: 'singleton' | 'transient'; providedBy?: string } = {}
  ): void {
    this.ownIds.add(id)
    this.target.bind(id, factory, { ...options, providedBy: options.providedBy ?? this.moduleId })
  }

  bindClass<T>(
    id: string,
    ctor: InjectableConstructor<T>,
    options: BindClassOptions = {}
  ): void {
    this.ownIds.add(id)
    // Alias bindings from `implements` are removed with their primary,
    // so they need no separate tracking
    this.target.bindClass(id, ctor, { ...options, providedBy: options.providedBy ?? this.moduleId })
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

  checkRequirements(requirements: Array<{ id: string; optional?: boolean }>): {
    satisfied: boolean
    missing: string[]
  } {
    return this.target.checkRequirements(requirements)
  }

  unregister(id: string): boolean {
    this.ownIds.delete(id)
    return this.target.unregister(id)
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
    return [...this.ownIds]
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
    for (const id of [...this.ownIds].reverse()) {
      if (this.target.unregister(id)) {
        released.push(id)
      }
    }
    this.ownIds.clear()
    return released
  }
}
