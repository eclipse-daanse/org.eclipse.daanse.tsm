import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { DefaultServiceRegistry, type ServiceRegistryListener } from '../ServiceRegistry'
import { injectable, inject } from '../decorators'

describe('DefaultServiceRegistry', () => {
  describe('register and get', () => {
    it('should register and retrieve a service', () => {
      const registry = new DefaultServiceRegistry()
      const service = { name: 'TestService' }

      registry.register('test.service', service)
      const retrieved = registry.get('test.service')

      expect(retrieved).toBe(service)
    })

    it('should return undefined for unknown service', () => {
      const registry = new DefaultServiceRegistry()

      const retrieved = registry.get('unknown.service')

      expect(retrieved).toBeUndefined()
    })

    it('should overwrite existing service', () => {
      const registry = new DefaultServiceRegistry()
      const service1 = { name: 'Service1' }
      const service2 = { name: 'Service2' }

      registry.register('test.service', service1)
      registry.register('test.service', service2)
      const retrieved = registry.get('test.service')

      expect(retrieved).toBe(service2)
    })

    it('should preserve type information', () => {
      const registry = new DefaultServiceRegistry()
      interface MyService {
        getValue(): number
      }
      const service: MyService = { getValue: () => 42 }

      registry.register<MyService>('my.service', service)
      const retrieved = registry.get<MyService>('my.service')

      expect(retrieved?.getValue()).toBe(42)
    })
  })

  describe('has', () => {
    it('should return true for existing service', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('test.service', {})

      expect(registry.has('test.service')).toBe(true)
    })

    it('should return false for non-existing service', () => {
      const registry = new DefaultServiceRegistry()

      expect(registry.has('test.service')).toBe(false)
    })
  })

  describe('unregister', () => {
    it('should remove a registered service', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('test.service', {})

      const result = registry.unregister('test.service')

      expect(result).toBe(true)
      expect(registry.has('test.service')).toBe(false)
    })

    it('should return false for non-existing service', () => {
      const registry = new DefaultServiceRegistry()

      const result = registry.unregister('test.service')

      expect(result).toBe(false)
    })
  })

  describe('getAll', () => {
    it('should return all services matching exact ID', () => {
      const registry = new DefaultServiceRegistry()
      const service = { name: 'Service' }
      registry.register('test.service', service)

      const results = registry.getAll('test.service')

      expect(results).toHaveLength(1)
      expect(results[0]).toBe(service)
    })

    it('should return services matching wildcard pattern', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('storage.adapter.indexeddb', { type: 'indexeddb' })
      registry.register('storage.adapter.git', { type: 'git' })
      registry.register('storage.adapter.memory', { type: 'memory' })
      registry.register('other.service', { type: 'other' })

      const results = registry.getAll('storage.adapter.*')

      expect(results).toHaveLength(3)
    })

    it('should return empty array for no matches', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('some.service', {})

      const results = registry.getAll('other.*')

      expect(results).toHaveLength(0)
    })

    it('should support complex patterns', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('a.b.c', { id: 1 })
      registry.register('a.x.c', { id: 2 })
      registry.register('a.b.d', { id: 3 })

      const results = registry.getAll('a.*.c')

      expect(results).toHaveLength(2)
    })
  })

  describe('getServiceIds', () => {
    it('should return all registered service IDs', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('service.a', {})
      registry.register('service.b', {})
      registry.register('service.c', {})

      const ids = registry.getServiceIds()

      expect(ids).toContain('service.a')
      expect(ids).toContain('service.b')
      expect(ids).toContain('service.c')
      expect(ids).toHaveLength(3)
    })

    it('should return empty array for empty registry', () => {
      const registry = new DefaultServiceRegistry()

      const ids = registry.getServiceIds()

      expect(ids).toHaveLength(0)
    })
  })

  describe('clear', () => {
    it('should remove all services', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('service.a', {})
      registry.register('service.b', {})

      registry.clear()

      expect(registry.getServiceIds()).toHaveLength(0)
    })
  })

  describe('listeners', () => {
    it('should notify on service registration', () => {
      const registry = new DefaultServiceRegistry()
      const listener: ServiceRegistryListener = {
        onServiceEvent: vi.fn()
      }
      registry.addListener(listener)
      const service = { name: 'Test' }

      registry.register('test.service', service)

      expect(listener.onServiceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'registered',
          serviceId: 'test.service',
          service
        })
      )
    })

    it('should notify with "updated" type on overwrite', () => {
      const registry = new DefaultServiceRegistry()
      const listener: ServiceRegistryListener = {
        onServiceEvent: vi.fn()
      }
      registry.register('test.service', { v: 1 })
      registry.addListener(listener)

      registry.register('test.service', { v: 2 })

      expect(listener.onServiceEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'updated' })
      )
    })

    it('should notify on unregister', () => {
      const registry = new DefaultServiceRegistry()
      const listener: ServiceRegistryListener = {
        onServiceEvent: vi.fn()
      }
      const service = { name: 'Test' }
      registry.register('test.service', service)
      registry.addListener(listener)

      registry.unregister('test.service')

      expect(listener.onServiceEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'unregistered',
          serviceId: 'test.service',
          service
        })
      )
    })

    it('should stop notifying after removeListener', () => {
      const registry = new DefaultServiceRegistry()
      const listener: ServiceRegistryListener = {
        onServiceEvent: vi.fn()
      }
      registry.addListener(listener)
      registry.removeListener(listener)

      registry.register('test.service', {})

      expect(listener.onServiceEvent).not.toHaveBeenCalled()
    })

    it('should handle listener errors gracefully', () => {
      const registry = new DefaultServiceRegistry()
      const badListener: ServiceRegistryListener = {
        onServiceEvent: vi.fn(() => {
          throw new Error('Listener error')
        })
      }
      const goodListener: ServiceRegistryListener = {
        onServiceEvent: vi.fn()
      }
      registry.addListener(badListener)
      registry.addListener(goodListener)

      // Should not throw
      expect(() => registry.register('test.service', {})).not.toThrow()
      // Good listener should still be called
      expect(goodListener.onServiceEvent).toHaveBeenCalled()
    })
  })
})
describe('DefaultServiceRegistry - registration ownership and alias cleanup', () => {
  @injectable()
  class GeoService {
    locate(): string { return 'here' }
  }

  describe('register with providedBy', () => {
    it('should record which module provided the service', () => {
      const registry = new DefaultServiceRegistry()

      registry.register('geo.service', { locate: () => 'here' }, { providedBy: 'geo-module' })

      expect(registry.getBindingInfo('geo.service')).toEqual({
        scope: 'singleton',
        providedBy: 'geo-module'
      })
    })

    it('should keep working without provider info', () => {
      const registry = new DefaultServiceRegistry()

      registry.register('geo.service', { locate: () => 'here' })

      expect(registry.get('geo.service')).toBeDefined()
      expect(registry.getBindingInfo('geo.service')?.providedBy).toBeUndefined()
    })
  })

  describe('unregister with aliases', () => {
    it('should remove aliases when the primary service is unregistered', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      expect(registry.has('geo.api')).toBe(true)
      expect(registry.get('geo.api')).toBeInstanceOf(GeoService)

      registry.unregister('geo.impl')

      expect(registry.has('geo.api')).toBe(false)
      expect(registry.get('geo.api')).toBeUndefined()
    })

    it('should report an unregistered alias as missing in checkRequirements', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      registry.unregister('geo.impl')

      expect(registry.checkRequirements([{ id: 'geo.api' }])).toEqual({
        satisfied: false,
        missing: ['geo.api']
      })
    })

    it('should notify listeners for each removed alias', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api', 'geo.legacy'] })

      const events: Array<{ type: string; serviceId: string }> = []
      const listener: ServiceRegistryListener = {
        onServiceEvent: event => { events.push({ type: event.type, serviceId: event.serviceId }) }
      }
      registry.addListener(listener)

      registry.unregister('geo.impl')

      expect(events).toEqual([
        { type: 'unregistered', serviceId: 'geo.impl' },
        { type: 'unregistered', serviceId: 'geo.api' },
        { type: 'unregistered', serviceId: 'geo.legacy' }
      ])
    })

    it('should keep the primary service when only an alias is unregistered', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      expect(registry.unregister('geo.api')).toBe(true)

      expect(registry.has('geo.api')).toBe(false)
      expect(registry.get('geo.impl')).toBeInstanceOf(GeoService)
    })

    it('should not resurrect a removed alias when the primary is unregistered later', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })
      registry.unregister('geo.api')

      expect(() => registry.unregister('geo.impl')).not.toThrow()
      expect(registry.has('geo.api')).toBe(false)
    })

    it('should drop stale aliases when the primary is rebound with different interfaces', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      registry.bindClass('geo.impl', GeoService, { implements: ['geo.v2'] })

      expect(registry.has('geo.api')).toBe(false)
      expect(registry.has('geo.v2')).toBe(true)
    })

    it('should keep an alias pointing at its own class when the ID gains another provider', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      // A second provider for the same ID, not a replacement: different source
      registry.register('geo.impl', { locate: () => 'elsewhere' })

      expect(registry.countProviders('geo.impl')).toBe(2)
      // The ID answers with the later registration...
      expect(registry.get<{ locate(): string }>('geo.impl')?.locate()).toBe('elsewhere')
      // ...while the alias still stands for the class that claimed the interface
      expect(registry.get('geo.api')).toBeInstanceOf(GeoService)
    })

    it('should drop the alias when its own class is unregistered', () => {
      const registry = new DefaultServiceRegistry()
      const handle = registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })
      registry.register('geo.impl', { locate: () => 'elsewhere' })

      handle.unregister()

      expect(registry.has('geo.api')).toBe(false)
      expect(registry.has('geo.impl')).toBe(true)
    })

    it('should move an alias when it is reassigned to another primary', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.a', GeoService, { implements: ['geo.api'] })
      registry.bindClass('geo.b', GeoService, { implements: ['geo.api'] })

      // Unregistering the old primary must not take the reassigned alias with it
      registry.unregister('geo.a')

      expect(registry.has('geo.api')).toBe(true)
      expect(registry.get('geo.api')).toBeInstanceOf(GeoService)
    })
  })

  describe('invalidating cached injections', () => {
    @injectable()
    class Backend {
      constructor(public readonly tag: string = 'first') {}
    }

    @injectable()
    class Middle {
      constructor(@inject('backend') public readonly backend: Backend) {}
    }

    @injectable()
    class Front {
      constructor(@inject('middle') public readonly middle: Middle) {}
    }

    it('should rebuild a singleton after its dependency was replaced', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('backend', new Backend('first'))
      registry.bindClass('middle', Middle)

      const before = registry.get<Middle>('middle')
      expect(before?.backend.tag).toBe('first')

      registry.register('backend', new Backend('second'))
      const after = registry.get<Middle>('middle')

      expect(after).not.toBe(before)
      expect(after?.backend.tag).toBe('second')
    })

    it('should invalidate transitively', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('backend', new Backend('first'))
      registry.bindClass('middle', Middle)
      registry.bindClass('front', Front)

      const before = registry.get<Front>('front')
      expect(before?.middle.backend.tag).toBe('first')

      registry.register('backend', new Backend('second'))
      const after = registry.get<Front>('front')

      expect(after).not.toBe(before)
      expect(after?.middle.backend.tag).toBe('second')
    })

    it('should leave the singleton unresolvable while the dependency is gone', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('backend', new Backend('first'))
      registry.bindClass('middle', Middle)
      registry.get<Middle>('middle')

      registry.unregister('backend')

      expect(() => registry.get<Middle>('middle')).toThrow("Dependency 'backend' not found")
    })

    it('should not touch a hand-written factory, whose dependencies are opaque', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('backend', new Backend('first'))
      // The registry cannot see what this factory reads
      registry.bind('manual', () => ({ tag: registry.get<Backend>('backend')?.tag }))

      const before = registry.get('manual')
      registry.register('backend', new Backend('second'))

      // Documented limitation: same instance, still carrying the old value
      expect(registry.get('manual')).toBe(before)
    })
  })

  describe('whenAvailable', () => {
    it('should resolve immediately for a service that is already there', async () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', { locate: () => 'here' })

      await expect(registry.whenAvailable('geo.service')).resolves.toEqual({
        locate: expect.any(Function)
      })
    })

    it('should resolve when the service arrives', async () => {
      const registry = new DefaultServiceRegistry()

      const waiting = registry.whenAvailable<{ id: string }>('geo.service')
      registry.register('geo.service', { id: 'late' })

      await expect(waiting).resolves.toEqual({ id: 'late' })
    })

    it('should resolve for a lazily bound service', async () => {
      const registry = new DefaultServiceRegistry()

      const waiting = registry.whenAvailable<{ id: string }>('geo.service')
      registry.bind('geo.service', () => ({ id: 'lazy' }))

      await expect(waiting).resolves.toEqual({ id: 'lazy' })
    })

    it('should reject after the timeout', async () => {
      const registry = new DefaultServiceRegistry()

      await expect(registry.whenAvailable('geo.service', { timeoutMs: 20 })).rejects.toThrow(
        'did not become available within 20ms'
      )
    })

    it('should not keep listening after resolving', async () => {
      const registry = new DefaultServiceRegistry()
      const waiting = registry.whenAvailable('geo.service')
      registry.register('geo.service', {})
      await waiting

      // A later event must not reach the settled promise; no unhandled rejection
      expect(() => registry.unregister('geo.service')).not.toThrow()
    })
  })

  describe('properties per interface', () => {
    @injectable()
    class Renderer {
      render(): string { return 'ok' }
    }

    it('should give an alias its own properties', () => {
      const registry = new DefaultServiceRegistry()

      registry.bindClass('chart.renderer', Renderer, {
        implements: ['ui.component'],
        properties: { engine: 'canvas' },
        propertiesById: { 'ui.component': { region: 'main', order: 3 } }
      })

      expect(registry.getServiceReferences('chart.renderer')[0].properties)
        .toMatchObject({ engine: 'canvas' })
      // The interface is what consumers filter on, so it carries its own
      expect(registry.getServiceReferences('ui.component')[0].properties)
        .toMatchObject({ region: 'main', order: 3 })
    })

    it('should fall back to the shared properties for an ID without its own', () => {
      const registry = new DefaultServiceRegistry()

      registry.bindClass('chart.renderer', Renderer, {
        implements: ['ui.component'],
        properties: { engine: 'canvas' }
      })

      expect(registry.getServiceReferences('ui.component')[0].properties)
        .toMatchObject({ engine: 'canvas' })
    })

    it('should let a filter select the alias by its own properties', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('chart.renderer', Renderer, {
        implements: ['ui.component'],
        propertiesById: { 'ui.component': { region: 'main' } }
      })

      expect(registry.countProviders('ui.component', '(region=main)')).toBe(1)
      expect(registry.countProviders('ui.component', '(region=sidebar)')).toBe(0)
    })
  })

  describe('clear', () => {
    it('should also remove services that were only bound lazily', () => {
      const registry = new DefaultServiceRegistry()
      registry.bind('layout.a', () => ({ name: 'a' }))
      registry.register('layout.b', { name: 'b' })

      registry.clear()

      expect(registry.has('layout.a')).toBe(false)
      expect(registry.has('layout.b')).toBe(false)
      expect(registry.getServiceIds()).toEqual([])
    })
  })
})

