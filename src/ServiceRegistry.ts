/**
 * TSM - TypeScript Module System
 * Service Registry - DI container for module services
 */

import type {
  ServiceRegistry as IServiceRegistry,
  InjectableConstructor,
  BindClassOptions,
  ServiceQuery,
  ServiceProperties,
  ServiceReference,
  ServiceRegistration,
  ServiceRegistryEvent,
  ServiceRegistryListener
} from './types.js'

// Re-exported for backwards compatibility; the definitions live in types.ts
export type { ServiceRegistryEvent, ServiceRegistryListener }
import { getInjectMetadata, getPropertyInjectMetadata, isInjectable, getScopeMetadata, type PropertyInjectMetadata } from './decorators.js'
import { createServiceFilter, type ServiceFilter } from './serviceFilter.js'
import { requiresAtLeastOne } from './cardinality.js'

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
  /** Higher wins when several registrations share an ID */
  ranking: number
  /** Registration order, used as tie-break and as identity */
  seq: number
  /** Properties a target filter selects on */
  properties?: ServiceProperties
  /**
   * What produced this registration, when the provider alone is not specific
   * enough: the class for `bindClass()`. Two classes in one module offering the
   * same ID are two providers, not one replacing the other.
   */
  origin?: unknown
  /**
   * Tells apart several registrations of one origin in one module — one
   * component class instantiated per factory configuration. Part of the
   * registration's identity, alongside provider and origin.
   */
  instanceKey?: string
  /** Dependencies for automatic resolution (set by bindClass) */
  deps?: DependencyInfo[]
  /** Property dependencies for injection after construction (set by bindClass) */
  propertyDeps?: PropertyInjectMetadata[]
  /** Alias target — if set, this binding delegates to another ID */
  aliasOf?: string
  /**
   * The registration the alias belongs to, by its `seq`.
   *
   * Without it an alias delegates to whatever is currently visible under
   * `aliasOf`, so a later registration under that ID would answer for an
   * interface it never claimed.
   */
  aliasSeq?: number
}

/**
 * Properties a filter is matched against: what the registration declared, plus
 * the two the registry knows itself. Named as in OSGi, so a filter written for
 * a Java @Reference reads the same here.
 */
function propertiesOf(binding: ServiceBinding): ServiceProperties {
  const properties: ServiceProperties = { ...binding.properties }
  properties['service.ranking'] = binding.ranking
  if (binding.providedBy !== undefined) {
    properties['service.providedBy'] = binding.providedBy
  }
  return properties
}

/**
 * The identity a reference and its registration handle share.
 *
 * One function rather than two literals, so the two can never drift: a
 * registrant finds its own reference by comparing them.
 */
