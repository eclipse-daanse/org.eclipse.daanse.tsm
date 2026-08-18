// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { DefaultServiceRegistry } from '../ServiceRegistry'
import { draw, type GraphModel } from '../../examples/graph/src/draw'
import { onDemand, serviceOrder, startup } from '../../examples/graph/src/manifests'
import * as elevation from '../../examples/graph/modules/elevation'
import * as map from '../../examples/graph/modules/map'
import * as navigation from '../../examples/graph/modules/navigation'
import * as tiles from '../../examples/graph/modules/tiles'
import * as tilesVector from '../../examples/graph/modules/tiles-vector'
import * as traffic from '../../examples/graph/modules/traffic'

/**
 * The graph example draws what the loader reports, so the test checks both: the
 * model the host assembles, and that the drawing turns it into boxes.
 */
interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

describe('examples/graph', () => {
  let savedWindow: Record<string, unknown> | undefined
  let services: DefaultServiceRegistry

  function setup(): ModuleLoader {
    globalRef.window = {
      tiles,
      'tiles-vector': tilesVector,
      navigation,
      traffic,
      map,
      elevation
    }
    services = new DefaultServiceRegistry()
    const loader = new ModuleLoader({ serviceRegistry: services })
    loader.register(startup)
    return loader
  }

  /** The same model main.ts builds */
  function model(loader: ModuleLoader): GraphModel {
    const waiting = new Map(
      loader.getUnsatisfiedModules().map(entry => [entry.moduleId, entry.waitingFor])
    )
    const required = loader
      .getManifests()
      .flatMap(manifest => manifest.requiresService?.map(requirement => requirement.id) ?? [])

    return {
      bundles: loader.getManifests().map(manifest => ({
        id: manifest.id,
        state: loader.getModule(manifest.id)?.state ?? 'not loaded',
        disabled: loader.isDisabled(manifest.id),
        waitingFor: waiting.get(manifest.id) ?? [],
        components: loader.getComponents(manifest.id)
      })),
      services: [...new Set([...serviceOrder, ...services.getServiceIds(), ...required])]
        .map(id => ({
          id,
          references: services.getServiceReferences(id),
          consumers: loader.getServiceConsumers(id).map(entry => ({
            moduleId: entry.moduleId,
            optional: entry.requirement.optional === true
          }))
        }))
    }
  }

  beforeEach(() => {
    savedWindow = globalRef.window
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  it('should report each bundle with its components', async () => {
    const loader = setup()

    await loader.loadAll()

    const current = model(loader)
    const byId = new Map(current.bundles.map(bundle => [bundle.id, bundle]))

    expect(byId.get('tiles')?.components.map(entry => entry.className)).toEqual(['RasterTiles'])
    // Two components in one bundle, one of them without a service
    expect(byId.get('navigation')?.components.map(entry => entry.className))
      .toEqual(['ShortestPath', 'TrafficWatcher'])
    expect(byId.get('navigation')?.components[1].services).toEqual([])
    expect(byId.get('navigation')?.components[1].immediate).toBe(true)
    expect(byId.get('tiles')?.components[0].immediate).toBe(false)
  })

  it('should show the parked bundle and what it waits for', async () => {
    const loader = setup()

    await loader.loadAll()

    const elevationNode = model(loader).bundles.find(bundle => bundle.id === 'elevation')
    expect(elevationNode?.state).toBe('unsatisfied')
    expect(elevationNode?.waitingFor).toEqual(['demo.terrain'])
    // A parked bundle has no components: its classes were never registered
    expect(elevationNode?.components).toEqual([])
  })

  it('should include a service nobody provides', async () => {
    const loader = setup()

    await loader.loadAll()

    const terrain = model(loader).services.find(service => service.id === 'demo.terrain')
    expect(terrain?.references).toEqual([])
    expect(terrain?.consumers).toEqual([{ moduleId: 'elevation', optional: false }])
  })

  it('should show two providers once the ranked bundle is loaded', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(onDemand['tiles-vector'], { awaitCascade: true })

    const tileService = model(loader).services.find(service => service.id === 'demo.tiles')
    expect(tileService?.references.map(reference => reference.providedBy))
      .toEqual(['tiles-vector', 'tiles'])
  })

  it('should park the consumer when the provider is disabled', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.disableModule('navigation')

    const current = model(loader)
    expect(current.bundles.find(bundle => bundle.id === 'navigation')?.disabled).toBe(true)
    // The map needed routing, so it waits now — the cascade, in the picture
    expect(current.bundles.find(bundle => bundle.id === 'map')?.waitingFor)
      .toEqual(['demo.routing'])
  })

  it('should fill the optional dependency when traffic arrives', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(onDemand.traffic, { awaitCascade: true })

    const trafficService = model(loader).services.find(service => service.id === 'demo.traffic')
    expect(trafficService?.references.map(reference => reference.providedBy)).toEqual(['traffic'])
  })

  describe('drawing', () => {
    it('should turn the model into boxes and edges', async () => {
      const loader = setup()
      await loader.loadAll()
      const host = document.createElement('div')

      draw(host, model(loader))

      expect(host.querySelectorAll('.bundle-box')).toHaveLength(4)
      expect(host.querySelectorAll('.component-box')).toHaveLength(4)
      expect(host.querySelectorAll('.service-box')).toHaveLength(5)
      expect(host.querySelectorAll('.edge-provides').length).toBeGreaterThan(0)
      expect(host.querySelectorAll('.edge-requires').length).toBeGreaterThan(0)
    })

    it('should mark a parked bundle and a service without a provider', async () => {
      const loader = setup()
      await loader.loadAll()
      const host = document.createElement('div')

      draw(host, model(loader))

      expect(host.querySelectorAll('.bundle-box.parked')).toHaveLength(1)
      expect(host.querySelectorAll('.service-box.missing')).toHaveLength(2)
    })

    it('should draw a standing-by provider with a muted edge', async () => {
      const loader = setup()
      await loader.loadAll()
      await loader.loadModule(onDemand['tiles-vector'], { awaitCascade: true })
      const host = document.createElement('div')

      draw(host, model(loader))

      expect(host.querySelectorAll('.edge-provides.shadowed')).toHaveLength(1)
    })

    it('should replace the previous drawing', async () => {
      const loader = setup()
      await loader.loadAll()
      const host = document.createElement('div')

      draw(host, model(loader))
      draw(host, model(loader))

      expect(host.querySelectorAll('svg')).toHaveLength(1)
    })
  })
})