describe('DefaultServiceRegistry - ranking and several providers per ID', () => {
  describe('visible service', () => {
    it('should keep last-wins for equal ranking', () => {
      const registry = new DefaultServiceRegistry()

      registry.register('geo.service', { tag: 'first' }, { providedBy: 'a' })
      registry.register('geo.service', { tag: 'second' }, { providedBy: 'b' })

      expect(registry.get('geo.service')).toEqual({ tag: 'second' })
    })

    it('should let the higher ranking win regardless of order', () => {
      const registry = new DefaultServiceRegistry()

      registry.register('geo.service', { tag: 'strong' }, { providedBy: 'a', ranking: 10 })
      registry.register('geo.service', { tag: 'weak' }, { providedBy: 'b' })

      expect(registry.get('geo.service')).toEqual({ tag: 'strong' })
    })

    it('should replace a provider own earlier registration instead of stacking', () => {
      const registry = new DefaultServiceRegistry()

      registry.register('geo.service', { tag: 'old' }, { providedBy: 'a' })
      registry.register('geo.service', { tag: 'new' }, { providedBy: 'a' })

      expect(registry.countProviders('geo.service')).toBe(1)
      expect(registry.get('geo.service')).toEqual({ tag: 'new' })
    })

    it('should report the visible registration in getBindingInfo', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'weak' })
      registry.register('geo.service', {}, { providedBy: 'strong', ranking: 5 })

      expect(registry.getBindingInfo('geo.service')?.providedBy).toBe('strong')
    })
  })

  describe('stand-in when the visible provider goes', () => {
    it('should promote the next provider instead of falling silent', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', { tag: 'default' }, { providedBy: 'a' })
      const override = registry.register(
        'geo.service',
        { tag: 'override' },
        { providedBy: 'b', ranking: 10 }
      )
      expect(registry.get('geo.service')).toEqual({ tag: 'override' })

      override.unregister()

      expect(registry.has('geo.service')).toBe(true)
      expect(registry.get('geo.service')).toEqual({ tag: 'default' })
    })

    it('should report promotion as an update, not a withdrawal', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', { tag: 'default' }, { providedBy: 'a' })
      const override = registry.register('geo.service', { tag: 'override' }, { providedBy: 'b', ranking: 10 })

      const events: Array<{ type: string; serviceId: string }> = []
      registry.addListener({
        onServiceEvent: event => { events.push({ type: event.type, serviceId: event.serviceId }) }
      })

      override.unregister()

      expect(events).toEqual([{ type: 'updated', serviceId: 'geo.service' }])
    })

    it('should announce a withdrawal only when the last provider goes', () => {
      const registry = new DefaultServiceRegistry()
      const first = registry.register('geo.service', {}, { providedBy: 'a' })
      const second = registry.register('geo.service', {}, { providedBy: 'b' })

      const events: string[] = []
      registry.addListener({ onServiceEvent: event => { events.push(event.type) } })

      second.unregister()
      first.unregister()

      expect(events).toEqual(['updated', 'unregistered'])
      expect(registry.has('geo.service')).toBe(false)
    })

    it('should report a registration going that was never visible', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'strong', ranking: 10 })
      const weak = registry.register('geo.service', {}, { providedBy: 'weak' })

      const events: string[] = []
      registry.addListener({ onServiceEvent: event => { events.push(event.type) } })

      expect(weak.unregister()).toBe(true)

      // `get(id)` answers with the same object as before, so this used to be
      // treated as no change at all. But `countProviders` went from 2 to 1, and
      // a collection reference consumes every provider — staying silent leaves
      // cardinality 0..n stale. OSGi raises UNREGISTERING per registration for
      // exactly this reason.
      expect(events).toEqual(['unregistered'])
      expect(registry.countProviders('geo.service')).toBe(1)
    })

    it('should report a registration arriving that is outranked', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'strong', ranking: 10 })

      const events: string[] = []
      registry.addListener({ onServiceEvent: event => { events.push(event.type) } })

      registry.register('geo.service', {}, { providedBy: 'weak' })

      // The counterpart: a provider nobody sees through `get()` is still a
      // provider, and a collection has to hear about it
      expect(events).toEqual(['registered'])
    })

    it('should refuse to withdraw the same registration twice', () => {
      const registry = new DefaultServiceRegistry()
      const handle = registry.register('geo.service', {}, { providedBy: 'a' })

      expect(handle.unregister()).toBe(true)
      expect(handle.unregister()).toBe(false)
    })

    it('should remove every provider of an ID via unregister(id)', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'a' })
      registry.register('geo.service', {}, { providedBy: 'b' })

      expect(registry.unregister('geo.service')).toBe(true)

      expect(registry.has('geo.service')).toBe(false)
      expect(registry.countProviders('geo.service')).toBe(0)
    })
  })

  describe('collecting providers', () => {
    it('should list every provider, best first, without instantiating', () => {
      const registry = new DefaultServiceRegistry()
      const built: string[] = []
      registry.bind('widget', () => { built.push('weak'); return { tag: 'weak' } }, { providedBy: 'a' })
      registry.bind('widget', () => { built.push('strong'); return { tag: 'strong' } }, { providedBy: 'b', ranking: 10 })

      const references = registry.getServiceReferences('widget')

      expect(references.map(reference => reference.providedBy)).toEqual(['b', 'a'])
      expect(references.map(reference => reference.ranking)).toEqual([10, 0])
      expect(built).toEqual([])
      expect(references.every(reference => !reference.instantiated)).toBe(true)
    })

    it('should resolve each reference individually, including outranked ones', () => {
      const registry = new DefaultServiceRegistry()
      registry.bind('widget', () => ({ tag: 'weak' }), { providedBy: 'a' })
      registry.bind('widget', () => ({ tag: 'strong' }), { providedBy: 'b', ranking: 10 })

      const resolved = registry
        .getServiceReferences('widget')
        .map(reference => registry.resolveReference<{ tag: string }>(reference)?.tag)

      expect(resolved).toEqual(['strong', 'weak'])
    })

    it('should reuse the singleton instance of an outranked provider', () => {
      const registry = new DefaultServiceRegistry()
      registry.bind('widget', () => ({ tag: 'weak' }), { providedBy: 'a' })
      registry.register('widget', { tag: 'strong' }, { providedBy: 'b', ranking: 10 })

      const outranked = registry.getServiceReferences('widget')
        .find(reference => reference.providedBy === 'a')!
      const first = registry.resolveReference('widget' === outranked.serviceId ? outranked : outranked)
      const second = registry.resolveReference(outranked)

      expect(second).toBe(first)
    })

    it('should return undefined for a reference that is gone', () => {
      const registry = new DefaultServiceRegistry()
      const handle = registry.register('widget', { tag: 'only' }, { providedBy: 'a' })
      const [reference] = registry.getServiceReferences('widget')

      handle.unregister()

      expect(registry.resolveReference(reference)).toBeUndefined()
    })

    it('should report an empty list for an unknown ID', () => {
      const registry = new DefaultServiceRegistry()

      expect(registry.getServiceReferences('nothing')).toEqual([])
      expect(registry.countProviders('nothing')).toBe(0)
    })
  })

  describe('cardinality in checkRequirements', () => {
    it('should treat 1..1 and 1..n as needing a provider', () => {
      const registry = new DefaultServiceRegistry()

      expect(registry.checkRequirements([{ id: 'a', cardinality: '1..1' }]).missing).toEqual(['a'])
      expect(registry.checkRequirements([{ id: 'a', cardinality: '1..n' }]).missing).toEqual(['a'])
    })

    it('should treat 0..1 and 0..n as non-blocking', () => {
      const registry = new DefaultServiceRegistry()

      expect(registry.checkRequirements([{ id: 'a', cardinality: '0..1' }]).satisfied).toBe(true)
      expect(registry.checkRequirements([{ id: 'a', cardinality: '0..n' }]).satisfied).toBe(true)
    })

    it('should be satisfied by a single provider for 1..n', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('a', {})

      expect(registry.checkRequirements([{ id: 'a', cardinality: '1..n' }]).satisfied).toBe(true)
    })

    it('should keep honouring optional as 0..1', () => {
      const registry = new DefaultServiceRegistry()

      expect(registry.checkRequirements([{ id: 'a', optional: true }]).satisfied).toBe(true)
    })
  })

  describe('aliases with several implementations', () => {
    @injectable()
    class Grid { readonly kind = 'grid' }

    @injectable()
    class Flow { readonly kind = 'flow' }

    it('should rank two implementations of one interface instead of overwriting', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('layout.grid', Grid, { implements: ['layout'], providedBy: 'a' })
      registry.bindClass('layout.flow', Flow, { implements: ['layout'], providedBy: 'b', ranking: 5 })

      expect(registry.countProviders('layout')).toBe(2)
      expect(registry.get<Flow>('layout')?.kind).toBe('flow')
    })

    it('should fall back to the other implementation when the ranked one goes', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('layout.grid', Grid, { implements: ['layout'], providedBy: 'a' })
      const flow = registry.bindClass('layout.flow', Flow, { implements: ['layout'], providedBy: 'b', ranking: 5 })

      flow.unregister()

      expect(registry.get<Grid>('layout')?.kind).toBe('grid')
    })
  })
})

