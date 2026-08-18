/**
 * TSM - TypeScript Module System
 * Service Registry - DI container for module services
 */

import type {
  ServiceRegistry as IServiceRegistry,
  InjectableConstructor,
  BindClassOptions,
  ServiceRegistryEvent,
  ServiceRegistryListener
} from './types.js'

// Re-exported for backwards compatibility; the definitions live in types.ts
export type { ServiceRegistryEvent, ServiceRegistryListener }
import { getInjectMetadata, getPropertyInjectMetadata, isInjectable, getScopeMetadata, type PropertyInjectMetadata } from './decorators.js'

/**
 * Dependency metadata for a bound class
 */
interface DependencyInfo {
  serviceId: string
  optional: boolean
}

/**
 * Service binding - how a service is created/retrieved
 */
interface ServiceBinding {
  /** Factory function to create the service */
  factory?: (...args: unknown[]) => unknown
  /** Singleton instance (if already created) */
  instance?: unknown
  /** Scope: singleton (default) or transient */
  scope: 'singleton' | 'transient'
  /** Module that provided this service */
  providedBy?: string
  /** Dependencies for automatic resolution (set by bindClass) */
  deps?: DependencyInfo[]
  /** Property dependencies for injection after construction (set by bindClass) */
  propertyDeps?: PropertyInjectMetadata[]
  /** Alias target — if set, this binding delegates to another ID */
  aliasOf?: string
}

/**
 * Default service registry implementation
 * Supports singleton and transient scopes with factory functions
 * and decorator-based constructor injection
 */
export class DefaultServiceRegistry implements IServiceRegistry {
  private services = new Map<string, unknown>()
  private bindings = new Map<string, ServiceBinding>()
  private listeners = new Set<ServiceRegistryListener>()
  /** Reverse index: primary service ID -> alias IDs created for it */
  private aliasesOf = new Map<string, Set<string>>()

  /**
   * Register a service instance directly
   */
  register<T>(id: string, service: T, options: { providedBy?: string } = {}): void {
    const existed = this.services.has(id) || this.bindings.has(id)
    this.dropAliasesOf(id)
    this.services.set(id, service)
    // Also create a binding for consistency
    this.bindings.set(id, {
      instance: service,
      scope: 'singleton',
      providedBy: options.providedBy
    })

    this.notify({
      type: existed ? 'updated' : 'registered',
      serviceId: id,
      service
    })
  }

  /**
   * Bind a factory function for lazy instantiation
   */
  bind<T>(
    id: string,
    factory: () => T,
    options: { scope?: 'singleton' | 'transient'; providedBy?: string } = {}
  ): void {
    const existed = this.bindings.has(id)
    this.dropAliasesOf(id)
    this.bindings.set(id, {
      factory,
      scope: options.scope ?? 'singleton',
      providedBy: options.providedBy
    })

    this.notify({
      type: existed ? 'updated' : 'registered',
      serviceId: id,
      service: undefined // Not instantiated yet
    })
  }

  /**
   * Bind a class with automatic constructor injection.
   * The class must be decorated with @injectable() and declare dependencies via @inject().
   *
   * Scope resolution order: options.scope > @singleton()/@transient() decorator > 'singleton' default
   *
   * If options.implements is provided, additional alias bindings are created that
   * delegate to the primary ID, so the same singleton is shared.
   */
  bindClass<T>(
    id: string,
    ctor: InjectableConstructor<T>,
    options: BindClassOptions = {}
  ): void {
    if (!isInjectable(ctor)) {
      throw new Error(
        `Class '${ctor.name}' is not decorated with @injectable(). ` +
        `Add @injectable() to use bindClass().`
      )
    }

    const metadata = getInjectMetadata(ctor)
    const propertyMetadata = getPropertyInjectMetadata(ctor)
    const decoratorScope = getScopeMetadata(ctor)
    const scope = options.scope ?? decoratorScope ?? 'singleton'

    const existed = this.bindings.has(id)
    this.dropAliasesOf(id)
    this.bindings.set(id, {
      factory: (...resolvedDeps: unknown[]) => new ctor(...resolvedDeps),
      scope,
      providedBy: options.providedBy,
      deps: metadata.map(m => ({ serviceId: m.serviceId, optional: m.optional })),
      propertyDeps: propertyMetadata.length > 0 ? propertyMetadata : undefined
    })

    this.notify({
      type: existed ? 'updated' : 'registered',
      serviceId: id,
      service: undefined
    })

    // Create alias bindings for implemented interfaces
    if (options.implements) {
      let aliases = this.aliasesOf.get(id)
      if (!aliases) {
        aliases = new Set<string>()
        this.aliasesOf.set(id, aliases)
      }

      for (const interfaceId of options.implements) {
        const previous = this.bindings.get(interfaceId)
        const aliasExisted = previous !== undefined
        // Detach the ID from a primary it aliased before
        if (previous?.aliasOf && previous.aliasOf !== id) {
          this.aliasesOf.get(previous.aliasOf)?.delete(interfaceId)
        }

        this.bindings.set(interfaceId, {
          scope,
          aliasOf: id
        })
        aliases.add(interfaceId)

        this.notify({
          type: aliasExisted ? 'updated' : 'registered',
          serviceId: interfaceId,
          service: undefined
        })
      }
    }
  }

