import { describe, it, expect, vi } from 'vitest'
import { DefaultServiceRegistry, type ServiceRegistryListener } from '../ServiceRegistry'

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