describe('DefaultServiceRegistry - target filters', () => {
  function withWidgets() {
    const registry = new DefaultServiceRegistry()
    registry.register('widget', { name: 'chart' }, {
      providedBy: 'charts', properties: { kind: 'chart', experimental: false }
    })
    registry.register('widget', { name: 'table' }, {
      providedBy: 'tables', ranking: 5, properties: { kind: 'table', experimental: false }
    })
    registry.register('widget', { name: 'sketch' }, {
      providedBy: 'labs', properties: { kind: 'chart', experimental: true }
    })
    return registry
  }

  it('should narrow references to matching registrations', () => {
    const registry = withWidgets()

    const kinds = registry
      .getServiceReferences('widget', '(kind=chart)')
      .map(reference => reference.providedBy)

    expect(kinds).toEqual(['labs', 'charts'])
  })

  it('should count only matching registrations', () => {
    const registry = withWidgets()

    expect(registry.countProviders('widget')).toBe(3)
    expect(registry.countProviders('widget', '(kind=chart)')).toBe(2)
    expect(registry.countProviders('widget', '(!(experimental=true))')).toBe(2)
    expect(registry.countProviders('widget', '(kind=map)')).toBe(0)
  })

  it('should resolve the best matching service with getMatching', () => {
    const registry = withWidgets()

    // get() answers with the highest ranked one regardless of properties
    expect(registry.get('widget')).toEqual({ name: 'table' })
    expect(registry.getMatching('widget', '(kind=chart)')).toEqual({ name: 'sketch' })
    expect(registry.getMatching('widget', '(&(kind=chart)(!(experimental=true)))'))
      .toEqual({ name: 'chart' })
    expect(registry.getMatching('widget', '(kind=map)')).toBeUndefined()
  })

  it('should expose ranking and provider as filterable properties', () => {
    const registry = withWidgets()

    expect(registry.countProviders('widget', '(service.ranking>=5)')).toBe(1)
    expect(registry.getMatching<{ name: string }>('widget', '(service.providedBy=labs)')?.name)
      .toBe('sketch')
  })

  it('should report the properties on the reference', () => {
    const registry = withWidgets()

    const [best] = registry.getServiceReferences('widget', '(kind=table)')

    expect(best.properties).toEqual({
      kind: 'table',
      experimental: false,
      'service.ranking': 5,
      'service.providedBy': 'tables'
    })
  })

  it('should treat a requirement with a target as unsatisfied without a match', () => {
    const registry = withWidgets()

    expect(registry.checkRequirements([{ id: 'widget', target: '(kind=map)' }])).toEqual({
      satisfied: false,
      missing: ['widget']
    })
    expect(registry.checkRequirements([{ id: 'widget', target: '(kind=table)' }]).satisfied)
      .toBe(true)
  })

  it('should reject an invalid filter instead of matching nothing', () => {
    const registry = withWidgets()

    expect(() => registry.countProviders('widget', '(kind=chart')).toThrow('Invalid service filter')
  })

  it('should filter lazily bound providers without instantiating them', () => {
    const registry = new DefaultServiceRegistry()
    const built: string[] = []
    registry.bind('widget', () => { built.push('a'); return { name: 'a' } }, {
      providedBy: 'a', properties: { kind: 'chart' }
    })
    registry.bind('widget', () => { built.push('b'); return { name: 'b' } }, {
      providedBy: 'b', properties: { kind: 'table' }
    })

    expect(registry.countProviders('widget', '(kind=chart)')).toBe(1)
    expect(built).toEqual([])
  })
})

