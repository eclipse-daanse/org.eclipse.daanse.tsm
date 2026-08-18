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

      expect(listener.onServiceEvent).toHaveBeenCalledWith({
        type: 'registered',
        serviceId: 'test.service',
        service
      })
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

      expect(listener.onServiceEvent).toHaveBeenCalledWith({
        type: 'unregistered',
        serviceId: 'test.service',
        service
      })
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

    it('should drop aliases when the primary is replaced by a plain registration', () => {
      const registry = new DefaultServiceRegistry()
      registry.bindClass('geo.impl', GeoService, { implements: ['geo.api'] })

      registry.register('geo.impl', { locate: () => 'elsewhere' })

      expect(registry.has('geo.api')).toBe(false)
      expect(registry.get('geo.impl')).toEqual({ locate: expect.any(Function) })
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