function referenceKey(id: string, binding: ServiceBinding): string {
  return `${id}#${binding.seq}`
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
  /** Reverse index: service ID -> binding IDs that inject it (from bindClass) */
  private injectedInto = new Map<string, Set<string>>()
  /**
   * Registrations for an ID that are currently outranked by the visible one.
   *
   * Readers still see a single service per ID, but a second provider is kept
   * instead of dropped: when the visible one goes, the best of these takes
   * over rather than the ID falling silent.
   */
  private shadowed = new Map<string, ServiceBinding[]>()
  private nextSeq = 1
  /** Parsed target filters, so a repeated lookup does not re-parse */
  private filterCache = new Map<string, ServiceFilter>()

  /**
   * Install a registration and decide whether it becomes the visible one.
   *
   * A registration from the same provider replaces its own earlier one, so
   * registering twice under one ID does not accumulate.
   */
  private addRegistration(id: string, binding: ServiceBinding): ServiceRegistration {
    const previouslyKnown = this.bindings.has(id)
    const visible = this.bindings.get(id)

    const sameSource = (candidate: ServiceBinding): boolean =>
      candidate.providedBy === binding.providedBy &&
      candidate.origin === binding.origin &&
      candidate.instanceKey === binding.instanceKey

    // Drop this source's earlier registration, wherever it sits
    this.removeShadowed(id, sameSource)
    const replacesVisible = visible !== undefined && sameSource(visible)

    if (!visible || replacesVisible || this.outranks(binding, visible)) {
      if (visible && !replacesVisible) {
        this.pushShadowed(id, visible)
      }
      if (replacesVisible) {
        this.dropAliasesOf(id, visible.seq)
        this.dropInjectionEdges(id)
      }
      this.setVisible(id, binding)
      this.notify({
        type: previouslyKnown ? 'updated' : 'registered',
        serviceId: id,
        service: binding.instance
      })
    } else {
      // Outranked: kept as a stand-in, no change for readers
      this.pushShadowed(id, binding)
    }

    return this.createHandle(id, binding)
  }

  private outranks(candidate: ServiceBinding, incumbent: ServiceBinding): boolean {
    if (candidate.ranking !== incumbent.ranking) {
      return candidate.ranking > incumbent.ranking
    }
    // Equal ranking: the later registration wins, as it did before ranking existed
    return candidate.seq > incumbent.seq
  }

  private setVisible(id: string, binding: ServiceBinding): void {
    this.invalidateInjectors(id, new Set())
    this.bindings.set(id, binding)
    if (binding.instance !== undefined) {
      this.services.set(id, binding.instance)
    } else {
      this.services.delete(id)
    }
  }

  private pushShadowed(id: string, binding: ServiceBinding): void {
    const bench = this.shadowed.get(id)
    if (bench) {
      bench.push(binding)
    } else {
      this.shadowed.set(id, [binding])
    }
  }

  private removeShadowed(id: string, matches: (binding: ServiceBinding) => boolean): boolean {
    const bench = this.shadowed.get(id)
    if (!bench) return false

    const kept = bench.filter(binding => !matches(binding))
    if (kept.length === bench.length) return false

    if (kept.length === 0) {
      this.shadowed.delete(id)
    } else {
      this.shadowed.set(id, kept)
    }
    return true
  }

  /** All registrations for an ID, best first */
  private registrationsOf(id: string): ServiceBinding[] {
    const visible = this.bindings.get(id)
    const bench = [...(this.shadowed.get(id) ?? [])].sort((a, b) =>
      a.ranking !== b.ranking ? b.ranking - a.ranking : b.seq - a.seq
    )
    return visible ? [visible, ...bench] : bench
  }

  private createHandle(id: string, binding: ServiceBinding): ServiceRegistration {
    return {
      serviceId: id,
      providedBy: binding.providedBy,
      ranking: binding.ranking,
      key: referenceKey(id, binding),
      unregister: () => this.unregisterRegistration(id, binding.seq),
      setProperties: (properties: ServiceProperties, options = {}) =>
        this.updateProperties(id, binding, properties, options),
      resolve: <T>() => {
        // Gone already: nothing to resolve
        if (!this.registrationsOf(id).some(candidate => candidate.seq === binding.seq)) {
          return undefined
        }
        return this.instantiate<T>(id, binding, new Set())
      }
    }
  }

  /**
   * Replace the properties of one registration, and of the alias registrations
   * that belong to it.
   *
   * The properties declared for an individual ID are kept underneath: the
   * manifest describes where a service belongs, the new properties — in practice
   * a component's configuration — win over that per key.
   */
  private updateProperties(
    id: string,
    binding: ServiceBinding,
    properties: ServiceProperties,
    options: { ranking?: number; propertiesById?: Record<string, ServiceProperties> }
  ): boolean {
    const live = this.registrationsOf(id).find(candidate => candidate.seq === binding.seq)
    if (!live) return false

    const { ranking, propertiesById } = options

    const apply = (target: ServiceBinding, serviceId: string): void => {
      target.properties = { ...(propertiesById?.[serviceId] ?? properties) }
      if (ranking !== undefined) {
        target.ranking = ranking
      }
    }

    apply(live, id)

    for (const aliasId of this.aliasesOf.get(id) ?? []) {
      const alias = this.registrationsOf(aliasId)
        .find(candidate => candidate.aliasSeq === binding.seq)
      if (alias) {
        apply(alias, aliasId)
        if (ranking !== undefined) this.reevaluateVisibility(aliasId)
      }
    }

    if (ranking !== undefined) {
      this.reevaluateVisibility(id)
    }

    // A property change is not a new service; consumers keep the object they
    // hold, which is the point of not going through unregister/register
    this.notify({ type: 'updated', serviceId: id, service: live.instance })
    return true
  }

  /**
   * Decide again which registration for an ID is the visible one.
   *
   * Only needed after a ranking changed underneath: registration order alone
   * cannot have moved anything, so nothing else disturbs the bench.
   */
  private reevaluateVisibility(id: string): void {
    const all = this.registrationsOf(id)
    if (all.length < 2) return

    const best = all.reduce((winner, candidate) =>
      this.outranks(candidate, winner) ? candidate : winner
    )
    const visible = this.bindings.get(id)
    if (visible === best) return

    this.removeShadowed(id, candidate => candidate.seq === best.seq)
    if (visible) this.pushShadowed(id, visible)
    this.setVisible(id, best)
  }

  /**
   * Withdraw one specific registration. When it was the visible one, the best
   * remaining registration takes over instead of the ID falling silent.
   */
  private unregisterRegistration(id: string, seq: number): boolean {
    const visible = this.bindings.get(id)

    if (visible?.seq !== seq) {
      const removed = this.removeShadowed(id, binding => binding.seq === seq)
      // A stand-in has its own alias registrations, and those would survive it:
      // the interface would keep pointing at a registration that is gone
      if (removed) this.dropAliasesOf(id, seq)
      return removed
    }

    const successor = this.registrationsOf(id).find(binding => binding.seq !== seq)
    if (!successor) {
      return this.unregister(id)
    }

    this.removeShadowed(id, binding => binding.seq === successor.seq)
    this.dropAliasesOf(id, seq)
    this.dropInjectionEdges(id)
    this.setVisible(id, successor)
    this.notify({
      type: 'updated',
      serviceId: id,
      service: successor.instance
    })
    return true
  }

  /**
   * Register a service instance directly
   */
  register<T>(
    id: string,
    service: T,
    options: {
      providedBy?: string
      ranking?: number
      properties?: ServiceProperties
    } = {}
  ): ServiceRegistration {
    return this.addRegistration(id, {
      instance: service,
      scope: 'singleton',
      providedBy: options.providedBy,
      ranking: options.ranking ?? 0,
      seq: this.nextSeq++,
      properties: options.properties
    })
  }

  /**
   * Bind a factory function for lazy instantiation
   */
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
    return this.addRegistration(id, {
      factory,
      scope: options.scope ?? 'singleton',
      providedBy: options.providedBy,
      ranking: options.ranking ?? 0,
      seq: this.nextSeq++,
      properties: options.properties
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
  ): ServiceRegistration {
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

    for (const dependency of [...metadata, ...propertyMetadata]) {
      let injectors = this.injectedInto.get(dependency.serviceId)
      if (!injectors) {
        injectors = new Set<string>()
        this.injectedInto.set(dependency.serviceId, injectors)
      }
      injectors.add(id)
    }

    const primarySeq = this.nextSeq++
    const registration = this.addRegistration(id, {
      factory: (...resolvedDeps: unknown[]) => new ctor(...resolvedDeps),
      scope,
      // The class identifies the registration, so a second class from the same
      // module does not replace this one
      origin: ctor,
      providedBy: options.providedBy,
      ranking: options.ranking ?? 0,
      seq: primarySeq,
      properties: options.propertiesById?.[id] ?? options.properties,
      instanceKey: options.instanceKey,
      deps: metadata.map(m => ({ serviceId: m.serviceId, optional: m.optional })),
      propertyDeps: propertyMetadata.length > 0 ? propertyMetadata : undefined
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
        // Detach the ID from a primary it aliased before
        if (previous?.aliasOf && previous.aliasOf !== id) {
          this.aliasesOf.get(previous.aliasOf)?.delete(interfaceId)
        }

        // An alias is a registration of its own, so two classes implementing the
        // same interface rank against each other instead of overwriting
        this.addRegistration(interfaceId, {
          scope,
          aliasOf: id,
          aliasSeq: primarySeq,
          origin: ctor,
          providedBy: options.providedBy,
          ranking: options.ranking ?? 0,
          seq: this.nextSeq++,
          instanceKey: options.instanceKey,
          // The interface is what consumers filter on, so it may carry its own
          properties: options.propertiesById?.[interfaceId] ?? options.properties
        })
        aliases.add(interfaceId)
      }
    }

    return registration
  }

  /**
   * Get a service by ID
   * For singletons: creates instance on first access, returns same instance thereafter
   * For transients: creates new instance on each call
   * Automatically resolves dependencies declared via @inject()
   */
  /**
   * Construct an injectable class with its dependencies injected, without
   * registering it: the same resolution as `bindClass()`, minus the registration.
   */
  construct<T>(ctor: InjectableConstructor<T>): T {
    if (!isInjectable(ctor)) {
      throw new Error(
        `Class '${ctor.name}' is not decorated with @injectable() or @component(), ` +
        `so its dependencies are unknown`
      )
    }

    const resolving = new Set<string>()

    const args = getInjectMetadata(ctor).map(dependency => {
      const resolved = this.get(dependency.serviceId, resolving)
      if (resolved === undefined && !dependency.optional) {
        throw new Error(
          `Dependency '${dependency.serviceId}' not found (required by '${ctor.name}')`
        )
      }
      return resolved
    })

    const instance = new ctor(...args)

    for (const property of getPropertyInjectMetadata(ctor)) {
      const resolved = this.get(property.serviceId, resolving)
      if (resolved === undefined && !property.optional) {
        throw new Error(
          `Property dependency '${property.serviceId}' not found ` +
          `(required by '${ctor.name}' on property '${String(property.propertyKey)}')`
        )
      }
      (instance as Record<string | symbol, unknown>)[property.propertyKey] = resolved
    }

    return instance
  }

  get<T>(id: string, _resolving?: Set<string>): T | undefined {
    // Check direct instances first (for backwards compatibility)
    if (this.services.has(id)) {
      return this.services.get(id) as T
    }

    const binding = this.bindings.get(id)
    if (!binding) {
      return undefined
    }

    return this.instantiate<T>(id, binding, _resolving ?? new Set<string>())
  }

  /**
   * Resolve one binding: follow an alias, reuse a singleton, or build via the
   * factory with its dependencies injected.
   *
   * Split out of `get()` because an outranked registration has to be
   * resolvable too, even though the ID answers with a different one.
   */
  private instantiate<T>(
    id: string,
    binding: ServiceBinding,
    resolving: Set<string>
  ): T | undefined {
    if (binding.aliasOf) {
      const target = this.aliasTarget(binding)
      if (!target) return undefined
      return this.instantiate<T>(binding.aliasOf, target, resolving)
    }

    if (binding.scope === 'singleton' && binding.instance !== undefined) {
      return binding.instance as T
    }

    if (!binding.factory) {
      return undefined
    }

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

    if (binding.scope === 'singleton') {
      binding.instance = instance
      // The ID cache belongs to the visible registration only
      if (this.bindings.get(id) === binding) {
        this.services.set(id, instance)
      }
    }

    return instance
  }

  /**
   * Get all instantiated services whose ID matches a wildcard pattern.
   *
   * @deprecated Matches ID names rather than registrations, and only sees what
   * has already been instantiated. Use `getServiceReferences(id, target?)`.
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
      return this.bindings.get(id)
    }

    const binding = this.bindings.get(id)
    if (!binding) return undefined
    if (binding.aliasOf) {
      const target = this.aliasTarget(binding)
      return target ? this.resolveExisting(binding.aliasOf, seen) && target : undefined
    }
    return binding
  }

  /**
   * The registration an alias stands for: the one it was created with, not
   * whatever is visible under that ID now.
   */
  private aliasTarget(alias: ServiceBinding): ServiceBinding | undefined {
    if (alias.aliasOf === undefined) return undefined

    const candidates = this.registrationsOf(alias.aliasOf)
    if (alias.aliasSeq === undefined) return candidates[0]

    return candidates.find(candidate => candidate.seq === alias.aliasSeq)
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
  checkRequirements(requirements: ServiceQuery[]): {
    satisfied: boolean
    missing: string[]
  } {
    const missing: string[] = []
    for (const req of requirements) {
      // Cardinality decides how many providers are needed; the n-variants are
      // satisfied by one, so only an empty ID is missing
      if (!requiresAtLeastOne(req)) continue

      // A target filter narrows what counts: an unfiltered provider does not
      // satisfy a requirement that asked for a specific one
      const available = req.target !== undefined
        ? this.countProviders(req.id, req.target) > 0
        : this.has(req.id)

      if (!available) {
        missing.push(req.id)
      }
    }
    return {
      satisfied: missing.length === 0,
      missing
    }
  }

  /**
   * Every registration for an ID, best first, without instantiating any of them.
   *
   * Collecting must not build objects nobody asked for, which is why this
   * returns references rather than services.
   */
  getServiceReferences(id: string, target?: string): ServiceReference[] {
    const filter = target !== undefined ? this.filterFor(target) : undefined

    return this.registrationsOf(id)
      .filter(binding => !filter || filter(propertiesOf(binding)))
      .map(binding => ({
        serviceId: id,
        providedBy: binding.providedBy,
        ranking: binding.ranking,
        scope: binding.scope,
        instantiated: binding.instance !== undefined,
        properties: propertiesOf(binding) as ServiceProperties,
        key: referenceKey(id, binding)
      }))
  }

  /**
   * The best service for an ID whose properties match the filter.
   *
   * `get(id)` answers with the highest-ranked registration regardless of
   * properties; a consumer that declared a target needs this one.
   */
  getMatching<T>(id: string, target: string): T | undefined {
    const [reference] = this.getServiceReferences(id, target)
    return reference ? this.resolveReference<T>(reference) : undefined
  }

  /**
   * Parse a filter once and remember it. An invalid filter throws here rather
   * than quietly matching nothing.
   */
  private filterFor(target: string): ServiceFilter {
    const cached = this.filterCache.get(target)
    if (cached) return cached

    const filter = createServiceFilter(target)
    this.filterCache.set(target, filter)
    return filter
  }

  /**
   * Resolve one reference from getServiceReferences().
   *
   * The visible registration resolves like `get()`; an outranked one is built
   * from its own binding, so a collection can use every provider even though
   * only one of them answers to the ID.
   */
  resolveReference<T>(reference: ServiceReference): T | undefined {
    const seq = Number(reference.key.slice(reference.key.lastIndexOf('#') + 1))
    const binding = this.registrationsOf(reference.serviceId)
      .find(candidate => candidate.seq === seq)
    if (!binding) return undefined

    if (this.bindings.get(reference.serviceId)?.seq === seq) {
      return this.get<T>(reference.serviceId)
    }
    return this.instantiate<T>(reference.serviceId, binding, new Set())
  }

  /** How many registrations an ID carries, optionally matching a target filter */
  countProviders(id: string, target?: string): number {
    return this.getServiceReferences(id, target).length
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

    // Every registration for the ID goes, stand-ins included — otherwise the ID
    // would report as absent while providers are still on the bench
    for (const registration of this.registrationsOf(id)) {
      if (registration.aliasOf) {
        this.aliasesOf.get(registration.aliasOf)?.delete(id)
      }
    }
    this.shadowed.delete(id)

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
    this.dropInjectionEdges(id)

    // Singletons that were built with this service still hold it
    this.invalidateInjectors(id, new Set())

    return true
  }

  /**
   * Forget which services a binding injects
   */
  private dropInjectionEdges(id: string): void {
    for (const [serviceId, injectors] of this.injectedInto) {
      if (!injectors.delete(id)) continue
      if (injectors.size === 0) {
        this.injectedInto.delete(serviceId)
      }
    }
  }

  /**
   * Discard singleton instances built with a service that changed, transitively.
   *
   * A singleton receives its dependencies once, at construction, so after the
   * service is gone it would keep serving the old one. The next `get()` builds
   * the instance again with whatever is available then.
   *
   * Only reaches classes bound through `bindClass()`, whose dependencies the
   * registry knows. What a hand-written `bind()` factory pulls from the registry
   * is invisible here and cannot be invalidated — see the notes on dynamic
   * requirements in the README.
   */
  private invalidateInjectors(serviceId: string, seen: Set<string>): void {
    if (seen.has(serviceId)) return
    seen.add(serviceId)

    for (const injectorId of this.injectedInto.get(serviceId) ?? []) {
      const binding = this.bindings.get(injectorId)
      // Only a rebuildable instance may be discarded
      if (!binding?.factory || binding.instance === undefined) continue

      binding.instance = undefined
      this.services.delete(injectorId)

      // Whoever received that instance is stale as well
      this.invalidateInjectors(injectorId, seen)
    }
  }

  /**
   * Remove every alias binding that delegates to the given primary ID
   */
  /**
   * Remove the alias registrations a primary registration created.
   *
   * @param primarySeq Restricts it to the aliases of that one registration.
   *   Needed once a class can be registered more than once under an ID — one
   *   instance per factory configuration — where dropping the first alias found
   *   would take another instance's interface with it. Without it, every alias
   *   of the ID goes, which is what withdrawing the ID itself means.
   */
  private dropAliasesOf(primaryId: string, primarySeq?: number): void {
    const aliases = this.aliasesOf.get(primaryId)
    if (!aliases) return

    const remaining = new Set<string>()

    for (const aliasId of aliases) {
      // Only this primary's own alias registrations go. Another implementation
      // of the same interface stays and takes over if it was the stand-in.
      const own = this.registrationsOf(aliasId).filter(registration =>
        registration.aliasOf === primaryId &&
        (primarySeq === undefined || registration.aliasSeq === primarySeq)
      )
      if (own.length === 0) {
        // Somebody else's registration under this interface, or none left
        if (primarySeq !== undefined) remaining.add(aliasId)
        continue
      }

      for (const alias of own) {
        this.unregisterRegistration(aliasId, alias.seq)
      }

      // Another configuration of the same class may still answer to it
      if (
        primarySeq !== undefined &&
        this.registrationsOf(aliasId).some(registration => registration.aliasOf === primaryId)
      ) {
        remaining.add(aliasId)
      }
    }

    if (remaining.size > 0) {
      this.aliasesOf.set(primaryId, remaining)
    } else {
      this.aliasesOf.delete(primaryId)
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
    this.injectedInto.clear()
    const ids = new Set([...this.services.keys(), ...this.bindings.keys()])
    for (const id of ids) {
      this.unregister(id)
    }
  }

  /**
   * Resolve once a service is available.
   *
   * Resolves immediately when it is already there, otherwise on the
   * registration that provides it. Replaces polling the registry in a loop.
   *
   * @param options.timeoutMs Reject after this long instead of waiting forever
   */
  whenAvailable<T>(id: string, options: { timeoutMs?: number } = {}): Promise<T> {
    const existing = this.get<T>(id)
    if (existing !== undefined) {
      return Promise.resolve(existing)
    }

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const listener: ServiceRegistryListener = {
        onServiceEvent: event => {
          if (event.serviceId !== id || event.type === 'unregistered') return

          const service = this.get<T>(id)
          if (service === undefined) return

          if (timer !== undefined) clearTimeout(timer)
          this.removeListener(listener)
          resolve(service)
        }
      }

      this.addListener(listener)

      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.removeListener(listener)
          reject(new Error(`Service ${id} did not become available within ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      }
    })
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
