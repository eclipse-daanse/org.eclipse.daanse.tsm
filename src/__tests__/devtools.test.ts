import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import { installDevtools, collectingOutput, type CollectingOutput } from '../devtools'
import { tsmRuntime } from '../TsmRuntime'
import { ConfigurationAdmin } from '../ConfigurationAdmin'
import { activate, component, modified } from '../decorators'
import type { ModuleContext, ModuleManifest, ObservableServiceRegistry } from '../types'


function stub(
  loader: ModuleLoader,
  id: string,
  options: {
    requires?: Array<{ id: string }>
    provides?: string[]
    onActivate?: (services: ObservableServiceRegistry) => void
  } = {}
): ModuleManifest {
  const manifest: ModuleManifest = {
    id,
    name: id,
    version: '1.0.0',
    entry: `http://localhost/${id}/remoteEntry.js`,
    exports: {},
    requiresService: options.requires,
    provides: options.provides?.map(serviceId => ({ id: serviceId }))
  }
  containers[id] = {
    activate: (context: ModuleContext) => { options.onActivate?.(context.services) }
  }
  loader.register([manifest])
  return manifest
}

describe('installDevtools', () => {
  let out: CollectingOutput
  let host: Record<string, unknown>

  beforeEach(() => {
    resetContainers()
    out = collectingOutput()
    host = {}
  })

  afterEach(() => {
  })

  function devtools(loader: ModuleLoader) {
    return installDevtools({ loader, target: host, output: out })
  }

  describe('installation', () => {
    it('should install itself on the target under a default name', () => {
      const tools = devtools(testLoader())

      expect(host.tsm).toBe(tools)
      expect(out.text()).toContain('tsm.help()')
    })

    it('should honour a custom name', () => {
      const tools = installDevtools({
        loader: testLoader(), target: host, output: out, name: 'daanse'
      })

      expect(host.daanse).toBe(tools)
      expect(host.tsm).toBeUndefined()
    })

    it('should install nowhere when the target is null', () => {
      const tools = installDevtools({ loader: testLoader(), target: null, output: out })

      expect(host).toEqual({})
      expect(tools.modules).toBeTypeOf('function')
    })

    it('should remove itself again', () => {
      const tools = devtools(testLoader())

      tools.uninstall()

      expect(host.tsm).toBeUndefined()
    })

    it('should expose the objects behind the commands', () => {
      const loader = testLoader()
      const tools = devtools(loader)

      expect(tools.raw.loader).toBe(loader)
      expect(tools.raw.services).toBe(loader.getServiceRegistry())
    })
  })

  describe('modules', () => {
    it('should list registered modules with their state', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      stub(loader, 'beta', { requires: [{ id: 'absent.service' }] })
      await loader.loadAll()

      devtools(loader).modules()

      expect(out.text()).toContain('alpha')
      expect(out.text()).toContain('[active]')
      expect(out.text()).toContain('beta')
      expect(out.text()).toContain('[unsatisfied]')
      expect(out.text()).toContain('1 of 2 active')
    })

    it('should show a registered but never loaded module', () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})

      devtools(loader).modules()

      expect(out.text()).toContain('[not loaded]')
    })

    it('should say when nothing is registered', () => {
      devtools(testLoader()).modules()

      expect(out.text()).toContain('No modules registered')
    })
  })

  describe('shell aliases', () => {
    it('should map lb to modules and ls to services', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', {}) }
      })
      await loader.loadAll()
      const tools = devtools(loader)

      tools.lb()
      expect(out.text()).toContain('Modules')
      expect(out.text()).toContain('alpha')

      tools.ls()
      expect(out.text()).toContain('Services')
      expect(out.text()).toContain('geo.service')
    })
  })

  describe('manifest and state', () => {
    it('should return and show a manifest', () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})

      expect(devtools(loader).manifest('alpha')).toBe(manifest)
      expect(out.inspected[0].label).toBe('Manifest of alpha')
    })

    it('should report an unknown module', () => {
      expect(devtools(testLoader()).manifest('nope')).toBeUndefined()
      expect(out.errors[0].message).toContain('Unknown module: nope')
    })

    it('should tabulate the load state', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      const loaded = devtools(loader).state('alpha')

      expect(loaded?.state).toBe('active')
      expect(out.tables[0]).toMatchObject({ id: 'alpha', state: 'active' })
    })

    it('should report a module that is not loaded', () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})

      expect(devtools(loader).state('alpha')).toBeUndefined()
      expect(out.errors[0].message).toContain('not loaded')
    })
  })

  describe('load, unload, reload', () => {
    it('should load a module and wait for the cascade', async () => {
      const loader = testLoader()
      const consumer = stub(loader, 'consumer', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'provider', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', {}) }
      })
      await loader.loadModule(consumer)
      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')

      await devtools(loader).load('provider')

      // load() passes awaitCascade, so the consumer is active on return
      expect(loader.getModule('consumer')?.state).toBe('active')
      expect(out.text()).toContain('provider is active')
    })

    it('should show what a parked module waits for', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'waiting', { requires: [{ id: 'absent.service' }] })

      await devtools(loader).load(manifest.id)

      expect(out.text()).toContain('waiting is unsatisfied')
      expect(out.text()).toContain('absent.service')
    })

    it('should report a failing load instead of throwing', async () => {
      const loader = testLoader()
      const manifest: ModuleManifest = {
        id: 'broken', name: 'broken', version: '1.0.0',
        entry: 'http://localhost/broken.js', exports: {}
      }
      loader.register([manifest])

      await expect(devtools(loader).load('broken')).resolves.toBeUndefined()
      expect(out.errors[0].message).toContain('Failed to load broken')
    })

    it('should unload a module', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      await expect(devtools(loader).unload('alpha')).resolves.toBe(true)
      expect(out.text()).toContain('alpha unloaded')
    })

    it('should report unloading something that was not loaded', async () => {
      await expect(devtools(testLoader()).unload('ghost')).resolves.toBe(false)
      expect(out.text()).toContain('was not loaded')
    })

    it('should report a refused reload', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      await devtools(loader).reload('alpha')

      expect(out.errors[0].message).toContain('Failed to reload alpha')
    })
  })

  describe('disable and enable', () => {
    it('should switch a module off and show it as disabled', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      await loader.loadAll()
      const tools = devtools(loader)

      await tools.disable('alpha')
      expect(out.text()).toContain('alpha disabled')

      tools.modules()
      expect(out.text()).toContain('(disabled)')
    })

    it('should switch it on again and report the resulting state', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      await loader.loadAll()
      const tools = devtools(loader)
      await tools.disable('alpha')

      await tools.enable('alpha')

      expect(out.text()).toContain('alpha is active')
    })

    it('should report an unknown module and one that was not disabled', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      const tools = devtools(loader)

      await tools.disable('ghost')
      expect(out.errors[0].message).toContain('Unknown module: ghost')

      await tools.enable('alpha')
      expect(out.text()).toContain('was not disabled')
    })
  })

  describe('consumers', () => {
    it('should list who asked for a service and how', async () => {
      const loader = testLoader()
      stub(loader, 'map', { requires: [{ id: 'geo.service' }] })
      await loader.loadAll()

      devtools(loader).consumers('geo.service')

      expect(out.text()).toContain('map')
      expect(out.text()).toContain('[unsatisfied]')
      expect(out.text()).toContain('1..1')
      expect(out.text()).toContain('static')
    })

    it('should say when nobody declared the service', () => {
      devtools(testLoader()).consumers('nothing')

      expect(out.text()).toContain('Nobody declared nothing')
    })
  })

  describe('diagnosis', () => {
    it('should list waiting modules and what they wait for', async () => {
      const loader = testLoader()
      stub(loader, 'waiting', { requires: [{ id: 'absent.service' }] })
      await loader.loadAll()

      devtools(loader).unsatisfied()

      expect(out.text()).toContain('waiting waits for absent.service')
    })

    it('should confirm when nothing waits', () => {
      devtools(testLoader()).unsatisfied()

      expect(out.text()).toContain('Nothing is waiting')
    })

    it('should list declaration drift', async () => {
      const loader = testLoader()
      stub(loader, 'search', { provides: ['ui.search'] })
      await loader.loadAll()

      devtools(loader).mismatches()

      expect(out.text()).toContain('search declares ui.search')
    })

    it('should confirm a truthful manifest', async () => {
      const loader = testLoader()
      stub(loader, 'search', {
        provides: ['ui.search'],
        onActivate: services => { services.register('ui.search', {}) }
      })
      await loader.loadAll()

      devtools(loader).mismatches()

      expect(out.text()).toContain('Every declared service was registered')
    })
  })

  describe('services', () => {
    it('should list services with provider and scope', async () => {
      const loader = testLoader()
      stub(loader, 'provider', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', { locate: () => 'here' }) }
      })
      await loader.loadAll()

      devtools(loader).services()

      expect(out.text()).toContain('geo.service')
      expect(out.text()).toContain('provider')
      expect(out.text()).toContain('singleton')
    })

    it('should mention providers standing by', () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'a' })
      registry.register('geo.service', {}, { providedBy: 'b' })

      devtools(loader).services()

      expect(out.text()).toContain('+1 standing by')
    })

    it('should resolve a single service', () => {
      const loader = testLoader()
      const service = { locate: () => 'here' }
      loader.getServiceRegistry().register('geo.service', service)

      expect(devtools(loader).service('geo.service')).toBe(service)
      expect(out.inspected[0].label).toBe('geo.service')
    })

    it('should report an unknown service', () => {
      expect(devtools(testLoader()).service('nope')).toBeUndefined()
      expect(out.errors[0].message).toContain('No service under: nope')
    })

    it('should list providers best first, with ranking', () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('widget', {}, { providedBy: 'weak' })
      registry.register('widget', {}, { providedBy: 'strong', ranking: 10 })

      const references = devtools(loader).providers('widget')

      expect(references.map(reference => reference.providedBy)).toEqual(['strong', 'weak'])
      expect(out.text()).toContain('ranking 10')
    })

    it('should apply a target filter', () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('widget', {}, { providedBy: 'chart', properties: { kind: 'chart' } })
      registry.register('widget', {}, { providedBy: 'table', properties: { kind: 'table' } })

      const references = devtools(loader).providers('widget', '(kind=chart)')

      expect(references).toHaveLength(1)
      expect(references[0].providedBy).toBe('chart')
    })

    it('should report a service with no provider', () => {
      expect(devtools(testLoader()).providers('absent')).toEqual([])
      expect(out.text()).toContain('No provider for absent')
    })
  })

  describe('shared libraries', () => {
    it('should list what the runtime holds', () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {})
      tsmRuntime.register('devtools-vue', {}, '3.4.0', 'host')

      installDevtools({
        loader: testLoader(), target: host, output: out, runtime: tsmRuntime
      }).shared()

      expect(out.text()).toContain('devtools-vue')
      expect(out.text()).toContain('3.4.0')
      expect(out.text()).toContain('by host')
      vi.restoreAllMocks()
    })

    it('should say when no runtime was passed', () => {
      devtools(testLoader()).shared()

      expect(out.errors[0].message).toContain('needs the TSM runtime')
    })
  })

  describe('optional collaborators', () => {
    it('should explain that discovery needs a registry', async () => {
      await devtools(testLoader()).discover()

      expect(out.errors[0].message).toContain('needs a PluginRegistry')
    })

    it('should explain that resolve needs a resolver', () => {
      devtools(testLoader()).resolve()

      expect(out.errors[0].message).toContain('needs a DependencyResolver')
    })

    it('should show the load order when a resolver is present', async () => {
      const { DependencyResolver } = await import('../DependencyResolver')
      const loader = testLoader()
      stub(loader, 'core', {})
      stub(loader, 'ui', {})

      installDevtools({
        loader, target: host, output: out, resolver: new DependencyResolver()
      }).resolve()

      expect(out.text()).toContain('Load order')
    })
  })

  describe('queue', () => {
    it('should collect, show and load a selection', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      stub(loader, 'beta', {})
      const tools = devtools(loader)

      tools.add('alpha')
      tools.add('beta')
      tools.queue()
      expect(out.text()).toContain('alpha')
      expect(out.text()).toContain('beta')

      await tools.loadQueue()

      expect(loader.getModule('alpha')?.state).toBe('active')
      expect(loader.getModule('beta')?.state).toBe('active')
      tools.queue()
      expect(out.text()).toContain('Queue is empty')
    })

    it('should refuse an unknown module', () => {
      devtools(testLoader()).add('ghost')

      expect(out.errors[0].message).toContain('Unknown module: ghost')
    })

    it('should remove and clear entries', () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      const tools = devtools(loader)
      tools.add('alpha')

      tools.remove('alpha')
      expect(out.text()).toContain('removed from queue')

      tools.add('alpha')
      tools.clearQueue()
      expect(out.text()).toContain('Cleared 1 entry')
    })
  })

  describe('help', () => {
    it('should list the commands under the installed name', () => {
      installDevtools({
        loader: testLoader(), target: host, output: out, name: 'daanse'
      }).help()

      expect(out.text()).toContain('daanse.<command>()')
      expect(out.text()).toContain('unsatisfied()')
      expect(out.text()).toContain('providers(id, flt?)')
    })
  })
})

