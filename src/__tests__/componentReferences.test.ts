import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { activate, bind, component, deactivate, inject, unbind } from '../decorators'
import type { ModuleManifest } from '../types'

/**
 * A component's own references (DS 112.3), and the level they settle on.
 *
 * The distinction this brings: a missing service used to throw and take the whole
 * module's start with it. Now the component waits and the module keeps running —
 * which is what DS means by a component being unsatisfied (112.5.2), and the one
 * thing tsm settled at module level where DS settles it per component.
 */
function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { id, name: id, version: '1.0.0', entry: `x:${id}`, exports: {}, ...extra }
}

describe('a component waiting for a service', () => {
  let services: DefaultServiceRegistry
  let loader: ModuleLoader

  beforeEach(() => {
    services = new DefaultServiceRegistry()
    loader = new ModuleLoader({ serviceRegistry: services })
  })

  it('should not take the module down with it', async () => {
    const started = vi.fn()

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void { started() }
    }

    const loaded = await loader.loadModule(manifest('map'), { container: { Map2D } })

    // This used to throw 'Dependency demo.tiles not found' and fail the load
    expect(loaded.state).toBe('active')
    expect(started).not.toHaveBeenCalled()
    expect(services.has('demo.map')).toBe(false)
  })

  it('should say which service it waits for', async () => {
    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void {}
    }

    await loader.loadModule(manifest('map'), { container: { Map2D } })

    expect(loader.getComponents('map')[0].configurations).toEqual([
      { state: 'unsatisfied-reference', waitingFor: ['demo.tiles'], properties: {} }
    ])
  })

  it('should start once the service arrives', async () => {
    const started = vi.fn()

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void { started() }
    }

    await loader.loadModule(manifest('map'), { container: { Map2D } })

    services.register('demo.tiles', { name: 'tiles' })
    await loader.settle()

    expect(started).toHaveBeenCalled()
    expect(services.has('demo.map')).toBe(true)
    expect(loader.getComponents('map')[0].configurations[0].state).toBe('active')
  })

  it('should stop when the service goes away, and leave the module alone', async () => {
    const events: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void { events.push('start') }
      @deactivate() stop(): void { events.push('stop') }
    }

    const registration = services.register('demo.tiles', { name: 'tiles' })
    await loader.loadModule(manifest('map'), { container: { Map2D } })
    expect(events).toEqual(['start'])

    registration.unregister()
    await loader.settle()

    expect(events).toEqual(['start', 'stop'])
    expect(services.has('demo.map')).toBe(false)
    // The module was never parked — only its component
    expect(loader.getModule('map')?.state).toBe('active')
    expect(loader.getUnsatisfiedModules()).toEqual([])
  })

  it('should come back when the service returns', async () => {
    const events: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void { events.push('start') }
      @deactivate() stop(): void { events.push('stop') }
    }

    const first = services.register('demo.tiles', { name: 'tiles' })
    await loader.loadModule(manifest('map'), { container: { Map2D } })

    first.unregister()
    await loader.settle()
    services.register('demo.tiles', { name: 'again' })
    await loader.settle()

    expect(events).toEqual(['start', 'stop', 'start'])
  })

  it('should not wait for an optional reference', async () => {
    const started = vi.fn()

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.traffic', { optional: true }) private traffic: unknown) {}
      @activate() start(): void { started() }
    }

    await loader.loadModule(manifest('map'), { container: { Map2D } })

    expect(started).toHaveBeenCalled()
    expect(services.has('demo.map')).toBe(true)
  })

  it('should hold back only the component that is missing something', async () => {
    @component({ service: ['demo.tiles'] })
    class RasterTiles {
      @activate() start(): void {}
    }

    @component({ service: ['demo.export'] })
    class Exporter {
      constructor(@inject('demo.pdf') private pdf: unknown) {}
      @activate() start(): void {}
    }

    await loader.loadModule(manifest('mixed'), { container: { RasterTiles, Exporter } })

    expect(services.has('demo.tiles')).toBe(true)
    expect(services.has('demo.export')).toBe(false)
    const states = loader.getComponents('mixed').map(entry => entry.configurations[0].state)
    expect(states).toEqual(['active', 'unsatisfied-reference'])
  })

  it('should register components of one module in dependency order', async () => {
    const order: string[] = []

    // Declared first, but needs what the second one offers — the order inside a
    // module says nothing, so the loader settles it in rounds
    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void { order.push('map') }
    }

    @component({ service: ['demo.tiles'] })
    class RasterTiles {
      @activate() start(): void { order.push('tiles') }
    }

    await loader.loadModule(manifest('both'), { container: { Map2D, RasterTiles } })

    expect(order).toEqual(['tiles', 'map'])
    expect(services.has('demo.map')).toBe(true)
  })

  it('should cascade to a component depending on the one that stopped', async () => {
    @component({ service: ['demo.tiles'] })
    class RasterTiles {
      constructor(@inject('demo.source') private source: unknown) {}
      @activate() start(): void {}
    }

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void {}
    }

    const source = services.register('demo.source', {})
    await loader.loadModule(manifest('chain'), { container: { RasterTiles, Map2D } })
    expect(services.has('demo.map')).toBe(true)

    source.unregister()
    await loader.settle()

    // Tiles lost its source, the map lost tiles — two steps, one withdrawal
    expect(services.has('demo.tiles')).toBe(false)
    expect(services.has('demo.map')).toBe(false)
    expect(loader.getComponents('chain').map(e => e.configurations[0].state))
      .toEqual(['unsatisfied-reference', 'unsatisfied-reference'])
  })

  it('should list what a component injects', async () => {
    @component()
    class Widget {
      constructor(
        @inject('demo.a') private a: unknown,
        @inject('demo.b', { optional: true }) private b: unknown
      ) {}
    }

    services.register('demo.a', {})
    await loader.loadModule(manifest('w'), { container: { Widget } })

    expect(loader.getComponents('w')[0].references).toEqual([
      { serviceId: 'demo.a', optional: false },
      { serviceId: 'demo.b', optional: true }
    ])
  })

  it('should wait for a property injection too', async () => {
    @component({ service: ['demo.map'] })
    class Map2D {
      @inject('demo.tiles') private tiles!: unknown
      @activate() start(): void {}
    }

    await loader.loadModule(manifest('map'), { container: { Map2D } })

    expect(loader.getComponents('map')[0].configurations[0].state)
      .toBe('unsatisfied-reference')
  })
})