  /**
   * Get a service by ID
   * For singletons: creates instance on first access, returns same instance thereafter
   * For transients: creates new instance on each call
   * Automatically resolves dependencies declared via @inject()
   */
  get<T>(id: string, _resolving?: Set<string>): T | undefined {
    // Check direct instances first (for backwards compatibility)
    if (this.services.has(id)) {
      return this.services.get(id) as T
    }

    // Check bindings
    const binding = this.bindings.get(id)
    if (!binding) {
      return undefined
    }

    // Follow alias
    if (binding.aliasOf) {
      return this.get<T>(binding.aliasOf, _resolving)
    }

    // If singleton and already instantiated, return instance
    if (binding.scope === 'singleton' && binding.instance !== undefined) {
      return binding.instance as T
    }

    // Create instance via factory
    if (binding.factory) {
      const resolving = _resolving ?? new Set<string>()

      // Circular dependency detection
      if (resolving.has(id)) {
        const chain = [...resolving, id].join(' → ')
        throw new Error(`Circular dependency detected: ${chain}`)
      }
      resolving.add(id)

      // Resolve dependencies
      const args = (binding.deps ?? []).map(dep => {
        const resolved = this.get(dep.serviceId, resolving)
        if (resolved === undefined && !dep.optional) {
          throw new Error(
            `Dependency '${dep.serviceId}' not found (required by '${id}')`
          )
        }
        return resolved
      })

      const instance = binding.factory(...args) as T

      // Resolve property injections
      if (binding.propertyDeps) {
        for (const prop of binding.propertyDeps) {
          const resolved = this.get(prop.serviceId, resolving)
          if (resolved === undefined && !prop.optional) {
            throw new Error(
              `Property dependency '${prop.serviceId}' not found (required by '${id}' on property '${String(prop.propertyKey)}')`
            )
          }
          (instance as Record<string | symbol, unknown>)[prop.propertyKey] = resolved
        }
      }

      // Store singleton instance for reuse
      if (binding.scope === 'singleton') {
        binding.instance = instance
        this.services.set(id, instance)
      }

      return instance
    }

    return undefined
  }

  /**
   * Get all services matching a pattern
   * Pattern can use * as wildcard
   */
  getAll<T>(idPattern: string): T[] {
    const regex = new RegExp('^' + idPattern.replace(/\*/g, '.*') + '$')
    const result: T[] = []

    for (const [id, service] of this.services) {
      if (regex.test(id)) {
        result.push(service as T)
      }
    }

    return result
  }

  /**
   * Check if a service exists (registered or bound)
   */
  has(id: string): boolean {
    return this.resolveExisting(id, new Set()) !== undefined
  }

  /**
   * Resolve an ID to the binding that would actually serve it.
   * Follows aliases, so an alias whose target is gone resolves to undefined.
   */
  private resolveExisting(id: string, seen: Set<string>): ServiceBinding | undefined {
    if (seen.has(id)) return undefined
    seen.add(id)

    if (this.services.has(id)) {
      return this.bindings.get(id) ?? { scope: 'singleton', instance: this.services.get(id) }
    }

    const binding = this.bindings.get(id)
    if (!binding) return undefined
    if (binding.aliasOf) return this.resolveExisting(binding.aliasOf, seen)
    return binding
  }

  /**
   * Get a required service - throws if not available
   */
  getRequired<T>(id: string): T {
    const service = this.get<T>(id)
    if (service === undefined) {
      throw new Error(`Required service not found: ${id}`)
    }
    return service
  }

  /**
   * Check if all required services are available
   */
  checkRequirements(requirements: Array<{ id: string; optional?: boolean }>): {
    satisfied: boolean
    missing: string[]
  } {
    const missing: string[] = []
    for (const req of requirements) {
      if (!req.optional && !this.has(req.id)) {
        missing.push(req.id)
      }
    }
    return {
      satisfied: missing.length === 0,
      missing
    }
  }

  /**
   * Unregister a service
   */
  unregister(id: string): boolean {
    const service = this.services.get(id)
    const binding = this.bindings.get(id)
    const hadBinding = binding !== undefined

    if (service === undefined && !hadBinding) {
      return false
    }

    // An alias only detaches itself from its target
    if (binding?.aliasOf) {
      this.aliasesOf.get(binding.aliasOf)?.delete(id)
    }

    this.services.delete(id)
    this.bindings.delete(id)
    this.notify({
      type: 'unregistered',
      serviceId: id,
      service
    })

    // Aliases pointing here would otherwise survive as dangling entries,
    // where has() reported the service while get() returned undefined
    this.dropAliasesOf(id)

    return true
  }

  /**
   * Remove every alias binding that delegates to the given primary ID
   */
  private dropAliasesOf(primaryId: string): void {
    const aliases = this.aliasesOf.get(primaryId)
    if (!aliases) return
    this.aliasesOf.delete(primaryId)

    for (const aliasId of aliases) {
      const alias = this.bindings.get(aliasId)
      if (alias?.aliasOf !== primaryId) continue // reused for something else
      this.bindings.delete(aliasId)
      this.services.delete(aliasId)
      this.notify({
        type: 'unregistered',
        serviceId: aliasId,
        service: undefined
      })
    }
  }

  /**
   * Get information about a binding
   */
  getBindingInfo(id: string): { scope: 'singleton' | 'transient'; providedBy?: string } | undefined {
    const binding = this.bindings.get(id)
    if (!binding) return undefined
    return {
      scope: binding.scope,
      providedBy: binding.providedBy
    }
  }

  /**
   * Get all registered service IDs
   */
  getServiceIds(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Clear all services
   */
  clear(): void {
    const ids = new Set([...this.services.keys(), ...this.bindings.keys()])
    for (const id of ids) {
      this.unregister(id)
    }
  }

  /**
   * Add a listener for service events
   */
  addListener(listener: ServiceRegistryListener): void {
    this.listeners.add(listener)
  }

  /**
   * Remove a listener
   */
  removeListener(listener: ServiceRegistryListener): void {
    this.listeners.delete(listener)
  }

  private notify(event: ServiceRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onServiceEvent(event)
      } catch (error) {
        console.error('Service registry listener error:', error)
      }
    }
  }
}