describe('installDevtools - components and configuration', () => {
  let out: CollectingOutput
  let admin: ConfigurationAdmin

  beforeEach(() => {
    resetContainers()
    out = collectingOutput()
    admin = new ConfigurationAdmin()
  })

  afterEach(() => {
  })

  function componentManifest(id: string): ModuleManifest {
    return {
      id,
      name: id,
      version: '1.0.0',
      entry: `http://localhost/${id}/remoteEntry.js`,
      exports: {}
    }
  }

  async function withComponents(): Promise<{
    loader: ModuleLoader
    tsm: ReturnType<typeof installDevtools>
  }> {
    @component({ service: ['demo.tiles'], configurationPid: 'demo.tiles' })
    class RasterTiles {
      @activate() start(): void {}
      @modified() update(): void {}
    }

    @component({ configurationPolicy: 'require' })
    class TrafficWatcher {
      @activate() start(): void {}
    }

    const loader = testLoader({ configurationAdmin: admin })
    containers.tiles = { RasterTiles, TrafficWatcher }
    await loader.loadModule(componentManifest('tiles'))

    return { loader, tsm: installDevtools({ loader, target: null, output: out }) }
  }

  describe('components', () => {
    it('should list what each component declared and where it stands', async () => {
      const { tsm } = await withComponents()

      tsm.components()

      const text = out.lines.join('\n')
      expect(text).toContain('RasterTiles')
      expect(text).toContain('immediate · demo.tiles')
      expect(text).toContain('modified')
      // The one requiring configuration says so, and says it is waiting
      expect(text).toContain('config require')
      expect(text).toContain('unsatisfied-configuration')
    })

    it('should return the declarations for further inspection', async () => {
      const { tsm } = await withComponents()

      expect(tsm.components('tiles').map(entry => entry.className))
        .toEqual(['RasterTiles', 'TrafficWatcher'])
    })

    it('should say so when a module has none', async () => {
      const { tsm } = await withComponents()

      tsm.components('nothing-here')

      expect(out.lines.join('\n')).toContain('No components in nothing-here')
    })
  })

  describe('config', () => {
    it('should list configurations with the components that read them', async () => {
      const { tsm } = await withComponents()
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      tsm.config()

      expect(out.lines.join('\n')).toContain('demo.tiles')
      expect(out.lines.join('\n')).toContain('tiles/RasterTiles')
    })

    it('should show the values of one PID', async () => {
      const { tsm } = await withComponents()
      await admin.getConfiguration('demo.tiles').update({ url: 'a' })

      tsm.config('demo.tiles')

      expect(out.inspected[0].value).toMatchObject({ url: 'a' })
    })

    it('should say when a PID has no configuration', async () => {
      const { tsm } = await withComponents()

      tsm.config('demo.unknown')

      expect(out.lines.join('\n')).toContain('No configuration for demo.unknown')
    })

    it('should set values and wait for the components to react', async () => {
      const { loader, tsm } = await withComponents()

      await tsm.configure('TrafficWatcher', { interval: 5000 })

      // configure() settles the queue, so the component has started by now
      expect(loader.getComponents('tiles')[1].configurations[0].state).toBe('active')
      expect(out.lines.join('\n')).toContain('Configured TrafficWatcher')
    })

    it('should delete a configuration and let the component stop', async () => {
      const { loader, tsm } = await withComponents()
      await tsm.configure('TrafficWatcher', { interval: 5000 })

      await tsm.unconfigure('TrafficWatcher')

      expect(loader.getComponents('tiles')[1].configurations[0].state)
        .toBe('unsatisfied-configuration')
    })

    it('should explain itself when the loader has no Configuration Admin', async () => {
      const loader = testLoader()
      const tsm = installDevtools({ loader, target: null, output: out })

      tsm.config()

      expect(out.errors[0].message).toContain('configurationAdmin')
    })
  })
})