describe('DefaultServiceRegistry - changing a live registration', () => {
  @injectable()
  class RasterTiles {
    readonly kind = 'raster'
  }

  describe('setProperties', () => {
    it('should change what a target filter selects, keeping the service object', () => {
      const registry = new DefaultServiceRegistry()
      const service = { name: 'tiles' }
      const registration = registry.register('demo.tiles', service, {
        properties: { kind: 'raster' }
      })

      registration.setProperties({ kind: 'vector' })

      expect(registry.getServiceReferences('demo.tiles', '(kind=vector)')).toHaveLength(1)
      expect(registry.getServiceReferences('demo.tiles', '(kind=raster)')).toHaveLength(0)
      expect(registry.get('demo.tiles')).toBe(service)
    })

    it('should report the change as an update, not as a new service', () => {
      const registry = new DefaultServiceRegistry()
      const events: string[] = []
      const registration = registry.register('demo.tiles', { name: 'tiles' })
      registry.addListener({ onServiceEvent: event => events.push(event.type) })

      registration.setProperties({ kind: 'vector' })

      expect(events).toEqual(['updated'])
    })

    it('should replace the properties rather than merge into them', () => {
      const registry = new DefaultServiceRegistry()
      const registration = registry.register('demo.tiles', { name: 'tiles' }, {
        properties: { kind: 'raster', experimental: true }
      })

      registration.setProperties({ kind: 'vector' })

      const [reference] = registry.getServiceReferences('demo.tiles')
      expect(reference.properties.kind).toBe('vector')
      // A property the new configuration no longer carries has to disappear,
      // otherwise a filter would keep selecting on a value nobody set
      expect(reference.properties.experimental).toBeUndefined()
    })

    it('should give an individual ID its own properties', () => {
      const registry = new DefaultServiceRegistry()
      const registration = registry.bindClass('demo.raster', RasterTiles, {
        implements: ['demo.tiles']
      })

      registration.setProperties({ kind: 'vector' }, {
        propertiesById: { 'demo.tiles': { kind: 'vector', interface: 'tiles' } }
      })

      expect(registry.getServiceReferences('demo.tiles')[0].properties.interface)
        .toBe('tiles')
      expect(registry.getServiceReferences('demo.raster')[0].properties.interface)
        .toBeUndefined()
    })

    it('should expose the same identity as the reference, so a registrant finds its own', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('demo.tiles', { name: 'other' }, { providedBy: 'a', ranking: 5 })
      const registration = registry.register('demo.tiles', { name: 'mine' }, { providedBy: 'b' })

      const own = registry.getServiceReferences('demo.tiles')
        .find(reference => reference.key === registration.key)

      expect(own?.properties['service.providedBy']).toBe('b')
    })

    it('should update the alias registrations of the same class', () => {
      const registry = new DefaultServiceRegistry()
      const registration = registry.bindClass('demo.raster', RasterTiles, {
        implements: ['demo.tiles'],
        properties: { kind: 'raster' }
      })

      registration.setProperties({ kind: 'vector' })

      expect(registry.getServiceReferences('demo.tiles', '(kind=vector)')).toHaveLength(1)
    })

    it('should answer false for a registration that is already gone', () => {
      const registry = new DefaultServiceRegistry()
      const registration = registry.register('demo.tiles', { name: 'tiles' })
      registration.unregister()

      expect(registration.setProperties({ kind: 'vector' })).toBe(false)
    })

    it('should hand the visible spot to a registration whose ranking grew', () => {
      const registry = new DefaultServiceRegistry()
      registry.register('demo.tiles', { name: 'first' }, { providedBy: 'a', ranking: 10 })
      const second = registry.register('demo.tiles', { name: 'second' }, { providedBy: 'b' })
      expect(registry.get<{ name: string }>('demo.tiles')?.name).toBe('first')

      second.setProperties({}, { ranking: 20 })

      expect(registry.get<{ name: string }>('demo.tiles')?.name).toBe('second')
      expect(registry.getServiceReferences('demo.tiles').map(reference => reference.ranking))
        .toEqual([20, 10])
    })

    it('should take the visible spot away from a registration whose ranking fell', () => {
      const registry = new DefaultServiceRegistry()
      const first = registry.register('demo.tiles', { name: 'first' }, {
        providedBy: 'a',
        ranking: 10
      })
      registry.register('demo.tiles', { name: 'second' }, { providedBy: 'b' })

      first.setProperties({}, { ranking: -5 })

      expect(registry.get<{ name: string }>('demo.tiles')?.name).toBe('second')
    })
  })

  describe('instanceKey', () => {
    it('should let one class register several times under one ID', () => {
      const registry = new DefaultServiceRegistry()

      registry.bindClass('demo.tiles', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'demo.tile-source~osm',
        properties: { name: 'osm' }
      })
      registry.bindClass('demo.tiles', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'demo.tile-source~sat',
        properties: { name: 'sat' }
      })

      expect(registry.getServiceReferences('demo.tiles')).toHaveLength(2)
      expect(registry.getServiceReferences('demo.tiles', '(name=sat)')).toHaveLength(1)
    })

    it('should still replace a repeated registration that names no instance', () => {
      const registry = new DefaultServiceRegistry()

      registry.bindClass('demo.tiles', RasterTiles, { providedBy: 'tiles' })
      registry.bindClass('demo.tiles', RasterTiles, { providedBy: 'tiles' })

      expect(registry.getServiceReferences('demo.tiles')).toHaveLength(1)
    })

    it('should give each instance its own alias registration', () => {
      const registry = new DefaultServiceRegistry()
      const osm = registry.bindClass('demo.raster', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'osm',
        implements: ['demo.tiles'],
        properties: { name: 'osm' }
      })
      registry.bindClass('demo.raster', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'sat',
        implements: ['demo.tiles'],
        properties: { name: 'sat' }
      })
      expect(registry.getServiceReferences('demo.tiles')).toHaveLength(2)

      osm.unregister()

      // The other instance keeps answering to the interface
      expect(registry.getServiceReferences('demo.tiles', '(name=sat)')).toHaveLength(1)
      expect(registry.getServiceReferences('demo.tiles', '(name=osm)')).toHaveLength(0)
      expect(registry.has('demo.tiles')).toBe(true)
    })

    it('should resolve each instance to its own object', () => {
      const registry = new DefaultServiceRegistry()
      const osm = registry.bindClass('demo.tiles', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'osm'
      })
      const sat = registry.bindClass('demo.tiles', RasterTiles, {
        providedBy: 'tiles',
        instanceKey: 'sat'
      })

      expect(osm.resolve()).not.toBe(sat.resolve())
    })
  })
})
