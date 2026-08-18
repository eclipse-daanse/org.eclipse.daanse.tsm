import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { installDevtools, collectingOutput, type CollectingOutput } from '../devtools'
import { tsmRuntime } from '../TsmRuntime'
import type { ModuleContext, ModuleManifest, ObservableServiceRegistry } from '../types'

interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

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
  globalRef.window![id] = {
    activate: (context: ModuleContext) => { options.onActivate?.(context.services) }
  }
  loader.register([manifest])
  return manifest
}

describe('installDevtools', () => {
  let savedWindow: Record<string, unknown> | undefined
  let out: CollectingOutput
  let host: Record<string, unknown>

  beforeEach(() => {
    savedWindow = globalRef.window
    globalRef.window = {}
    out = collectingOutput()
    host = {}
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  function devtools(loader: ModuleLoader) {
    return installDevtools({ loader, target: host, output: out })
  }

  describe('installation', () => {
    it('should install itself on the target under a default name', () => {
      const tools = devtools(new ModuleLoader())

      expect(host.tsm).toBe(tools)
      expect(out.text()).toContain('tsm.help()')
    })

    it('should honour a custom name', () => {
      const tools = installDevtools({
        loader: new ModuleLoader(), target: host, output: out, name: 'daanse'
      })

      expect(host.daanse).toBe(tools)
      expect(host.tsm).toBeUndefined()
    })

    it('should install nowhere when the target is null', () => {
      const tools = installDevtools({ loader: new ModuleLoader(), target: null, output: out })

      expect(host).toEqual({})
      expect(tools.modules).toBeTypeOf('function')
    })

    it('should remove itself again', () => {
      const tools = devtools(new ModuleLoader())

      tools.uninstall()

      expect(host.tsm).toBeUndefined()
    })

    it('should expose the objects behind the commands', () => {
      const loader = new ModuleLoader()
      const tools = devtools(loader)

      expect(tools.raw.loader).toBe(loader)
      expect(tools.raw.services).toBe(loader.getServiceRegistry())
    })
  })

  describe('modules', () => {
    it('should list registered modules with their state', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
      stub(loader, 'alpha', {})

      devtools(loader).modules()

      expect(out.text()).toContain('[not loaded]')
    })

    it('should say when nothing is registered', () => {
      devtools(new ModuleLoader()).modules()

      expect(out.text()).toContain('No modules registered')
    })
  })

  describe('manifest and state', () => {
    it('should return and show a manifest', () => {
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'alpha', {})

      expect(devtools(loader).manifest('alpha')).toBe(manifest)
      expect(out.inspected[0].label).toBe('Manifest of alpha')
    })

    it('should report an unknown module', () => {
      expect(devtools(new ModuleLoader()).manifest('nope')).toBeUndefined()
      expect(out.errors[0].message).toContain('Unknown module: nope')
    })

    it('should tabulate the load state', async () => {
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      const loaded = devtools(loader).state('alpha')

      expect(loaded?.state).toBe('active')
      expect(out.tables[0]).toMatchObject({ id: 'alpha', state: 'active' })
    })

    it('should report a module that is not loaded', () => {
      const loader = new ModuleLoader()
      stub(loader, 'alpha', {})

      expect(devtools(loader).state('alpha')).toBeUndefined()
      expect(out.errors[0].message).toContain('not loaded')
    })
  })

  describe('load, unload, reload', () => {
    it('should load a module and wait for the cascade', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'waiting', { requires: [{ id: 'absent.service' }] })

      await devtools(loader).load(manifest.id)

      expect(out.text()).toContain('waiting is unsatisfied')
      expect(out.text()).toContain('absent.service')
    })

    it('should report a failing load instead of throwing', async () => {
      const loader = new ModuleLoader()
      const manifest: ModuleManifest = {
        id: 'broken', name: 'broken', version: '1.0.0',
        entry: 'http://localhost/broken.js', exports: {}
      }
      loader.register([manifest])

      await expect(devtools(loader).load('broken')).resolves.toBeUndefined()
      expect(out.errors[0].message).toContain('Failed to load broken')
    })

    it('should unload a module', async () => {
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      await expect(devtools(loader).unload('alpha')).resolves.toBe(true)
      expect(out.text()).toContain('alpha unloaded')
    })

    it('should report unloading something that was not loaded', async () => {
      await expect(devtools(new ModuleLoader()).unload('ghost')).resolves.toBe(false)
      expect(out.text()).toContain('was not loaded')
    })

    it('should report a refused reload', async () => {
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadModule(manifest)

      await devtools(loader).reload('alpha')

      expect(out.errors[0].message).toContain('Failed to reload alpha')
    })
  })

  describe('diagnosis', () => {
    it('should list waiting modules and what they wait for', async () => {
      const loader = new ModuleLoader()
      stub(loader, 'waiting', { requires: [{ id: 'absent.service' }] })
      await loader.loadAll()

      devtools(loader).unsatisfied()

      expect(out.text()).toContain('waiting waits for absent.service')
    })

    it('should confirm when nothing waits', () => {
      devtools(new ModuleLoader()).unsatisfied()

      expect(out.text()).toContain('Nothing is waiting')
    })

    it('should list declaration drift', async () => {
      const loader = new ModuleLoader()
      stub(loader, 'search', { provides: ['ui.search'] })
      await loader.loadAll()

      devtools(loader).mismatches()

      expect(out.text()).toContain('search declares ui.search')
    })

    it('should confirm a truthful manifest', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {}, { providedBy: 'a' })
      registry.register('geo.service', {}, { providedBy: 'b' })

      devtools(loader).services()

      expect(out.text()).toContain('+1 standing by')
    })

    it('should resolve a single service', () => {
      const loader = new ModuleLoader()
      const service = { locate: () => 'here' }
      loader.getServiceRegistry().register('geo.service', service)

      expect(devtools(loader).service('geo.service')).toBe(service)
      expect(out.inspected[0].label).toBe('geo.service')
    })

    it('should report an unknown service', () => {
      expect(devtools(new ModuleLoader()).service('nope')).toBeUndefined()
      expect(out.errors[0].message).toContain('No service under: nope')
    })

    it('should list providers best first, with ranking', () => {
      const loader = new ModuleLoader()
      const registry = loader.getServiceRegistry()
      registry.register('widget', {}, { providedBy: 'weak' })
      registry.register('widget', {}, { providedBy: 'strong', ranking: 10 })

      const references = devtools(loader).providers('widget')

      expect(references.map(reference => reference.providedBy)).toEqual(['strong', 'weak'])
      expect(out.text()).toContain('ranking 10')
    })

    it('should apply a target filter', () => {
      const loader = new ModuleLoader()
      const registry = loader.getServiceRegistry()
      registry.register('widget', {}, { providedBy: 'chart', properties: { kind: 'chart' } })
      registry.register('widget', {}, { providedBy: 'table', properties: { kind: 'table' } })

      const references = devtools(loader).providers('widget', '(kind=chart)')

      expect(references).toHaveLength(1)
      expect(references[0].providedBy).toBe('chart')
    })

    it('should report a service with no provider', () => {
      expect(devtools(new ModuleLoader()).providers('absent')).toEqual([])
      expect(out.text()).toContain('No provider for absent')
    })
  })

  describe('shared libraries', () => {
    it('should list what the runtime holds', () => {
      vi.spyOn(console, 'debug').mockImplementation(() => {})
      tsmRuntime.register('devtools-vue', {}, '3.4.0', 'host')

      installDevtools({
        loader: new ModuleLoader(), target: host, output: out, runtime: tsmRuntime
      }).shared()

      expect(out.text()).toContain('devtools-vue')
      expect(out.text()).toContain('3.4.0')
      expect(out.text()).toContain('by host')
      vi.restoreAllMocks()
    })

    it('should say when no runtime was passed', () => {
      devtools(new ModuleLoader()).shared()

      expect(out.errors[0].message).toContain('needs the TSM runtime')
    })
  })

  describe('optional collaborators', () => {
    it('should explain that discovery needs a registry', async () => {
      await devtools(new ModuleLoader()).discover()

      expect(out.errors[0].message).toContain('needs a PluginRegistry')
    })

    it('should explain that resolve needs a resolver', () => {
      devtools(new ModuleLoader()).resolve()

      expect(out.errors[0].message).toContain('needs a DependencyResolver')
    })

    it('should show the load order when a resolver is present', async () => {
      const { DependencyResolver } = await import('../DependencyResolver')
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      devtools(new ModuleLoader()).add('ghost')

      expect(out.errors[0].message).toContain('Unknown module: ghost')
    })

    it('should remove and clear entries', () => {
      const loader = new ModuleLoader()
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
        loader: new ModuleLoader(), target: host, output: out, name: 'daanse'
      }).help()

      expect(out.text()).toContain('daanse.<command>()')
      expect(out.text()).toContain('unsatisfied()')
      expect(out.text()).toContain('providers(id, flt?)')
    })
  })
})
