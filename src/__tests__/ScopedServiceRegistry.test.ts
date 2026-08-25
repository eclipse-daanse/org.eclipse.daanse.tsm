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

  describe('listeners', () => {
    it('should forward listeners to the shared registry', () => {
      const { shared, scope } = setup()
      const seen: string[] = []
      scope.addListener({ onServiceEvent: event => { seen.push(event.serviceId) } })

      shared.register('foreign.service', {})

      expect(seen).toEqual(['foreign.service'])
    })

    it('should remove its listeners on releaseAll', () => {
      const { shared, scope } = setup()
      const seen: string[] = []
      scope.addListener({ onServiceEvent: event => { seen.push(event.serviceId) } })

      scope.releaseAll()
      shared.register('foreign.service', {})

      expect(seen).toEqual([])
    })

    it('should support removing a listener explicitly', () => {
      const { shared, scope } = setup()
      const seen: string[] = []
      const listener = { onServiceEvent: (event: { serviceId: string }) => { seen.push(event.serviceId) } }

      scope.addListener(listener)
      scope.removeListener(listener)
      shared.register('foreign.service', {})

      expect(seen).toEqual([])
    })

    it('should say so when the target registry cannot be observed', () => {
      const plain = {
        register: () => {},
        bind: () => {},
        bindClass: () => {},
        get: () => undefined,
        getRequired: () => { throw new Error('nope') },
        getAll: () => [],
        has: () => false,
        checkRequirements: () => ({ satisfied: true, missing: [] }),
        unregister: () => false,
        getBindingInfo: () => undefined,
        getServiceIds: () => []
      }
      const scope = new ScopedServiceRegistry('map-module', plain)

      expect(() => scope.addListener({ onServiceEvent: () => {} })).toThrow(
        'does not support listeners'
      )
    })
  })

  describe('several providers', () => {
    it('should withdraw only its own registration', () => {
      const { shared, scope } = setup()
      shared.register('widget.chart', { from: 'other' }, { providedBy: 'other-module' })
      scope.register('widget.chart', { from: 'mine' })

      scope.releaseAll()

      expect(shared.countProviders('widget.chart')).toBe(1)
      expect(shared.get('widget.chart')).toEqual({ from: 'other' })
    })

    it('should withdraw only its own on unregister(id)', () => {
      const { shared, scope } = setup()
      shared.register('widget.chart', { from: 'other' }, { providedBy: 'other-module' })
      scope.register('widget.chart', { from: 'mine' })

      expect(scope.unregister('widget.chart')).toBe(true)

      expect(shared.countProviders('widget.chart')).toBe(1)
      expect(shared.get('widget.chart')).toEqual({ from: 'other' })
    })

    it('should still reach a foreign service it never registered', () => {
      const { shared, scope } = setup()
      shared.register('foreign.service', {}, { providedBy: 'other-module' })

      expect(scope.unregister('foreign.service')).toBe(true)
      expect(shared.has('foreign.service')).toBe(false)
    })

    it('should apply a ranking declared in the manifest', () => {
      const shared = new DefaultServiceRegistry()
      const scope = new ScopedServiceRegistry('map-module', shared, new Map([['geo.service', 7]]))

      const registration = scope.register('geo.service', {})

      expect(registration.ranking).toBe(7)
    })

    it('should let an explicit ranking win over the manifest', () => {
      const shared = new DefaultServiceRegistry()
      const scope = new ScopedServiceRegistry('map-module', shared, new Map([['geo.service', 7]]))

      const registration = scope.register('geo.service', {}, { ranking: 1 })

      expect(registration.ranking).toBe(1)
    })

    it('should pass collection calls through', () => {
      const { shared, scope } = setup()
      shared.register('widget.chart', { from: 'other' }, { providedBy: 'other-module' })
      scope.register('widget.chart', { from: 'mine' })

      expect(scope.countProviders('widget.chart')).toBe(2)
      expect(scope.getServiceReferences('widget.chart').map(r => r.providedBy).sort())
        .toEqual(['map-module', 'other-module'])
    })
  })

  describe('declared properties for an interface', () => {
    it('should apply what the manifest declares for each ID', () => {
      const shared = new DefaultServiceRegistry()
      const scope = new ScopedServiceRegistry('chart-module', shared, new Map(), new Map([
        ['chart.renderer', { engine: 'canvas' }],
        ['ui.component', { region: 'main', order: 3 }]
      ]))

      scope.bindClass('chart.renderer', Renderer, { implements: ['ui.component'] })

      expect(shared.getServiceReferences('chart.renderer')[0].properties)
        .toMatchObject({ engine: 'canvas' })
      // Without this, a manifest could not describe the interface at all
      expect(shared.getServiceReferences('ui.component')[0].properties)
        .toMatchObject({ region: 'main', order: 3 })
    })
  })

  describe('whenAvailable', () => {
    it('should delegate waiting to the shared registry', async () => {
      const { shared, scope } = setup()

      const waiting = scope.whenAvailable<{ id: string }>('late.service')
      shared.register('late.service', { id: 'late' })

      await expect(waiting).resolves.toEqual({ id: 'late' })
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

describe('reads that pass straight through', () => {
  it('reports the binding info of the shared registry', () => {
    const shared = new DefaultServiceRegistry()
    shared.bind('cache', () => ({}), { scope: 'module', providedBy: 'owner' })

    const scope = new ScopedServiceRegistry('consumer', shared)

    // Not the facade's own view: a scope does not change what a binding *is*
    expect(scope.getBindingInfo('cache')).toEqual({ scope: 'module', providedBy: 'owner' })
  })

  it('lists every service id, not only its own', () => {
    const shared = new DefaultServiceRegistry()
    shared.register('somebody.elses', {})

    const scope = new ScopedServiceRegistry('mine', shared)
    scope.register('mine', {})

    // Reads are shared, writes are owned — which is the whole shape of the facade
    expect(scope.getServiceIds().sort()).toEqual(['mine', 'somebody.elses'])
    expect(scope.getOwnServiceIds()).toEqual(['mine'])
  })

  it('refuses to wait on a registry that cannot', async () => {
    // A custom ServiceRegistry without the observable half: the module is told
    // rather than left hanging on a promise nothing will settle
    const minimal = {
      register: () => { throw new Error('unused') }
    } as unknown as ConstructorParameters<typeof ScopedServiceRegistry>[1]

    const scope = new ScopedServiceRegistry('mine', minimal)

    await expect(scope.whenAvailable('never')).rejects.toThrow('does not support waiting')
  })
})
