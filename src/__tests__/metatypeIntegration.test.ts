import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import { ConfigurationAdmin } from '../ConfigurationAdmin'
import { MetatypeRegistry, METATYPE_SERVICE_ID, objectClass } from '../Metatype'
import { activate, component } from '../decorators'
import type { ComponentContext, ModuleManifest } from '../types'

/**
 * Metatype where it meets the rest: the loader publishes what a component
 * declared and applies the declared defaults, and a registry handed to Config
 * Admin refuses values that do not fit.
 */

const tileSchema = objectClass({
  id: 'demo.tiles',
  name: 'Tile source',
  attributes: {
    url: { type: 'string', name: 'Tile URL', required: false },
    zoom: { type: 'integer', default: 12, min: 1, max: 22 },
    layers: { type: 'string', cardinality: 'many', default: ['road'] }
  }
})

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

describe('metatype and the loader', () => {
  let metatype: MetatypeRegistry
  let admin: ConfigurationAdmin

  beforeEach(() => {
    resetContainers()
    metatype = new MetatypeRegistry()
    admin = new ConfigurationAdmin({ metatype })
  })

  afterEach(() => {
  })

  function loaderWith(): ModuleLoader {
    return testLoader({ configurationAdmin: admin, metatype })
  }

  describe('designation', () => {
    it('should publish what a component declared', async () => {
      @component({ configurationPid: 'demo.tiles', configurationSchema: tileSchema })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(metatype.getPids()).toEqual(['demo.tiles'])
      expect(metatype.getObjectClassDefinition('demo.tiles')?.name).toBe('Tile source')
    })

    it('should mark a declared template as a factory PID', async () => {
      @component({
        configurationPid: 'demo.tile-source',
        configurationSchema: tileSchema,
        configurationFactory: true
      })
      class TileSource {}

      const loader = loaderWith()
      containers.sources = { TileSource }

      await loader.loadModule(manifest('sources'))

      // A user interface may now offer "add one" before any instance exists
      expect(metatype.getFactoryPids()).toEqual(['demo.tile-source'])
      expect(metatype.getPids()).toEqual([])
    })

    it('should describe every PID a component reads', async () => {
      @component({
        configurationPid: ['demo.shared', 'demo.tiles'],
        configurationSchema: tileSchema
      })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(metatype.getPids().sort()).toEqual(['demo.shared', 'demo.tiles'])
    })

    it('should not describe a component that ignores configuration', async () => {
      @component({ configurationPolicy: 'ignore', configurationSchema: tileSchema })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(metatype.getPids()).toEqual([])
    })

    it('should withdraw the schema when the module goes', async () => {
      @component({ configurationPid: 'demo.tiles', configurationSchema: tileSchema })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }
      await loader.loadModule(manifest('tiles'))

      await loader.unloadModule('tiles')

      expect(metatype.getPids()).toEqual([])
    })

    it('should publish the registry as a service', () => {
      const loader = loaderWith()

      expect(loader.getServiceRegistry().get(METATYPE_SERVICE_ID)).toBe(metatype)
    })
  })

  describe('declared defaults', () => {
    it('should reach a component that has no configuration at all', async () => {
      let received: Record<string, unknown> = {}

      @component({ configurationPid: 'demo.tiles', configurationSchema: tileSchema })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // No configuration exists, yet the component reads its declared values
      expect(received).toEqual({ zoom: 12, layers: ['road'] })
    })

    it('should give way to a configured value', async () => {
      let received: Record<string, unknown> = {}

      @component({ configurationPid: 'demo.tiles', configurationSchema: tileSchema })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      await admin.getConfiguration('demo.tiles').update({ zoom: 3 })
      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      expect(received).toMatchObject({ zoom: 3, layers: ['road'] })
    })

    it('should become service properties like any other value', async () => {
      @component({
        service: ['demo.tiles'],
        configurationPid: 'demo.tiles',
        configurationSchema: tileSchema
      })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      const [reference] = loader.getServiceRegistry().getServiceReferences('demo.tiles')
      expect(reference.properties.zoom).toBe(12)
      // So a consumer can select on a value nobody configured
      expect(loader.getServiceRegistry().getServiceReferences('demo.tiles', '(zoom=12)'))
        .toHaveLength(1)
    })

    it('should merge the defaults of every PID a component reads', async () => {
      let received: Record<string, unknown> = {}

      // A shared PID, described by whoever owns it
      const shared = objectClass({
        id: 'demo.shared',
        attributes: {
          retina: { type: 'boolean', default: true },
          zoom: { type: 'integer', default: 5 }
        }
      })
      metatype.designate('demo.shared', shared)
      metatype.designate('demo.tiles', tileSchema)

      // Reads both and describes neither: the schemas belong to the PIDs
      @component({ configurationPid: ['demo.shared', 'demo.tiles'] })
      class RasterTiles {
        @activate() start(context: ComponentContext): void {
          received = { ...context.configuration }
        }
      }

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // Both contribute, and the later PID wins where they overlap — the same
      // order in which their values would merge
      expect(received).toEqual({ retina: true, zoom: 12, layers: ['road'] })
    })

    it('should warn when two components describe one PID differently', async () => {
      const other = objectClass({
        id: 'demo.other-shape',
        attributes: { zoom: { type: 'integer', default: 5 } }
      })
      const warnings: string[] = []

      @component({ configurationPid: 'demo.tiles', configurationSchema: tileSchema })
      class RasterTiles {}

      @component({ configurationPid: 'demo.tiles', configurationSchema: other })
      class VectorTiles {}

      const loader = testLoader({
        configurationAdmin: admin,
        metatype,
        logger: {
          debug: () => {}, info: () => {}, error: () => {},
          warn: message => warnings.push(message)
        }
      })
      containers.tiles = { RasterTiles, VectorTiles }

      await loader.loadModule(manifest('tiles'))

      expect(warnings.some(message => message.includes('already described'))).toBe(true)
      // Last one wins, and says so rather than deciding quietly
      expect(metatype.getObjectClassDefinition('demo.tiles')?.id).toBe('demo.other-shape')
    })

    it('should not fill in defaults for a component still waiting for its PID', async () => {
      @component({
        service: ['demo.tiles'],
        configurationPid: 'demo.tiles',
        configurationSchema: tileSchema,
        configurationPolicy: 'require'
      })
      class RasterTiles {}

      const loader = loaderWith()
      containers.tiles = { RasterTiles }

      await loader.loadModule(manifest('tiles'))

      // require means a configuration has to exist; defaults are not one
      expect(loader.getServiceRegistry().has('demo.tiles')).toBe(false)
    })
  })

  describe('validation through Config Admin', () => {
    beforeEach(() => {
      metatype.designate('demo.tiles', tileSchema)
    })

    it('should refuse a value the schema rejects', async () => {
      await expect(
        admin.getConfiguration('demo.tiles').update({ zoom: 99 })
      ).rejects.toThrow(/zoom must be at most 22/)
    })

    it('should name every problem in one message', async () => {
      await expect(
        admin.getConfiguration('demo.tiles').update({ zoom: 0, layers: 'road' } as never)
      ).rejects.toThrow(/zoom must be at least 1; layers expects a list/)
    })

    it('should accept values that fit', async () => {
      await admin.getConfiguration('demo.tiles').update({ zoom: 14, layers: ['sat'] })

      expect(admin.findConfiguration('demo.tiles')?.getProperties()).toMatchObject({ zoom: 14 })
    })

    it('should leave a PID nobody described alone', async () => {
      await admin.getConfiguration('demo.undescribed').update({ anything: 'goes' })

      expect(admin.findConfiguration('demo.undescribed')).toBeDefined()
    })

    it('should validate a factory instance against its factory schema', async () => {
      metatype.designate('demo.tile-source', tileSchema, { factory: true })

      await expect(
        admin.getFactoryConfiguration('demo.tile-source', 'osm').update({ zoom: 99 })
      ).rejects.toThrow(/must be at most 22/)
    })

    it('should not validate without a registry', async () => {
      const unchecked = new ConfigurationAdmin()

      await unchecked.getConfiguration('demo.tiles').update({ zoom: 99 })

      expect(unchecked.findConfiguration('demo.tiles')?.getProperties()?.zoom).toBe(99)
    })
  })
})
