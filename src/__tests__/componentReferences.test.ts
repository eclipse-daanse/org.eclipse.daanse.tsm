import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { activate, component, deactivate, inject } from '../decorators'
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