describe('a dynamic reference with @bind', () => {
  let services: DefaultServiceRegistry
  let loader: ModuleLoader

  beforeEach(() => {
    services = new DefaultServiceRegistry()
    loader = new ModuleLoader({ serviceRegistry: services })
  })

  it('should hand the service over before activate runs', async () => {
    const order: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.tiles') setTiles(): void { order.push('bind') }
      @activate() start(): void { order.push('activate') }
    }

    services.register('demo.tiles', { name: 'tiles' })
    await loader.loadModule(manifest('map'), { container: { Map2D } })

    // DS orders it this way (112.5.10 before 112.5.11): activate should see what
    // the component was given
    expect(order).toEqual(['bind', 'activate'])
  })

  it('should pass the service itself', async () => {
    let received: unknown

    @component()
    class Watcher {
      @bind('demo.tiles') setTiles(tiles: unknown): void { received = tiles }
    }

    const tiles = { name: 'raster' }
    services.register('demo.tiles', tiles)
    await loader.loadModule(manifest('w'), { container: { Watcher } })

    expect(received).toBe(tiles)
  })

  it('should keep the instance when the service is replaced', async () => {
    const events: string[] = []

    @component()
    class Watcher {
      @bind('demo.tiles', { optional: true }) setTiles(): void { events.push('bind') }
      @unbind('demo.tiles') unsetTiles(): void { events.push('unbind') }
      @activate() start(): void { events.push('activate') }
      @deactivate() stop(): void { events.push('deactivate') }
    }

    const first = services.register('demo.tiles', { name: 'one' })
    await loader.loadModule(manifest('w'), { container: { Watcher } })

    first.unregister()
    await loader.settle()
    services.register('demo.tiles', { name: 'two' })
    await loader.settle()

    // The whole point: a method call instead of a rebuild — no deactivate anywhere
    expect(events).toEqual(['bind', 'activate', 'unbind', 'bind'])
  })

  it('should count as a reference the component needs to start', async () => {
    const bound = vi.fn()

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.tiles') setTiles(): void { bound() }
    }

    await loader.loadModule(manifest('map'), { container: { Map2D } })

    expect(bound).not.toHaveBeenCalled()
    expect(loader.getComponents('map')[0].configurations[0])
      .toMatchObject({ state: 'unsatisfied-reference', waitingFor: ['demo.tiles'] })
  })

  it('should stop a mandatory reference that goes, after telling it', async () => {
    const events: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.tiles') setTiles(): void { events.push('bind') }
      @unbind('demo.tiles') unsetTiles(): void { events.push('unbind') }
      @deactivate() stop(): void { events.push('deactivate') }
    }

    const registration = services.register('demo.tiles', {})
    await loader.loadModule(manifest('map'), { container: { Map2D } })

    registration.unregister()
    await loader.settle()

    // DS 112.5.18: mandatory and no replacement means the component goes — but it
    // is told first
    expect(events).toEqual(['bind', 'unbind', 'deactivate'])
    expect(services.has('demo.map')).toBe(false)
  })

  it('should keep an optional reference alive when it goes', async () => {
    const events: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.traffic', { optional: true }) setTraffic(): void { events.push('bind') }
      @unbind('demo.traffic') unsetTraffic(): void { events.push('unbind') }
      @activate() start(): void { events.push('activate') }
      @deactivate() stop(): void { events.push('deactivate') }
    }

    const registration = services.register('demo.traffic', {})
    await loader.loadModule(manifest('map'), { container: { Map2D } })

    registration.unregister()
    await loader.settle()

    expect(events).toEqual(['bind', 'activate', 'unbind'])
    expect(services.has('demo.map')).toBe(true)
  })

  it('should bind an optional reference that only arrives later', async () => {
    const events: string[] = []

    @component()
    class Watcher {
      @bind('demo.traffic', { optional: true }) setTraffic(): void { events.push('bind') }
      @activate() start(): void { events.push('activate') }
    }

    await loader.loadModule(manifest('w'), { container: { Watcher } })
    expect(events).toEqual(['activate'])

    services.register('demo.traffic', {})
    await loader.settle()

    expect(events).toEqual(['activate', 'bind'])
  })

  it('should only report a loss an optional reference cannot hear about', async () => {
    const events: string[] = []
    const warnings: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.traffic', { optional: true }) setTraffic(): void { events.push('bind') }
      @deactivate() stop(): void { events.push('deactivate') }
    }

    const quiet = new ModuleLoader({
      serviceRegistry: services,
      logger: {
        debug: () => {}, info: () => {}, error: () => {},
        warn: message => warnings.push(message)
      }
    })
    const registration = services.register('demo.traffic', {})
    await quiet.loadModule(manifest('map'), { container: { Map2D } })

    registration.unregister()
    await quiet.settle()

    // Stopping it would turn an optional reference into a mandatory one, so the
    // component stays — holding something stale, and told about it
    expect(events).toEqual(['bind'])
    expect(quiet.getComponents('map')[0].configurations[0].state).toBe('active')
    expect(warnings.some(entry => entry.includes('no @unbind for demo.traffic'))).toBe(true)
  })

  it('should survive a failing bind method', async () => {
    const events: string[] = []

    @component({ service: ['demo.map'] })
    class Map2D {
      @bind('demo.tiles') setTiles(): void { throw new Error('boom') }
      @activate() start(): void { events.push('activate') }
    }

    services.register('demo.tiles', {})
    await loader.loadModule(manifest('map'), {
      container: { Map2D }
    })

    // Logged, not thrown: the component stays as it is, which is the promise of a
    // dynamic reference
    expect(events).toEqual(['activate'])
    expect(services.has('demo.map')).toBe(true)
  })

  it('should make a component with only @bind immediate', async () => {
    const bound = vi.fn()

    // No @activate, no service — it would be delayed and never hear anything
    @component()
    class Watcher {
      @bind('demo.tiles') setTiles(): void { bound() }
    }

    services.register('demo.tiles', {})
    await loader.loadModule(manifest('w'), { container: { Watcher } })

    expect(bound).toHaveBeenCalled()
  })
})

