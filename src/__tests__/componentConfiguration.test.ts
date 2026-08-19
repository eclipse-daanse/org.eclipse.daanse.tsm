import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import {
  ConfigurationAdmin,
  MemoryConfigurationStore,
  CONFIGURATION_ADMIN_SERVICE_ID
} from '../ConfigurationAdmin'
import { activate, component, deactivate, modified } from '../decorators'
import type { ComponentContext, ModuleManifest } from '../types'

/**
 * Configuration bound to components, as DS binds it: the PID decides whether a
 * component runs, how often, and with which properties — while the module around
 * it just stays active. In OSGi that separation is the line between the framework
 * and SCR; here it runs through one loader, which is why these tests watch the
 * module state as closely as the component's.
 */

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `http://localhost/${id}/remoteEntry.js`,
    exports: {},
    ...extra
  }
}

describe('component configuration', () => {
  let admin: ConfigurationAdmin

  beforeEach(() => {
    resetContainers()
    admin = new ConfigurationAdmin()
  })

  afterEach(() => {
  })

  function loaderWith(admin?: ConfigurationAdmin): ModuleLoader {
    return testLoader({ configurationAdmin: admin })
  }

  describe('policy optional', () => {
    it('should run the component without configuration', async () => {
      const seen: unknown[] = []

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          seen.push(context.configuration)
        }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // An empty object rather than undefined, so reading a value needs no guard
      expect(seen).toEqual([{}])
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(true)
    })

    it('should hand over the configuration that exists', async () => {
      let received: Record<string, unknown> = {}

      @component({ service: ['demo.tiles'], configurationPid: 'demo.tiles' })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('demo.tiles').update({ url: 'https://a/{z}', zoom: 12 })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(received).toMatchObject({ url: 'https://a/{z}', zoom: 12 })
    })

    it('should default the PID to the class name', async () => {
      let received: Record<string, unknown> = {}

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'by-class-name' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(received.url).toBe('by-class-name')
    })

    it('should merge several PIDs left to right', async () => {
      let received: Record<string, unknown> = {}

      @component({ configurationPid: ['demo.shared', 'demo.tiles'] })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('demo.shared').update({ url: 'shared', retina: true })
      await admin.getConfiguration('demo.tiles').update({ url: 'specific' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(received).toMatchObject({ url: 'specific', retina: true })
    })

    it('should publish the configuration as service properties', async () => {
      @component({ service: ['demo.tiles'], properties: { kind: 'raster' } })
      class RasterTiles {}

      await admin.getConfiguration('RasterTiles').update({ zone: 'main' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      const [reference] = loader.getServiceRegistry().getServiceReferences('demo.tiles')
      expect(reference.properties).toMatchObject({ kind: 'raster', zone: 'main' })
    })

    it('should let configuration override a declared property', async () => {
      @component({ service: ['demo.tiles'], properties: { kind: 'raster' } })
      class RasterTiles {}

      await admin.getConfiguration('RasterTiles').update({ kind: 'vector' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      const registry = loader.getServiceRegistry()
      expect(registry.getServiceReferences('demo.tiles', '(kind=vector)')).toHaveLength(1)
    })

    it('should keep a private property out of the service properties', async () => {
      let received: Record<string, unknown> = {}

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'a', '.token': 'secret' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // The component sees it, a consumer filtering on properties does not
      expect(received['.token']).toBe('secret')
      const [reference] = loader.getServiceRegistry().getServiceReferences('demo.tiles')
      expect(reference.properties['.token']).toBeUndefined()
      expect(reference.properties.url).toBe('a')
    })

    it('should take the ranking from configuration', async () => {
      @component({ service: ['demo.tiles'], ranking: 1 })
      class RasterTiles {}

      await admin.getConfiguration('RasterTiles').update({ 'service.ranking': 50 })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')[0].ranking).toBe(50)
    })
  })

  describe('policy require', () => {
    it('should not register the component while its configuration is missing', async () => {
      const started = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {
        @activate() start(): void { started() }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(started).not.toHaveBeenCalled()
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(false)
    })

    it('should leave the module active, unlike a missing service', async () => {
      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {}

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // The bundle runs; only the component waits. This is the separation DS has
      // between a bundle's lifecycle and a component's
      expect(loader.getModule('tiles')?.state).toBe('active')
      expect(loader.getUnsatisfiedModules()).toEqual([])
    })

    it('should report the component as unsatisfied by configuration', async () => {
      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {}

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(loader.getComponents('tiles')[0].configurations).toEqual([
        { state: 'unsatisfied-configuration', properties: {} }
      ])
    })

    it('should start the component when its configuration arrives', async () => {
      const started = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {
        @activate() start(context: ComponentContext): void { started(context.configuration.url) }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ url: 'https://a/{z}' })
      await loader.settle()

      expect(started).toHaveBeenCalledWith('https://a/{z}')
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(true)
    })

    it('should stop the component when its configuration is deleted', async () => {
      const stopped = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').delete()
      await loader.settle()

      expect(stopped).toHaveBeenCalled()
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(false)
      expect(loader.getModule('tiles')?.state).toBe('active')
    })

    it('should wait forever without a Configuration Admin', async () => {
      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {}

      const loader = loaderWith(undefined)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(false)
      expect(loader.getComponents('tiles')[0].configurations[0].state)
        .toBe('unsatisfied-configuration')
    })

    it('should not report a declared service as drift while its component waits', async () => {
      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {}

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles', {
        provides: [{ id: 'demo.tiles', type: 'service' }]
      }))

      // The manifest promised it and the code offers it — it is waiting, not adrift
      expect(loader.getDeclarationMismatches()).toEqual([])
    })

    it('should let a consumer module wait and then activate', async () => {
      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {}

      @component({ service: ['demo.map'] })
      class Map2D {}

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      containers.map = { Map2D }
      loader.register([
        manifest('tiles', { provides: [{ id: 'demo.tiles', type: 'service' }] }),
        manifest('map', { requiresService: [{ id: 'demo.tiles' }] })
      ])

      await loader.loadAll()
      expect(loader.getModule('map')?.state).toBe('unsatisfied')

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      await loader.settle()

      // Configuration of one component carried a whole module into service
      expect(loader.getModule('map')?.state).toBe('active')
    })
  })

  describe('policy ignore', () => {
    it('should not read configuration at all', async () => {
      let received: Record<string, unknown> = {}

      @component({ service: ['demo.tiles'], configurationPolicy: 'ignore' })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'ignored' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(received).toEqual({})
    })

    it('should not react to a later change', async () => {
      const modifiedCalls = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'ignore' })
      class RasterTiles {
        @activate() start(): void {}
        @modified() update(): void { modifiedCalls() }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      await loader.settle()

      expect(modifiedCalls).not.toHaveBeenCalled()
    })
  })

  describe('a change to existing configuration', () => {
    it('should call @modified and keep the same instance', async () => {
      const instances: object[] = []
      const updates: unknown[] = []

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void { instances.push(this) }
        @modified() update(context: ComponentContext): void { updates.push(context.configuration.url) }
        @deactivate() stop(): void { instances.pop() }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'first' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))
      const before = instances[0]

      await admin.getConfiguration('RasterTiles').update({ url: 'second' })
      await loader.settle()

      expect(updates).toEqual(['second'])
      expect(instances[0]).toBe(before)
    })

    it('should rebuild the component when it has no @modified', async () => {
      const events: string[] = []

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void { events.push('start') }
        @deactivate() stop(): void { events.push('stop') }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'first' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ url: 'second' })
      await loader.settle()

      // DS does exactly this: without @modified, changed configuration means
      // deactivate and activate again
      expect(events).toEqual(['start', 'stop', 'start'])
    })

    it('should update the service properties either way', async () => {
      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void {}
      }

      await admin.getConfiguration('RasterTiles').update({ kind: 'raster' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ kind: 'vector' })
      await loader.settle()

      const registry = loader.getServiceRegistry()
      expect(registry.getServiceReferences('demo.tiles', '(kind=vector)')).toHaveLength(1)
      expect(registry.getServiceReferences('demo.tiles', '(kind=raster)')).toHaveLength(0)
    })

    it('should only update properties of a component nobody has resolved', async () => {
      const built = vi.fn()

      // Delayed: it offers a service and has no lifecycle, so it is not created
      // until somebody asks for it
      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        constructor() { built() }
      }

      await admin.getConfiguration('RasterTiles').update({ kind: 'raster' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ kind: 'vector' })
      await loader.settle()

      // Nothing was rebuilt, because nothing had been built
      expect(built).not.toHaveBeenCalled()
      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')[0].properties.kind)
        .toBe('vector')
    })

    it('should rebuild a delayed component that a consumer has resolved', async () => {
      const built: string[] = []

      // No lifecycle at all, so the loader never creates it — but a consumer did,
      // and that instance holds the old configuration
      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        constructor() { built.push('built') }
      }

      await admin.getConfiguration('RasterTiles').update({ kind: 'raster' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))
      loader.getServiceRegistry().get('demo.tiles')
      expect(built).toHaveLength(1)

      await admin.getConfiguration('RasterTiles').update({ kind: 'vector' })
      await loader.settle()

      // The registry built it, so a rebuild is what the new values require
      expect(loader.getServiceRegistry().get('demo.tiles')).toBeDefined()
      expect(built).toHaveLength(2)
    })

    it('should treat configuration appearing as a change, not a new instance', async () => {
      const events: string[] = []

      // The component starts unconfigured — policy optional — and configuration
      // shows up later. That is one component configuration whose values changed,
      // not a different one, so @modified applies
      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void { events.push('start') }
        @modified() update(): void { events.push('modified') }
        @deactivate() stop(): void { events.push('stop') }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      await loader.settle()

      expect(events).toEqual(['start', 'modified'])
      expect(loader.getComponents('tiles')[0].configurations[0].pid).toBe('RasterTiles')
    })

    it('should treat configuration being deleted as a change too', async () => {
      const events: string[] = []

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void { events.push('start') }
        @modified() update(context: ComponentContext): void {
          events.push(`modified:${Object.keys(context.configuration).length}`)
        }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').delete()
      await loader.settle()

      // Still running, now without values — policy optional allows that
      expect(events).toEqual(['start', 'modified:0'])
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(true)
    })

    it('should rebuild only the component that lacks @modified when both share a PID', async () => {
      const events: string[] = []

      @component({ service: ['clock.steady'], configurationPid: 'demo.clock' })
      class SteadyClock {
        @activate() start(): void { events.push('steady:start') }
        @modified() update(): void { events.push('steady:modified') }
        @deactivate() stop(): void { events.push('steady:stop') }
      }

      @component({ service: ['clock.restarting'], configurationPid: 'demo.clock' })
      class RestartingClock {
        @activate() start(): void { events.push('restarting:start') }
        @deactivate() stop(): void { events.push('restarting:stop') }
      }

      const loader = loaderWith(admin)
      containers.clock = { SteadyClock, RestartingClock }
      await loader.loadModule(manifest('clock'))
      events.length = 0

      await admin.getConfiguration('demo.clock').update({ interval: 300 })
      await loader.settle()

      expect(events).toEqual(['steady:modified', 'restarting:stop', 'restarting:start'])
    })

    it('should do nothing when a re-delivery changes no value', async () => {
      const events: string[] = []

      @component({ service: ['demo.tiles'] })
      class RasterTiles {
        @activate() start(): void { events.push('start') }
        @deactivate() stop(): void { events.push('stop') }
      }

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await admin.getConfiguration('RasterTiles').update()
      await loader.settle()

      expect(events).toEqual(['start'])
    })
  })

  describe('factory configurations', () => {
    it('should create one instance per configuration', async () => {
      const started: string[] = []

      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {
        @activate() start(context: ComponentContext): void {
          started.push(String(context.configuration.name))
        }
      }

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }

      await loader.loadModule(manifest('tiles'))

      expect(started.sort()).toEqual(['osm', 'sat'])
      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')).toHaveLength(2)
    })

    it('should let a consumer tell them apart by a target filter', async () => {
      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {}

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      const registry = loader.getServiceRegistry()
      expect(registry.getServiceReferences('demo.tiles', '(name=sat)')).toHaveLength(1)
    })

    it('should list the instances as configurations of one declaration', async () => {
      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {}

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      const [declaration] = loader.getComponents('tiles')
      expect(declaration.className).toBe('TileSource')
      expect(declaration.configurations.map(entry => entry.pid))
        .toEqual(['demo.tile-source~osm', 'demo.tile-source~sat'])
    })

    it('should add an instance when a configuration is added', async () => {
      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {}

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      await loader.settle()

      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')).toHaveLength(2)
    })

    it('should remove one instance and leave the other', async () => {
      const stopped: string[] = []

      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {
        private name = 'unknown'
        @activate() start(context: ComponentContext): void {
          this.name = String(context.configuration.name)
        }
        @deactivate() stop(): void { stopped.push(this.name) }
      }

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      await admin.findConfiguration('demo.tile-source~osm')?.delete()
      await loader.settle()

      expect(stopped).toEqual(['osm'])
      const references = loader.getServiceRegistry().getServiceReferences('demo.tiles')
      expect(references).toHaveLength(1)
      expect(references[0].properties.name).toBe('sat')
    })

    it('should give every instance its own alias registration', async () => {
      @component({
        service: ['demo.raster', 'demo.tiles'],
        configurationPid: 'demo.tile-source'
      })
      class TileSource {}

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      // Both under the interface as well, not just under the primary ID
      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')).toHaveLength(2)
    })

    it('should keep the singleton values underneath a factory configuration', async () => {
      let received: Record<string, unknown> = {}

      @component({ configurationPid: ['demo.shared', 'demo.tile-source'] })
      class TileSource {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('demo.shared').update({ retina: true, name: 'default' })
      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }

      await loader.loadModule(manifest('tiles'))

      expect(received).toMatchObject({ retina: true, name: 'osm' })
    })

    it('should require a factory configuration when the policy says so', async () => {
      @component({
        service: ['demo.tiles'],
        configurationPid: 'demo.tile-source',
        configurationPolicy: 'require'
      })
      class TileSource {}

      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(false)

      await admin.createFactoryConfiguration('demo.tile-source').update({ name: 'osm' })
      await loader.settle()

      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles')).toHaveLength(1)
    })
  })

  describe('the admin as a service', () => {
    it('should be available to modules', async () => {
      const loader = loaderWith(admin)

      expect(loader.getServiceRegistry().get(CONFIGURATION_ADMIN_SERVICE_ID)).toBe(admin)
    })

    it('should not be registered when none was passed', () => {
      const loader = loaderWith(undefined)

      expect(loader.getServiceRegistry().has(CONFIGURATION_ADMIN_SERVICE_ID)).toBe(false)
    })
  })

  describe('a store that already holds values', () => {
    it('should start a requiring component right away', async () => {
      const started = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {
        @activate() start(context: ComponentContext): void { started(context.configuration.url) }
      }

      const stored = new ConfigurationAdmin({
        store: new MemoryConfigurationStore([
          { pid: 'RasterTiles', properties: { url: 'from-store' }, changeCount: 1 }
        ])
      })
      const loader = testLoader({ configurationAdmin: stored })
      containers.tiles = { RasterTiles }
      loader.register([manifest('tiles')])

      await loader.loadAll()

      // loadAll awaits the store, so the component is not parked and woken again
      expect(started).toHaveBeenCalledWith('from-store')
    })
  })

  describe('module teardown', () => {
    it('should stop every instance of a component', async () => {
      const stopped: string[] = []

      @component({ service: ['demo.tiles'], configurationPid: 'demo.tile-source' })
      class TileSource {
        private name = 'unknown'
        @activate() start(context: ComponentContext): void {
          this.name = String(context.configuration.name)
        }
        @deactivate() stop(): void { stopped.push(this.name) }
      }

      await admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ name: 'osm' })
      await admin.getFactoryConfiguration('demo.tile-source', 'sat').update({ name: 'sat' })
      const loader = loaderWith(admin)
      containers.tiles = { TileSource }
      await loader.loadModule(manifest('tiles'))

      await loader.unloadModule('tiles')

      expect(stopped.sort()).toEqual(['osm', 'sat'])
      expect(loader.getComponents('tiles')).toEqual([])
    })

    it('should stop reacting to configuration after a module is gone', async () => {
      const started = vi.fn()

      @component({ service: ['demo.tiles'], configurationPolicy: 'require' })
      class RasterTiles {
        @activate() start(): void { started() }
      }

      const loader = loaderWith(admin)
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))
      await loader.unloadModule('tiles')

      await admin.getConfiguration('RasterTiles').update({ url: 'a' })
      await loader.settle()

      expect(started).not.toHaveBeenCalled()
    })
  })
})
