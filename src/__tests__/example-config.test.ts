import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { ConfigurationAdmin } from '../ConfigurationAdmin'
import { bundles } from '../../examples/config/src/manifests'
import {
  CLOCK_PID,
  RESTARTING_CLOCK,
  STEADY_CLOCK,
  TILES_PID,
  TILE_SERVICE,
  TILE_SOURCE_FACTORY_PID,
  LOG_SERVICE,
  type Clock,
  type Log
} from '../../examples/config/src/contracts'
import * as clock from '../../examples/config/modules/clock'
import * as map from '../../examples/config/modules/map'
import * as sources from '../../examples/config/modules/sources'
import * as tiles from '../../examples/config/modules/tiles'
import { DefaultServiceRegistry } from '../ServiceRegistry'

/**
 * The configuration example, asserted rather than clicked: what the page shows is
 * what these expectations say.
 */
interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

describe('examples/config', () => {
  let savedWindow: Record<string, unknown> | undefined
  let admin: ConfigurationAdmin
  let services: DefaultServiceRegistry
  let loader: ModuleLoader

  beforeEach(() => {
    savedWindow = globalRef.window
    globalRef.window = { tiles, clock, sources, map }

    admin = new ConfigurationAdmin()
    services = new DefaultServiceRegistry()
    loader = new ModuleLoader({ serviceRegistry: services, configurationAdmin: admin })

    const log: Log = { write: () => {} }
    services.register(LOG_SERVICE, log, { providedBy: 'host' })
    loader.register(bundles)
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  it('should keep the bundle active while its component waits for configuration', async () => {
    await loader.loadAll()

    const [rasterTiles] = loader.getComponents('tiles')
    expect(rasterTiles.configurationPolicy).toBe('require')
    expect(rasterTiles.configurations[0].state).toBe('unsatisfied-configuration')
    // The bundle is not what is waiting — that is the whole distinction
    expect(loader.getModule('tiles')?.state).toBe('active')
  })

  it('should park the consumer bundle, because the service has no provider', async () => {
    await loader.loadAll()

    expect(loader.getUnsatisfiedModules()).toEqual([
      { moduleId: 'map', waitingFor: [TILE_SERVICE] }
    ])
  })

  it('should carry the consumer into service when the PID is configured', async () => {
    await loader.loadAll()

    await admin.getConfiguration(TILES_PID).update({ url: 'https://tiles/{z}' })
    await loader.settle()

    expect(services.has(TILE_SERVICE)).toBe(true)
    expect(loader.getModule('map')?.state).toBe('active')
  })

  it('should park the consumer again when the configuration is deleted', async () => {
    await loader.loadAll()
    await admin.getConfiguration(TILES_PID).update({ url: 'https://tiles/{z}' })
    await loader.settle()

    await admin.findConfiguration(TILES_PID)?.delete()
    await loader.settle()

    expect(services.has(TILE_SERVICE)).toBe(false)
    expect(loader.getModule('map')?.state).toBe('unsatisfied')
    expect(loader.getModule('tiles')?.state).toBe('active')
  })

  it('should publish the configured url as a service property', async () => {
    await loader.loadAll()

    await admin.getConfiguration(TILES_PID).update({ url: 'https://tiles/{z}', retina: true })
    await loader.settle()

    const [reference] = services.getServiceReferences(TILE_SERVICE)
    expect(reference.properties).toMatchObject({
      kind: 'raster',
      url: 'https://tiles/{z}',
      retina: true
    })
  })

  describe('the two clocks', () => {
    it('should let the one with @modified keep its instance', async () => {
      await loader.loadAll()
      await admin.getConfiguration(CLOCK_PID).update({ interval: 500 })
      await loader.settle()
      const steadyBefore = services.get<Clock>(STEADY_CLOCK)
      const restartingBefore = services.get<Clock>(RESTARTING_CLOCK)

      await admin.getConfiguration(CLOCK_PID).update({ interval: 200 })
      await loader.settle()

      expect(services.get<Clock>(STEADY_CLOCK)).toBe(steadyBefore)
      expect(services.get<Clock>(RESTARTING_CLOCK)).not.toBe(restartingBefore)
    })

    it('should differ only in whether they declare @modified', async () => {
      await loader.loadAll()

      const declarations = loader.getComponents('clock')
      expect(declarations.map(entry => [entry.className, entry.hasModified]))
        .toEqual([['SteadyClock', true], ['RestartingClock', false]])
    })

    it('should run unconfigured, because the policy is optional', async () => {
      await loader.loadAll()

      expect(services.get<Clock>(STEADY_CLOCK)).toBeDefined()
      expect(loader.getComponents('clock')[0].configurations[0].pid).toBeUndefined()
    })
  })

  describe('the factory', () => {
    it('should create one instance per configuration', async () => {
      await loader.loadAll()

      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'satellite')
        .update({ name: 'satellite', url: 'https://sat/{z}' })
      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'terrain')
        .update({ name: 'terrain', url: 'https://terrain/{z}' })
      await loader.settle()

      const [declaration] = loader.getComponents('sources')
      expect(declaration.className).toBe('TileSource')
      expect(declaration.configurations.map(entry => entry.pid)).toEqual([
        `${TILE_SOURCE_FACTORY_PID}~satellite`,
        `${TILE_SOURCE_FACTORY_PID}~terrain`
      ])
    })

    it('should let a filter pick one of them', async () => {
      await loader.loadAll()
      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'satellite')
        .update({ name: 'satellite', url: 'https://sat/{z}' })
      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'terrain')
        .update({ name: 'terrain', url: 'https://terrain/{z}' })
      await loader.settle()

      expect(services.getServiceReferences(TILE_SERVICE, '(name=terrain)')).toHaveLength(1)
      expect(services.getServiceReferences(TILE_SERVICE)).toHaveLength(2)
    })

    it('should satisfy the consumer without the singleton PID being configured', async () => {
      await loader.loadAll()

      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'satellite')
        .update({ name: 'satellite', url: 'https://sat/{z}' })
      await loader.settle()

      // RasterTiles is still waiting; the service arrived from somewhere else
      expect(loader.getComponents('tiles')[0].configurations[0].state)
        .toBe('unsatisfied-configuration')
      expect(loader.getModule('map')?.state).toBe('active')
    })

    it('should remove one instance and keep the other', async () => {
      await loader.loadAll()
      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'satellite')
        .update({ name: 'satellite', url: 'https://sat/{z}' })
      await admin.getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, 'terrain')
        .update({ name: 'terrain', url: 'https://terrain/{z}' })
      await loader.settle()

      await admin.findConfiguration(`${TILE_SOURCE_FACTORY_PID}~satellite`)?.delete()
      await loader.settle()

      const references = services.getServiceReferences(TILE_SERVICE)
      expect(references).toHaveLength(1)
      expect(references[0].properties.name).toBe('terrain')
    })
  })
})