describe('installDevtools - capabilities and wiring', () => {
  let out: CollectingOutput

  beforeEach(() => {
    resetContainers()
    out = collectingOutput()
  })

  afterEach(() => {
  })

  function withWiring(): ReturnType<typeof installDevtools> {
    const loader = testLoader()
    loader.register([
      {
        id: 'tiles', name: 'tiles', version: '1.0.0', entry: '/tiles.js', exports: {},
        provides: [{ id: 'demo.tiles' }],
        capabilities: [{ namespace: 'demo.theme', attributes: { name: 'dark' } }]
      },
      {
        id: 'map', name: 'map', version: '1.0.0', entry: '/map.js', exports: {},
        dependencies: ['tiles'], requiresService: [{ id: 'demo.tiles' }]
      },
      {
        id: 'lost', name: 'lost', version: '1.0.0', entry: '/lost.js', exports: {},
        requirements: [{ namespace: 'demo.nothing' }]
      }
    ])
    return installDevtools({ loader, target: null, output: out })
  }

  it('should list what each module offers', () => {
    withWiring().capabilities()

    const text = out.lines.join('\n')
    expect(text).toContain('osgi.identity')
    expect(text).toContain('objectClass=demo.tiles')
    expect(text).toContain('demo.theme')
  })

  it('should narrow to one namespace', () => {
    withWiring().capabilities('demo.theme')

    const text = out.lines.join('\n')
    expect(text).toContain('name=dark')
    expect(text).not.toContain('objectClass')
  })

  it('should show a module wired in both directions', () => {
    withWiring().wiring('tiles')

    const text = out.lines.join('\n')
    expect(text).toContain('provides')
    expect(text).toContain('map')
  })

  it('should name what waits in vain, and why', () => {
    withWiring().unresolved()

    const text = out.lines.join('\n')
    expect(text).toContain('lost')
    expect(text).toContain('nothing in that namespace')
  })

  it('should say so when everything resolves', () => {
    const loader = testLoader()
    loader.register([{
      id: 'alone', name: 'alone', version: '1.0.0', entry: '/a.js', exports: {}
    }])

    installDevtools({ loader, target: null, output: out }).unresolved()

    expect(out.lines.join('\n')).toContain('Every module can resolve')
  })
})
