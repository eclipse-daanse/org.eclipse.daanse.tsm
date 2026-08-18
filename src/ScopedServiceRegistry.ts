/**
 * TSM - TypeScript Module System
 * Module-scoped service registry
 */

import type {
  ServiceRegistry as IServiceRegistry,
  InjectableConstructor,
  BindClassOptions
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
export class ScopedServiceRegistry implements IServiceRegistry {
  /** Primary IDs registered through this facade, in registration order */
  private ownIds = new Set<string>()

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

  /** IDs this module registered and has not withdrawn itself */
  getOwnServiceIds(): string[] {
    return [...this.ownIds]
  }

  /**
   * Withdraw everything this module registered.
   * Returns the IDs that were actually removed.
   */
  releaseAll(): string[] {
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