describe('switching a single component off', () => {
  let services: DefaultServiceRegistry
  let loader: ModuleLoader

  beforeEach(() => {
    services = new DefaultServiceRegistry()
    loader = new ModuleLoader({ serviceRegistry: services })
  })

  async function twoComponents(events: string[] = []): Promise<string[]> {
    @component({ service: ['demo.tiles'] })
    class RasterTiles {
      @activate() start(): void { events.push('tiles:start') }
      @deactivate() stop(): void { events.push('tiles:stop') }
    }

    @component({ service: ['demo.clock'] })
    class Clock {
      @activate() start(): void { events.push('clock:start') }
    }

    await loader.loadModule(manifest('mod'), { container: { RasterTiles, Clock } })
    return events
  }

  it('should stop it and leave its siblings alone', async () => {
    const events = await twoComponents()

    await loader.disableComponent('mod', 'RasterTiles')

    expect(events).toEqual(['tiles:start', 'clock:start', 'tiles:stop'])
    expect(services.has('demo.tiles')).toBe(false)
    expect(services.has('demo.clock')).toBe(true)
    expect(loader.getModule('mod')?.state).toBe('active')
  })

  it('should say it is off rather than waiting', async () => {
    await twoComponents()
    await loader.disableComponent('mod', 'RasterTiles')

    const [tiles] = loader.getComponents('mod')
    expect(tiles.disabled).toBe(true)
    expect(loader.getDisabledComponents()).toEqual(['mod/RasterTiles'])
  })

  it('should not bring it back through a reconciliation', async () => {
    const events = await twoComponents()
    await loader.disableComponent('mod', 'RasterTiles')

    // Anything at all happening in the registry
    services.register('demo.unrelated', {})
    await loader.settle()

    // Off is off — a disabled module behaves the same way
    expect(events.filter(entry => entry === 'tiles:start')).toHaveLength(1)
    expect(services.has('demo.tiles')).toBe(false)
  })

  it('should let it run again', async () => {
    const events = await twoComponents()
    await loader.disableComponent('mod', 'RasterTiles')

    await loader.enableComponent('mod', 'RasterTiles')

    expect(events).toEqual(['tiles:start', 'clock:start', 'tiles:stop', 'tiles:start'])
    expect(services.has('demo.tiles')).toBe(true)
  })

  it('should cascade to whatever consumed its service', async () => {
    @component({ service: ['demo.tiles'] })
    class RasterTiles {}

    @component({ service: ['demo.map'] })
    class Map2D {
      constructor(@inject('demo.tiles') private tiles: unknown) {}
      @activate() start(): void {}
    }

    await loader.loadModule(manifest('mod'), { container: { RasterTiles, Map2D } })
    expect(services.has('demo.map')).toBe(true)

    await loader.disableComponent('mod', 'RasterTiles')

    // The map was not disabled — it lost what it injects
    expect(services.has('demo.map')).toBe(false)
    const map = loader.getComponents('mod').find(entry => entry.className === 'Map2D')!
    expect(map.disabled).toBe(false)
    expect(map.configurations[0].state).toBe('unsatisfied-reference')
  })

  it('should keep it off across a module reload', async () => {
    const hot = new ModuleLoader({ serviceRegistry: services, hotReload: true })

    @component({ service: ['demo.tiles'] })
    class RasterTiles {}

    await hot.loadModule(manifest('mod'), { container: { RasterTiles } })
    await hot.disableComponent('mod', 'RasterTiles')

    await hot.reloadModule('mod')

    // The switch belongs to the deployment, not to the module instance
    expect(services.has('demo.tiles')).toBe(false)
    expect(hot.getComponents('mod')[0].disabled).toBe(true)
  })

  it('should refuse to enable what was never disabled', async () => {
    await twoComponents()

    expect(await loader.enableComponent('mod', 'RasterTiles')).toBe(false)
  })

  it('should remember the switch for a component it has never seen', async () => {
    // Disabling before the module is loaded: the name is all that is needed
    expect(await loader.disableComponent('later', 'NotYetLoaded')).toBe(false)
    expect(loader.getDisabledComponents()).toEqual(['later/NotYetLoaded'])

    @component({ service: ['demo.thing'] })
    class NotYetLoaded {
      @activate() start(): void {}
    }
    await loader.loadModule(manifest('later'), { container: { NotYetLoaded } })

    expect(services.has('demo.thing')).toBe(false)
    expect(loader.getComponents('later')[0].disabled).toBe(true)
  })
})
