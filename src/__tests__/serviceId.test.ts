/**
 * Typed service ids at runtime — where they are nothing but strings.
 *
 * The type-level half is in `serviceId.test-d.ts`. This half is the promise that
 * makes the other one safe to adopt: a manifest, a filter and a capability cannot
 * tell a typed id from a written-out string.
 */

import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { serviceId } from '../serviceId.js'
import { DefaultServiceRegistry } from '../ServiceRegistry.js'
import { ModuleLoader } from '../ModuleLoader.js'
import { component, activate, inject, injectAll } from '../decorators.js'
import type { ModuleManifest } from '../types.js'

interface TileService { tileUrl(z: number): string }
const TileService = serviceId<TileService>('demo.tiles')

interface Tool { label: string }
const Tool = serviceId<Tool>('demo.tool')

const manifest = (id: string): ModuleManifest =>
  ({ id, version: '1.0.0', entry: `${id}.js`, exports: {} })

describe('at runtime', () => {
  it('is the string it was given', () => {
    expect(TileService).toBe('demo.tiles')
    expect(typeof TileService).toBe('string')
  })

  it('is the same value, not a copy', () => {
    // An identity function: nothing wraps, nothing allocates
    const id = 'demo.tiles'
    expect(serviceId<TileService>(id)).toBe(id)
  })

  it('serialises as a string', () => {
    expect(JSON.stringify({ provides: [{ id: TileService }] }))
      .toBe('{"provides":[{"id":"demo.tiles"}]}')
  })

  it('compares equal to the written-out form', () => {
    expect(TileService === 'demo.tiles').toBe(true)
  })
})

describe('in the registry', () => {
  it('registers and resolves', () => {
    const registry = new DefaultServiceRegistry()
    registry.register(TileService, { tileUrl: z => `/${z}` })

    expect(registry.get(TileService)?.tileUrl(3)).toBe('/3')
  })

  it('is found by the written-out string', () => {
    // Which is what makes it safe to introduce one id at a time
    const registry = new DefaultServiceRegistry()
    registry.register(TileService, { tileUrl: z => `/${z}` })

    expect(registry.has('demo.tiles')).toBe(true)
    expect(registry.get<TileService>('demo.tiles')).toBeDefined()
  })

  it('finds a typed id registered as a plain string', () => {
    const registry = new DefaultServiceRegistry()
    registry.register('demo.tiles', { tileUrl: (z: number) => `/${z}` })

    expect(registry.get(TileService)).toBeDefined()
  })

  it('works with target filters', () => {
    const registry = new DefaultServiceRegistry()
    registry.register(TileService, { tileUrl: () => 'raster' },
      { properties: { kind: 'raster' }, providedBy: 'a' })
    registry.register(TileService, { tileUrl: () => 'vector' },
      { properties: { kind: 'vector' }, providedBy: 'b' })

    expect(registry.getMatching(TileService, '(kind=vector)')?.tileUrl(0)).toBe('vector')
  })

  it('collects every provider with getServices', () => {
    const registry = new DefaultServiceRegistry()
    registry.register(Tool, { label: 'Bold' }, { providedBy: 'text' })
    registry.register(Tool, { label: 'Pen' }, { providedBy: 'draw' })

    expect(registry.getServices(Tool).map(tool => tool.label).sort())
      .toEqual(['Bold', 'Pen'])
  })

  it('leaves out a provider that cannot be built', () => {
    // A collection of services should not need a null check per element
    const registry = new DefaultServiceRegistry()
    registry.register(Tool, { label: 'Bold' }, { providedBy: 'text' })
    registry.bind(Tool, () => undefined as unknown as Tool, { providedBy: 'broken' })

    expect(registry.getServices(Tool)).toHaveLength(1)
  })
})

describe('in a component', () => {
  it('declares the service and injects it', async () => {
    const loader = new ModuleLoader()
    loader.getServiceRegistry().register(TileService, { tileUrl: z => `/${z}` })

    let seen = ''

    @component({ service: [Tool] })
    class Ruler implements Tool {
      readonly label = 'Ruler'
      constructor(@inject(TileService) private readonly tiles: TileService) {}
      @activate() start(): void { seen = this.tiles.tileUrl(7) }
    }

    await loader.loadModule(manifest('tools'), { container: { Ruler } })

    expect(seen).toBe('/7')
    // Registered under the plain string, so a consumer that never saw the token
    // still finds it
    expect(loader.getServiceRegistry().has('demo.tool')).toBe(true)
  })

  it('reports the id as a string in the component listing', async () => {
    const loader = new ModuleLoader()

    @component({ service: [Tool] })
    class Ruler implements Tool { readonly label = 'Ruler' }

    await loader.loadModule(manifest('tools'), { container: { Ruler } })

    expect(loader.getComponents('tools')[0].services).toEqual(['demo.tool'])
  })

  it('collects with injectAll', async () => {
    const loader = new ModuleLoader()
    loader.getServiceRegistry().register(Tool, { label: 'Bold' }, { providedBy: 'text' })

    let count = -1

    @component()
    class Toolbar {
      @injectAll(Tool) tools: Tool[] = []
      @activate() start(): void { count = this.tools.length }
    }

    await loader.loadModule(manifest('bar'), { container: { Toolbar } })
    expect(count).toBe(1)
  })

  it('resolves against a manifest that spells the id out', async () => {
    // The manifest is JSON, so it can only ever hold the string — this is the
    // test that the two halves meet
    const loader = new ModuleLoader()
    loader.register([
      { ...manifest('tools'), provides: [{ id: 'demo.tool' }] },
      { ...manifest('shell'), requiresService: [{ id: 'demo.tool' }] }
    ])

    expect(loader.getWiring().unresolved).toEqual([])
  })
})
