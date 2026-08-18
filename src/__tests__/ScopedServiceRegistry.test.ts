import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { ScopedServiceRegistry } from '../ScopedServiceRegistry'
import { injectable } from '../decorators'

@injectable()
class Renderer {
  render(): string { return 'ok' }
}

describe('ScopedServiceRegistry', () => {
  function setup() {
    const shared = new DefaultServiceRegistry()
    const scope = new ScopedServiceRegistry('map-module', shared)
    return { shared, scope }
  }

  describe('attribution', () => {
    it('should attribute registrations to the module', () => {
      const { shared, scope } = setup()

      scope.register('geo.service', { locate: () => 'here' })

      expect(shared.getBindingInfo('geo.service')?.providedBy).toBe('map-module')
    })

    it('should attribute lazily bound services as well', () => {
      const { shared, scope } = setup()

      scope.bind('layout.service', () => ({ name: 'grid' }))

      expect(shared.getBindingInfo('layout.service')?.providedBy).toBe('map-module')
    })

    it('should attribute injectable classes as well', () => {
      const { shared, scope } = setup()

      scope.bindClass('renderer', Renderer)

      expect(shared.getBindingInfo('renderer')?.providedBy).toBe('map-module')
    })

    it('should let an explicit provider win', () => {
      const { shared, scope } = setup()

      scope.register('geo.service', {}, { providedBy: 'somebody-else' })

      expect(shared.getBindingInfo('geo.service')?.providedBy).toBe('somebody-else')
    })
  })

  describe('reads', () => {
    it('should see services registered by others', () => {
      const { shared, scope } = setup()
      shared.register('foreign.service', { id: 'foreign' })

      expect(scope.has('foreign.service')).toBe(true)
      expect(scope.get('foreign.service')).toEqual({ id: 'foreign' })
      expect(scope.getRequired('foreign.service')).toEqual({ id: 'foreign' })
      expect(scope.getServiceIds()).toContain('foreign.service')
      expect(scope.checkRequirements([{ id: 'foreign.service' }])).toEqual({
        satisfied: true,
        missing: []
      })
    })

    it('should report only its own registrations as owned', () => {
      const { shared, scope } = setup()
      shared.register('foreign.service', {})
      scope.register('own.service', {})

      expect(scope.getOwnServiceIds()).toEqual(['own.service'])
    })
  })

  describe('releaseAll', () => {
    it('should withdraw everything the module registered', () => {
      const { shared, scope } = setup()
      scope.register('geo.service', {})
      scope.bind('layout.service', () => ({}))

      const released = scope.releaseAll()

      expect(released).toEqual(['layout.service', 'geo.service'])
      expect(shared.has('geo.service')).toBe(false)
      expect(shared.has('layout.service')).toBe(false)
      expect(scope.getOwnServiceIds()).toEqual([])
    })

    it('should leave services of other modules alone', () => {
      const { shared, scope } = setup()
      shared.register('foreign.service', {})
      scope.register('own.service', {})

      scope.releaseAll()

      expect(shared.has('foreign.service')).toBe(true)
      expect(shared.has('own.service')).toBe(false)
    })

    it('should skip what the module already withdrew itself', () => {
      const { shared, scope } = setup()
      scope.register('geo.service', {})
      scope.unregister('geo.service')

      expect(scope.releaseAll()).toEqual([])
      expect(shared.has('geo.service')).toBe(false)
    })

    it('should take alias bindings with it', () => {
      const { shared, scope } = setup()
      scope.bindClass('renderer', Renderer, { implements: ['renderer.api'] })

      scope.releaseAll()

      expect(shared.has('renderer')).toBe(false)
      expect(shared.has('renderer.api')).toBe(false)
    })
  })
})
