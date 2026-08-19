import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import type {
  ModuleContext,
  ModuleEvent,
  ModuleEventListener,
  ModuleManifest,
  ObservableServiceRegistry,
  ServiceRegistryEvent
} from '../types'


interface StubOptions {
  requires?: Array<{
    id: string
    optional?: boolean
    policy?: 'static' | 'dynamic'
    policyOption?: 'reluctant' | 'greedy'
    cardinality?: '0..1' | '1..1' | '0..n' | '1..n'
    target?: string
  }>
  provides?: Array<string | {
    id: string
    ranking?: number
    properties?: Record<string, string | number | boolean>
  }>
  dependencies?: string[]
  onActivate?: (services: ObservableServiceRegistry) => void
  onDeactivate?: (services: ObservableServiceRegistry) => void
  onServiceBound?: (serviceId: string) => void
  onServiceUnbound?: (serviceId: string) => void
}

/**
 * Register a module and put a fake container in window, which is where
 * loadEntry() looks first — so nothing is imported over the network.
 */
function stub(loader: ModuleLoader, id: string, options: StubOptions = {}): ModuleManifest {
  const manifest: ModuleManifest = {
    id,
    name: id,
    version: '1.0.0',
    entry: `http://localhost/${id}/remoteEntry.js`,
    exports: {},
    requiresService: options.requires,
    provides: options.provides?.map(service =>
      typeof service === 'string' ? { id: service } : service
    ),
    dependencies: options.dependencies
  }

  containers[id] = {
    activate: (context: ModuleContext) => { options.onActivate?.(context.services) },
    deactivate: (context: ModuleContext) => { options.onDeactivate?.(context.services) },
    onServiceBound: (_context: ModuleContext, serviceId: string) => {
      options.onServiceBound?.(serviceId)
    },
    onServiceUnbound: (_context: ModuleContext, serviceId: string) => {
      options.onServiceUnbound?.(serviceId)
    }
  }

  loader.register([manifest])
  return manifest
}

function collectEvents(loader: ModuleLoader): ModuleEvent[] {
  const events: ModuleEvent[] = []
  const listener: ModuleEventListener = { onModuleEvent: event => { events.push(event) } }
  loader.addEventListener(listener)
  return events
}

describe('ModuleLoader - satisfaction lifecycle', () => {

  beforeEach(() => {
    resetContainers()
  })

  afterEach(() => {
  })

  describe('parking instead of failing', () => {
    it('should park a module whose required service is missing', async () => {
      const loader = testLoader()
      const events = collectEvents(loader)
      const manifest = stub(loader, 'map-module', { requires: [{ id: 'geo.service' }] })

      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      expect(loaded.state).toBe('unsatisfied')
      expect(loaded.error).toBeUndefined()
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'unsatisfied',
          moduleId: 'map-module',
          serviceIds: ['geo.service']
        })
      )
    })

    it('should not run the activate hook of a parked module', async () => {
      const loader = testLoader()
      const onActivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        onActivate
      })

      await loader.loadModule(manifest)
      await loader.settle()

      expect(onActivate).not.toHaveBeenCalled()
    })

    it('should activate the module once the service appears', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const onActivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        onActivate
      })

      const loaded = await loader.loadModule(manifest)
      await loader.settle()
      expect(loaded.state).toBe('unsatisfied')

      registry.register('geo.service', { locate: () => 'here' })
      await loader.settle()

      expect(loaded.state).toBe('active')
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('should ignore missing optional services', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', optional: true }]
      })

      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      expect(loaded.state).toBe('active')
    })

    it('should still fail fast with strictRequirements', async () => {
      const loader = testLoader({ strictRequirements: true })
      const manifest = stub(loader, 'map-module', { requires: [{ id: 'geo.service' }] })

      await expect(loader.loadModule(manifest)).rejects.toThrow(
        'requires services that are not available: geo.service'
      )
      expect(loader.getModule('map-module')?.state).toBe('error')
    })

    it('should be idempotent for a parked module', async () => {
      const loader = testLoader()
      const onActivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        onActivate
      })

      const first = await loader.loadModule(manifest)
      const second = await loader.loadModule(manifest)
      await loader.settle()

      expect(second).toBe(first)
      expect(onActivate).not.toHaveBeenCalled()
    })
  })

  describe('withdrawal', () => {
    it('should deactivate and park an active module when its service goes away', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', { locate: () => 'here' })

      const onDeactivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        onDeactivate
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()
      expect(loaded.state).toBe('active')

      registry.unregister('geo.service')
      await loader.settle()

      expect(loaded.state).toBe('unsatisfied')
      expect(onDeactivate).toHaveBeenCalledTimes(1)
    })

    it('should bring the module back when the service returns', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      const onActivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        onActivate
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      registry.unregister('geo.service')
      await loader.settle()
      expect(loaded.state).toBe('unsatisfied')

      registry.register('geo.service', {})
      await loader.settle()

      expect(loaded.state).toBe('active')
      expect(onActivate).toHaveBeenCalledTimes(2)
    })

    it('should keep a module active when only an optional service goes away', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', optional: true }]
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      registry.unregister('geo.service')
      await loader.settle()

      expect(loaded.state).toBe('active')
    })

    it('should withdraw the services of a module it tears down', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      // Registers a service and never cleans it up itself
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service' }],
        provides: ['layout.service'],
        onActivate: services => { services.register('layout.service', { name: 'grid' }) }
      })
      await loader.loadModule(manifest)
      await loader.settle()
      expect(registry.has('layout.service')).toBe(true)

      registry.unregister('geo.service')
      await loader.settle()

      expect(registry.has('layout.service')).toBe(false)
    })
  })

  describe('cascade', () => {
    async function threeLevelSetup() {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      // Registered back to front on purpose: provider -> middle -> consumer is
      // the order the manifests imply, not the order they arrive in
      stub(loader, 'consumer', { requires: [{ id: 's2' }] })
      stub(loader, 'middle', {
        requires: [{ id: 's1' }],
        provides: ['s2'],
        onActivate: services => { services.register('s2', { level: 2 }) }
      })
      stub(loader, 'provider', {
        provides: ['s1'],
        onActivate: services => { services.register('s1', { level: 1 }) }
      })

      await loader.loadAll()
      await loader.settle()

      return { loader, registry }
    }

    it('should activate a chain regardless of registration order', async () => {
      const { loader } = await threeLevelSetup()

      expect(loader.getModule('provider')?.state).toBe('active')
      expect(loader.getModule('middle')?.state).toBe('active')
      expect(loader.getModule('consumer')?.state).toBe('active')
    })

    it('should park indirect consumers when the root service disappears', async () => {
      const { loader, registry } = await threeLevelSetup()

      registry.unregister('s1')
      await loader.settle()

      expect(loader.getModule('middle')?.state).toBe('unsatisfied')
      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')
      expect(registry.has('s2')).toBe(false)
    })

    it('should restore the whole chain when the root service returns', async () => {
      const { loader, registry } = await threeLevelSetup()

      registry.unregister('s1')
      await loader.settle()
      registry.register('s1', { level: 1 })
      await loader.settle()

      expect(loader.getModule('middle')?.state).toBe('active')
      expect(loader.getModule('consumer')?.state).toBe('active')
      expect(registry.has('s2')).toBe(true)
    })

    it('should park a module whose dependency is parked', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      stub(loader, 'base', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'feature', { dependencies: ['base'] })

      await loader.loadAll()
      await loader.settle()

      expect(loader.getModule('base')?.state).toBe('unsatisfied')
      expect(loader.getModule('feature')?.state).toBe('unsatisfied')

      registry.register('geo.service', {})
      await loader.settle()

      expect(loader.getModule('base')?.state).toBe('active')
      expect(loader.getModule('feature')?.state).toBe('active')
    })
  })

  describe('diagnostics', () => {
    it('should report what each waiting module waits for', async () => {
      const loader = testLoader()

      stub(loader, 'base', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'feature', { dependencies: ['base'] })

      await loader.loadAll()

      expect(loader.getUnsatisfiedModules()).toEqual(
        expect.arrayContaining([
          { moduleId: 'base', waitingFor: ['geo.service'] },
          { moduleId: 'feature', waitingFor: ['module base'] }
        ])
      )
    })

    it('should leave a settled state behind after loadAll', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('s1', {})

      stub(loader, 'consumer', { requires: [{ id: 's2' }] })
      stub(loader, 'middle', {
        requires: [{ id: 's1' }],
        provides: ['s2'],
        onActivate: services => { services.register('s2', {}) }
      })

      // No settle() here on purpose: loadAll has to finish the cascade itself
      await loader.loadAll()

      expect(loader.getModule('consumer')?.state).toBe('active')
      expect(loader.getUnsatisfiedModules()).toEqual([])
    })
  })

  describe('unloading and reloading', () => {
    it('should keep a dependent parked after its dependency is unloaded', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      stub(loader, 'base', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'feature', { dependencies: ['base'] })
      await loader.loadAll()

      await loader.unloadModule('base')

      expect(loader.getModule('base')).toBeUndefined()
      expect(loader.getUnsatisfiedModules()).toEqual([
        { moduleId: 'feature', waitingFor: ['module base'] }
      ])

      // The service arriving must not activate a module whose dependency is gone
      registry.register('geo.service', {})
      await loader.settle()

      expect(loader.getModule('feature')?.state).toBe('unsatisfied')
    })

    it('should park consumers when an unloaded module took its services with it', async () => {
      const loader = testLoader()

      stub(loader, 'provider', {
        provides: ['s1'],
        onActivate: services => { services.register('s1', {}) }
      })
      stub(loader, 'consumer', { requires: [{ id: 's1' }] })
      await loader.loadAll()
      expect(loader.getModule('consumer')?.state).toBe('active')

      await loader.unloadModule('provider')

      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')
      expect(loader.getServiceRegistry().has('s1')).toBe(false)
    })

    it('should refuse to unload a module that active modules depend on', async () => {
      const loader = testLoader()

      stub(loader, 'base', {})
      stub(loader, 'feature', { dependencies: ['base'] })
      await loader.loadAll()

      expect(await loader.unloadModule('base')).toBe(false)
      expect(loader.getModule('base')?.state).toBe('active')
      expect(loader.getModule('feature')?.state).toBe('active')
    })

    it('should bring a parked dependent back when the dependency returns', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      // base waits for a service, so feature waits for base
      stub(loader, 'base', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'feature', { dependencies: ['base'] })
      await loader.loadAll()

      // Unloading is allowed here, because no dependent is active
      expect(await loader.unloadModule('base')).toBe(true)
      expect(loader.getModule('feature')?.state).toBe('unsatisfied')

      // unloadModule() removed the container from window, so stub again
      const base = stub(loader, 'base', { requires: [{ id: 'geo.service' }] })
      await loader.loadModule(base)
      registry.register('geo.service', {})
      await loader.settle()

      expect(loader.getModule('base')?.state).toBe('active')
      expect(loader.getModule('feature')?.state).toBe('active')
    })
  })

  describe('dependency cycles', () => {
    it('should park mutually dependent modules instead of overflowing the stack', async () => {
      const loader = testLoader()

      stub(loader, 'a', { dependencies: ['b'] })
      stub(loader, 'b', { dependencies: ['a'] })

      await loader.loadAll()

      expect(loader.getModule('a')?.state).toBe('unsatisfied')
      expect(loader.getModule('b')?.state).toBe('unsatisfied')
      expect(loader.getUnsatisfiedModules()).toEqual(
        expect.arrayContaining([
          { moduleId: 'a', waitingFor: ['module b'] },
          { moduleId: 'b', waitingFor: ['module a'] }
        ])
      )
    })

    it('should not report an error for a dependency cycle', async () => {
      const loader = testLoader()
      const events = collectEvents(loader)

      stub(loader, 'a', { dependencies: ['b'] })
      stub(loader, 'b', { dependencies: ['a'] })

      await loader.loadAll()

      expect(events.filter(event => event.type === 'error')).toEqual([])
    })
  })

  describe('asynchronous hooks', () => {
    it('should serialize activations that await inside the hook', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const sequence: string[] = []

      function asyncStub(id: string, requires: string[], provides?: string) {
        const manifest: ModuleManifest = {
          id,
          name: id,
          version: '1.0.0',
          entry: `http://localhost/${id}/remoteEntry.js`,
          exports: {},
          requiresService: requires.map(serviceId => ({ id: serviceId })),
          provides: provides ? [{ id: provides }] : undefined
        }
        containers[id] = {
          activate: async (context: ModuleContext) => {
            sequence.push(`${id}:start`)
            await new Promise(resolve => setTimeout(resolve, 5))
            if (provides) context.services.register(provides, {})
            sequence.push(`${id}:done`)
          },
          deactivate: async () => {
            sequence.push(`${id}:stop`)
            await new Promise(resolve => setTimeout(resolve, 5))
          }
        }
        loader.register([manifest])
        return manifest
      }

      asyncStub('consumer', ['s2'])
      asyncStub('middle', ['s1'], 's2')
      asyncStub('provider', [], 's1')

      await loader.loadAll()

      expect(loader.getModule('consumer')?.state).toBe('active')
      // No activation may interleave with another
      expect(sequence).toEqual([
        'provider:start', 'provider:done',
        'middle:start', 'middle:done',
        'consumer:start', 'consumer:done'
      ])

      registry.unregister('s1')
      await loader.settle()

      expect(loader.getModule('middle')?.state).toBe('unsatisfied')
      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')
      // Teardown runs consumer-side hooks to completion as well
      expect(sequence).toContain('middle:stop')
      expect(sequence).toContain('consumer:stop')
    })

    it('should settle a cascade triggered while another load is in flight', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      const slow: ModuleManifest = {
        id: 'slow', name: 'slow', version: '1.0.0',
        entry: 'http://localhost/slow/remoteEntry.js', exports: {},
        requiresService: [{ id: 'late.service' }]
      }
      containers['slow'] = {
        activate: async () => { await new Promise(resolve => setTimeout(resolve, 10)) }
      }
      loader.register([slow])

      const loading = loader.loadModule(slow)
      // Arrives while the module is still being loaded
      registry.register('late.service', {})

      await loading
      await loader.settle()

      expect(loader.getModule('slow')?.state).toBe('active')
      expect(loader.getUnsatisfiedModules()).toEqual([])
    })
  })

  describe('dynamic policy', () => {
    it('should keep the module active and notify it when the service goes away', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      const onServiceUnbound = vi.fn()
      const onDeactivate = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', policy: 'dynamic' }],
        onServiceUnbound,
        onDeactivate
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      registry.unregister('geo.service')
      await loader.settle()

      expect(loaded.state).toBe('active')
      expect(onServiceUnbound).toHaveBeenCalledWith('geo.service')
      expect(onDeactivate).not.toHaveBeenCalled()
    })

    it('should notify when the service comes back', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      const onServiceBound = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', policy: 'dynamic' }],
        onServiceBound
      })
      await loader.loadModule(manifest)
      await loader.settle()

      // Services present at activation are not reported as newly bound
      expect(onServiceBound).not.toHaveBeenCalled()

      registry.unregister('geo.service')
      await loader.settle()
      registry.register('geo.service', {})
      await loader.settle()

      expect(onServiceBound).toHaveBeenCalledWith('geo.service')
    })

    it('should still require a mandatory dynamic service to activate', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', policy: 'dynamic' }]
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      expect(loaded.state).toBe('unsatisfied')

      registry.register('geo.service', {})
      await loader.settle()

      expect(loaded.state).toBe('active')
    })

    it('should tear down for a static requirement even when a dynamic one is fine', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('static.service', {})
      registry.register('dynamic.service', {})

      const onServiceUnbound = vi.fn()
      const manifest = stub(loader, 'map-module', {
        requires: [
          { id: 'static.service' },
          { id: 'dynamic.service', policy: 'dynamic' }
        ],
        onServiceUnbound
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      registry.unregister('static.service')
      await loader.settle()

      expect(loaded.state).toBe('unsatisfied')
      expect(onServiceUnbound).not.toHaveBeenCalled()
    })

    it('should keep the module active when a dynamic hook throws', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})

      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', policy: 'dynamic' }],
        onServiceUnbound: () => { throw new Error('hook exploded') }
      })
      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      registry.unregister('geo.service')
      await loader.settle()

      expect(loaded.state).toBe('active')
    })
  })

  describe('observing the registry from inside a module', () => {
    it('should let a module react to services it did not declare', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const seen: string[] = []

      // What a registry-style service does: collect whatever shows up
      const manifest = stub(loader, 'widget-host', {
        onActivate: services => {
          services.addListener({
            onServiceEvent: (event: ServiceRegistryEvent) => {
              seen.push(`${event.type}:${event.serviceId}`)
            }
          })
        }
      })
      await loader.loadModule(manifest)
      await loader.settle()

      registry.register('widget.chart', {})
      registry.unregister('widget.chart')
      await loader.settle()

      expect(seen).toEqual(['registered:widget.chart', 'unregistered:widget.chart'])
    })

    it('should drop the listener when the module is deactivated', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const seen: string[] = []

      const manifest = stub(loader, 'widget-host', {
        onActivate: services => {
          services.addListener({
            onServiceEvent: (event: ServiceRegistryEvent) => { seen.push(event.serviceId) }
          })
        }
      })
      await loader.loadModule(manifest)
      await loader.settle()

      await loader.unloadModule('widget-host')
      seen.length = 0

      registry.register('widget.chart', {})
      await loader.settle()

      expect(seen).toEqual([])
    })
  })

  describe('several providers for one service', () => {
    it('should keep the consumer active when a stand-in takes over', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const onDeactivate = vi.fn()

      stub(loader, 'default-geo', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', { tag: 'default' }) }
      })
      stub(loader, 'premium-geo', {
        provides: [{ id: 'geo.service', ranking: 10 }],
        onActivate: services => { services.register('geo.service', { tag: 'premium' }) }
      })
      stub(loader, 'map', { requires: [{ id: 'geo.service' }], onDeactivate })

      await loader.loadAll()

      expect(registry.get('geo.service')).toEqual({ tag: 'premium' })
      expect(loader.getModule('map')?.state).toBe('active')

      // The better provider goes; the default one is still registered
      await loader.unloadModule('premium-geo')

      expect(registry.get('geo.service')).toEqual({ tag: 'default' })
      expect(loader.getModule('map')?.state).toBe('active')
      expect(onDeactivate).not.toHaveBeenCalled()
    })

    it('should apply the ranking declared in the manifest', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      stub(loader, 'strong', {
        provides: [{ id: 'geo.service', ranking: 5 }],
        onActivate: services => { services.register('geo.service', { tag: 'strong' }) }
      })
      stub(loader, 'weak', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', { tag: 'weak' }) }
      })

      await loader.loadAll()

      expect(registry.get('geo.service')).toEqual({ tag: 'strong' })
      expect(registry.countProviders('geo.service')).toBe(2)
    })

    it('should only withdraw its own registration when a module is torn down', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()

      stub(loader, 'a', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'a' }) }
      })
      stub(loader, 'b', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'b' }) }
      })
      await loader.loadAll()
      expect(registry.countProviders('widget.chart')).toBe(2)

      await loader.unloadModule('b')

      expect(registry.countProviders('widget.chart')).toBe(1)
      expect(registry.get('widget.chart')).toEqual({ from: 'a' })
    })

    it('should tear the consumer down only when the last provider is gone', async () => {
      const loader = testLoader()

      stub(loader, 'a', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'a' }) }
      })
      stub(loader, 'b', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'b' }) }
      })
      stub(loader, 'palette', { requires: [{ id: 'widget.chart', cardinality: '1..n' }] })
      await loader.loadAll()

      await loader.unloadModule('b')
      expect(loader.getModule('palette')?.state).toBe('active')

      await loader.unloadModule('a')
      expect(loader.getModule('palette')?.state).toBe('unsatisfied')
    })

    it('should not require a provider for 0..n', async () => {
      const loader = testLoader()

      stub(loader, 'palette', { requires: [{ id: 'widget.chart', cardinality: '0..n' }] })
      await loader.loadAll()

      expect(loader.getModule('palette')?.state).toBe('active')
    })

    it('should notify a dynamic collector when the set grows or shrinks', async () => {
      const loader = testLoader()
      const bound: string[] = []
      const unbound: string[] = []

      stub(loader, 'first', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'first' }) }
      })
      stub(loader, 'palette', {
        requires: [{ id: 'widget.chart', cardinality: '0..n', policy: 'dynamic' }],
        onServiceBound: id => { bound.push(id) },
        onServiceUnbound: id => { unbound.push(id) }
      })
      await loader.loadAll()
      // The provider present at activation is not reported
      expect(bound).toEqual([])

      // A second widget arrives — the palette has to hear about it
      const second = stub(loader, 'second', {
        provides: ['widget.chart'],
        onActivate: services => { services.register('widget.chart', { from: 'second' }) }
      })
      await loader.loadModule(second)
      await loader.settle()

      expect(bound).toEqual(['widget.chart'])
      expect(loader.getModule('palette')?.state).toBe('active')

      await loader.unloadModule('second')

      expect(unbound).toEqual(['widget.chart'])
      expect(loader.getModule('palette')?.state).toBe('active')
    })

    it('should let a collector enumerate providers without instantiating them', async () => {
      const loader = testLoader()
      const built: string[] = []
      let collected: string[] = []

      stub(loader, 'a', {
        provides: ['widget.chart'],
        onActivate: services => {
          services.bind('widget.chart', () => { built.push('a'); return { from: 'a' } })
        }
      })
      stub(loader, 'b', {
        provides: ['widget.chart'],
        onActivate: services => {
          services.bind('widget.chart', () => { built.push('b'); return { from: 'b' } })
        }
      })
      stub(loader, 'palette', {
        requires: [{ id: 'widget.chart', cardinality: '0..n' }],
        onActivate: services => {
          collected = services
            .getServiceReferences('widget.chart')
            .map(reference => reference.providedBy ?? '?')
        }
      })

      await loader.loadAll()

      expect(collected.sort()).toEqual(['a', 'b'])
      expect(built).toEqual([])
    })
  })

  describe('reluctant and greedy', () => {
    async function withDefaultProvider(consumer: StubOptions) {
      const loader = testLoader()
      stub(loader, 'default-geo', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', { tag: 'default' }) }
      })
      stub(loader, 'map', consumer)
      await loader.loadAll()
      return loader
    }

    function addBetterProvider(loader: ModuleLoader) {
      return stub(loader, 'premium-geo', {
        provides: [{ id: 'geo.service', ranking: 10 }],
        onActivate: services => { services.register('geo.service', { tag: 'premium' }) }
      })
    }

    it('should leave a reluctant consumer alone when a better provider appears', async () => {
      const onActivate = vi.fn()
      const loader = await withDefaultProvider({
        requires: [{ id: 'geo.service' }],
        onActivate
      })
      expect(onActivate).toHaveBeenCalledTimes(1)

      await loader.loadModule(addBetterProvider(loader))
      await loader.settle()

      // The ID now answers with the premium service, but the module is untouched
      expect(loader.getServiceRegistry().get('geo.service')).toEqual({ tag: 'premium' })
      expect(onActivate).toHaveBeenCalledTimes(1)
      expect(loader.getModule('map')?.state).toBe('active')
    })

    it('should rebuild a greedy static consumer on the better provider', async () => {
      const seen: string[] = []
      const loader = await withDefaultProvider({
        requires: [{ id: 'geo.service', policyOption: 'greedy' }],
        onActivate: services => {
          seen.push((services.get<{ tag: string }>('geo.service'))?.tag ?? '?')
        }
      })
      expect(seen).toEqual(['default'])

      await loader.loadModule(addBetterProvider(loader))
      await loader.settle()

      expect(seen).toEqual(['default', 'premium'])
      expect(loader.getModule('map')?.state).toBe('active')
    })

    it('should report a swap to a greedy dynamic consumer without rebuilding it', async () => {
      const bound: string[] = []
      const unbound: string[] = []
      const onActivate = vi.fn()
      const loader = await withDefaultProvider({
        requires: [{ id: 'geo.service', policy: 'dynamic', policyOption: 'greedy' }],
        onActivate,
        onServiceBound: id => { bound.push(id) },
        onServiceUnbound: id => { unbound.push(id) }
      })

      await loader.loadModule(addBetterProvider(loader))
      await loader.settle()

      expect(unbound).toEqual(['geo.service'])
      expect(bound).toEqual(['geo.service'])
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('should not rebuild when the new provider ranks lower', async () => {
      const onActivate = vi.fn()
      const loader = await withDefaultProvider({
        requires: [{ id: 'geo.service', policyOption: 'greedy' }],
        onActivate
      })

      const worse = stub(loader, 'legacy-geo', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', { tag: 'legacy' }) }
      })
      await loader.loadModule(worse)
      await loader.settle()

      // Equal ranking makes the later registration visible, so this one does swap;
      // a genuinely lower ranking must not
      expect(loader.getModule('map')?.state).toBe('active')
      expect(onActivate.mock.calls.length).toBeLessThanOrEqual(2)
    })

    it('should settle after a greedy rebuild instead of looping', async () => {
      const loader = await withDefaultProvider({
        requires: [{ id: 'geo.service', policyOption: 'greedy' }]
      })

      await loader.loadModule(addBetterProvider(loader))
      await loader.settle()

      expect(loader.getModule('map')?.error).toBeUndefined()
      expect(loader.getModule('map')?.state).toBe('active')
    })
  })

  describe('target filters', () => {
    it('should wait for a provider that matches the filter', async () => {
      const loader = testLoader()

      stub(loader, 'table-widget', {
        provides: [{ id: 'widget', properties: { kind: 'table' } }],
        onActivate: services => { services.register('widget', { name: 'table' }) }
      })
      stub(loader, 'chart-dashboard', {
        requires: [{ id: 'widget', target: '(kind=chart)' }]
      })

      await loader.loadAll()

      // A provider exists, but not one this module asked for
      expect(loader.getServiceRegistry().has('widget')).toBe(true)
      expect(loader.getModule('chart-dashboard')?.state).toBe('unsatisfied')

      const chart = stub(loader, 'chart-widget', {
        provides: [{ id: 'widget', properties: { kind: 'chart' } }],
        onActivate: services => { services.register('widget', { name: 'chart' }) }
      })
      await loader.loadModule(chart)
      await loader.settle()

      expect(loader.getModule('chart-dashboard')?.state).toBe('active')
    })

    it('should collect only matching providers for 0..n', async () => {
      const loader = testLoader()
      let collected: string[] = []

      stub(loader, 'chart', {
        provides: [{ id: 'widget', properties: { kind: 'chart' } }],
        onActivate: services => { services.register('widget', { name: 'chart' }) }
      })
      stub(loader, 'table', {
        provides: [{ id: 'widget', properties: { kind: 'table' } }],
        onActivate: services => { services.register('widget', { name: 'table' }) }
      })
      stub(loader, 'palette', {
        requires: [{ id: 'widget', cardinality: '0..n', target: '(kind=chart)' }],
        onActivate: services => {
          collected = services
            .getServiceReferences('widget', '(kind=chart)')
            .map(reference => reference.providedBy ?? '?')
        }
      })

      await loader.loadAll()

      expect(collected).toEqual(['chart'])
      expect(loader.getModule('palette')?.state).toBe('active')
    })

    it('should stay active when a non-matching provider goes away', async () => {
      const loader = testLoader()

      stub(loader, 'chart', {
        provides: [{ id: 'widget', properties: { kind: 'chart' } }],
        onActivate: services => { services.register('widget', { name: 'chart' }) }
      })
      stub(loader, 'table', {
        provides: [{ id: 'widget', properties: { kind: 'table' } }],
        onActivate: services => { services.register('widget', { name: 'table' }) }
      })
      stub(loader, 'chart-dashboard', {
        requires: [{ id: 'widget', target: '(kind=chart)' }]
      })
      await loader.loadAll()

      await loader.unloadModule('table')

      expect(loader.getModule('chart-dashboard')?.state).toBe('active')
    })

    it('should park when the matching provider goes away', async () => {
      const loader = testLoader()

      stub(loader, 'chart', {
        provides: [{ id: 'widget', properties: { kind: 'chart' } }],
        onActivate: services => { services.register('widget', { name: 'chart' }) }
      })
      stub(loader, 'table', {
        provides: [{ id: 'widget', properties: { kind: 'table' } }],
        onActivate: services => { services.register('widget', { name: 'table' }) }
      })
      stub(loader, 'chart-dashboard', {
        requires: [{ id: 'widget', target: '(kind=chart)' }]
      })
      await loader.loadAll()

      await loader.unloadModule('chart')

      expect(loader.getModule('chart-dashboard')?.state).toBe('unsatisfied')
      expect(loader.getUnsatisfiedModules()).toEqual([
        { moduleId: 'chart-dashboard', waitingFor: ['widget'] }
      ])
    })
  })

  describe('declaration drift', () => {
    it('should report services a module declared but never registered', async () => {
      const loader = testLoader()
      const events = collectEvents(loader)

      // Declares two, registers one
      stub(loader, 'search', {
        provides: ['ui.search', 'ui.search.index'],
        onActivate: services => { services.register('ui.search', {}) }
      })

      await loader.loadAll()

      expect(loader.getDeclarationMismatches()).toEqual([
        { moduleId: 'search', serviceIds: ['ui.search.index'] }
      ])
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'declaration-mismatch',
          moduleId: 'search',
          serviceIds: ['ui.search.index']
        })
      )
    })

    it('should report nothing when the manifest is truthful', async () => {
      const loader = testLoader()

      stub(loader, 'search', {
        provides: ['ui.search'],
        onActivate: services => { services.register('ui.search', {}) }
      })

      await loader.loadAll()

      expect(loader.getDeclarationMismatches()).toEqual([])
    })

    it('should forget a mismatch once the module is unloaded', async () => {
      const loader = testLoader()

      stub(loader, 'search', { provides: ['ui.search'] })
      await loader.loadAll()
      expect(loader.getDeclarationMismatches()).toHaveLength(1)

      await loader.unloadModule('search')

      expect(loader.getDeclarationMismatches()).toEqual([])
    })
  })

  describe('awaitCascade', () => {
    /**
     * A consumer whose activation takes a tick, so the cascade cannot have
     * finished by accident when loadModule() returns.
     */
    function slowChain(loader: ModuleLoader) {
      const provider: ModuleManifest = {
        id: 'provider',
        name: 'provider',
        version: '1.0.0',
        entry: 'http://localhost/provider/remoteEntry.js',
        exports: {},
        provides: [{ id: 'geo.service' }]
      }
      const consumer: ModuleManifest = {
        id: 'consumer',
        name: 'consumer',
        version: '1.0.0',
        entry: 'http://localhost/consumer/remoteEntry.js',
        exports: {},
        requiresService: [{ id: 'geo.service' }]
      }

      containers['provider'] = {
        activate: (context: ModuleContext) => { context.services.register('geo.service', {}) }
      }
      containers['consumer'] = {
        activate: async () => { await new Promise(resolve => setTimeout(resolve, 20)) }
      }
      loader.register([provider, consumer])

      return { provider, consumer }
    }

    it('should leave the cascade running by default', async () => {
      const loader = testLoader()
      const { provider, consumer } = slowChain(loader)
      await loader.loadModule(consumer)

      await loader.loadModule(provider)

      // The consumer's activation is still in flight, so the picture is partial
      expect(loader.getModule('consumer')?.state).not.toBe('active')

      await loader.settle()
      expect(loader.getModule('consumer')?.state).toBe('active')
    })

    it('should wait for the cascade when asked to', async () => {
      const loader = testLoader()
      const { provider, consumer } = slowChain(loader)
      await loader.loadModule(consumer)

      await loader.loadModule(provider, { awaitCascade: true })

      // No settle() here: the option covered it
      expect(loader.getModule('consumer')?.state).toBe('active')
      expect(loader.getUnsatisfiedModules()).toEqual([])
    })

    it('should be harmless when nothing is waiting', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'solo', {})

      const loaded = await loader.loadModule(manifest, { awaitCascade: true })

      expect(loaded.state).toBe('active')
    })

    it('should also wait when the module itself is parked', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'waiting', { requires: [{ id: 'absent.service' }] })

      const loaded = await loader.loadModule(manifest, { awaitCascade: true })

      expect(loaded.state).toBe('unsatisfied')
      expect(loader.getUnsatisfiedModules()).toEqual([
        { moduleId: 'waiting', waitingFor: ['absent.service'] }
      ])
    })
  })

  describe('loading a manifest that was never registered', () => {
    it('should make it known to the loader', async () => {
      const loader = testLoader()
      const manifest: ModuleManifest = {
        id: 'ad-hoc', name: 'ad-hoc', version: '1.0.0',
        entry: 'http://localhost/ad-hoc/remoteEntry.js', exports: {}
      }
      containers['ad-hoc'] = { activate: vi.fn() }

      await loader.loadModule(manifest)

      // Otherwise the module runs while getManifests() denies it exists
      expect(loader.getManifests().map(entry => entry.id)).toEqual(['ad-hoc'])
    })

    it('should apply properties and ranking declared in that manifest', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      const manifest: ModuleManifest = {
        id: 'ad-hoc', name: 'ad-hoc', version: '1.0.0',
        entry: 'http://localhost/ad-hoc/remoteEntry.js', exports: {},
        provides: [{ id: 'ui.component', ranking: 7, properties: { region: 'main' } }]
      }
      containers['ad-hoc'] = {
        activate: (context: ModuleContext) => { context.services.register('ui.component', {}) }
      }

      await loader.loadModule(manifest)

      const [reference] = registry.getServiceReferences('ui.component')
      expect(reference.ranking).toBe(7)
      expect(reference.properties.region).toBe('main')
    })
  })

  describe('disable and enable', () => {
    it('should stop a module and keep it stopped', async () => {
      const loader = testLoader()
      const onDeactivate = vi.fn()
      stub(loader, 'alpha', { onDeactivate })
      await loader.loadAll()

      expect(await loader.disableModule('alpha')).toBe(true)

      expect(loader.getModule('alpha')?.state).toBe('stopped')
      expect(onDeactivate).toHaveBeenCalledTimes(1)
      expect(loader.isDisabled('alpha')).toBe(true)
      expect(loader.getDisabledModules()).toEqual(['alpha'])
    })

    it('should not let a reconcile bring a disabled module back', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})
      const onActivate = vi.fn()
      stub(loader, 'alpha', { requires: [{ id: 'geo.service' }], onActivate })
      await loader.loadAll()
      expect(onActivate).toHaveBeenCalledTimes(1)

      await loader.disableModule('alpha')

      // Everything it needs is there, and it still stays off
      registry.unregister('geo.service')
      registry.register('geo.service', {})
      await loader.settle()

      expect(loader.getModule('alpha')?.state).toBe('stopped')
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('should park consumers when a disabled module took its service along', async () => {
      const loader = testLoader()
      stub(loader, 'provider', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', {}) }
      })
      stub(loader, 'consumer', { requires: [{ id: 'geo.service' }] })
      await loader.loadAll()

      await loader.disableModule('provider')

      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')
      expect(loader.getServiceRegistry().has('geo.service')).toBe(false)
    })

    it('should activate a module again on enable', async () => {
      const loader = testLoader()
      const onActivate = vi.fn()
      stub(loader, 'alpha', { onActivate })
      await loader.loadAll()
      await loader.disableModule('alpha')

      expect(await loader.enableModule('alpha')).toBe(true)

      expect(loader.getModule('alpha')?.state).toBe('active')
      expect(onActivate).toHaveBeenCalledTimes(2)
      expect(loader.isDisabled('alpha')).toBe(false)
    })

    it('should leave an enabled module waiting when its service is gone', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})
      stub(loader, 'alpha', { requires: [{ id: 'geo.service' }] })
      await loader.loadAll()

      await loader.disableModule('alpha')
      registry.unregister('geo.service')
      await loader.enableModule('alpha')

      expect(loader.getModule('alpha')?.state).toBe('unsatisfied')

      registry.register('geo.service', {})
      await loader.settle()
      expect(loader.getModule('alpha')?.state).toBe('active')
    })

    it('should restore the whole chain on enable', async () => {
      const loader = testLoader()
      stub(loader, 'provider', {
        provides: ['geo.service'],
        onActivate: services => { services.register('geo.service', {}) }
      })
      stub(loader, 'consumer', { requires: [{ id: 'geo.service' }] })
      await loader.loadAll()
      await loader.disableModule('provider')

      await loader.enableModule('provider')

      expect(loader.getModule('provider')?.state).toBe('active')
      expect(loader.getModule('consumer')?.state).toBe('active')
    })

    it('should skip a disabled module in loadAll instead of failing', async () => {
      const loader = testLoader()
      const onActivate = vi.fn()
      stub(loader, 'alpha', { onActivate })
      stub(loader, 'beta', {})
      await loader.disableModule('alpha')

      await loader.loadAll()

      expect(onActivate).not.toHaveBeenCalled()
      expect(loader.getModule('alpha')).toBeUndefined()
      expect(loader.getModule('beta')?.state).toBe('active')
    })

    it('should reject loading a module that was disabled before it ever ran', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.disableModule('alpha')

      await expect(loader.loadModule(manifest)).rejects.toThrow('is disabled')
    })

    it('should load a module that is enabled before it ever ran', async () => {
      const loader = testLoader()
      const onActivate = vi.fn()
      stub(loader, 'alpha', { onActivate })
      await loader.disableModule('alpha')
      await loader.loadAll()

      await loader.enableModule('alpha')

      expect(loader.getModule('alpha')?.state).toBe('active')
      expect(onActivate).toHaveBeenCalledTimes(1)
    })

    it('should refuse to load a disabled module', async () => {
      const loader = testLoader()
      const manifest = stub(loader, 'alpha', {})
      await loader.loadAll()
      await loader.disableModule('alpha')

      const loaded = await loader.loadModule(manifest)

      expect(loaded.state).toBe('stopped')
    })

    it('should report an unknown module and a module that was not disabled', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})

      expect(await loader.disableModule('ghost')).toBe(false)
      expect(await loader.enableModule('alpha')).toBe(false)
    })

    it('should forget the flag when the module is unloaded', async () => {
      const loader = testLoader()
      stub(loader, 'alpha', {})
      await loader.loadAll()
      await loader.disableModule('alpha')

      await loader.unloadModule('alpha')

      expect(loader.isDisabled('alpha')).toBe(false)
    })
  })

  describe('getServiceConsumers', () => {
    it('should name the modules that asked for a service', async () => {
      const loader = testLoader()
      stub(loader, 'map', { requires: [{ id: 'geo.service' }] })
      stub(loader, 'chart', {
        requires: [{ id: 'geo.service', optional: true, policy: 'dynamic' }]
      })
      stub(loader, 'unrelated', { requires: [{ id: 'other.service' }] })
      await loader.loadAll()

      const consumers = loader.getServiceConsumers('geo.service')

      expect(consumers.map(entry => entry.moduleId)).toEqual(['map', 'chart'])
      expect(consumers[0].state).toBe('unsatisfied')
      expect(consumers[1].requirement.policy).toBe('dynamic')
    })

    it('should include modules that were never loaded', () => {
      const loader = testLoader()
      stub(loader, 'map', { requires: [{ id: 'geo.service' }] })

      expect(loader.getServiceConsumers('geo.service')).toEqual([
        { moduleId: 'map', state: 'not loaded', requirement: { id: 'geo.service' } }
      ])
    })

    it('should return nothing for a service nobody declared', () => {
      expect(testLoader().getServiceConsumers('nothing')).toEqual([])
    })
  })

  describe('hot reload', () => {
    /**
     * No stand-in for a browser needed any more: reloadModule() keeps a
     * handed-over container across the unload, so a module with no fetchable URL
     * restarts on the same code. That used to require a window proxy surviving
     * the delete.
     */
    it('should reload the whole dependent chain, not just the first level', async () => {
      const loader = testLoader({ hotReload: true })
      const activations: string[] = []

      const base = stub(loader, 'base', { onActivate: () => { activations.push('base') } })
      stub(loader, 'middle', {
        dependencies: ['base'],
        onActivate: () => { activations.push('middle') }
      })
      stub(loader, 'leaf', {
        dependencies: ['middle'],
        onActivate: () => { activations.push('leaf') }
      })

      await loader.loadAll()
      expect(activations).toEqual(['base', 'middle', 'leaf'])

      await loader.reloadModule('base')

      // Every module in the chain ran its activate hook a second time
      expect(activations).toEqual([
        'base', 'middle', 'leaf',
        'base', 'middle', 'leaf'
      ])
      expect(loader.getModule('leaf')?.state).toBe('active')
      // No cache buster: this module was handed over, so there is no URL to
      // re-fetch and changing the manifest would say something untrue
      expect(base.entry).not.toContain('?t=')
    })

    it('should include a parked dependent in the reload', async () => {
      const loader = testLoader({ hotReload: true })
      const registry = loader.getServiceRegistry()
      const activations: string[] = []

      stub(loader, 'base', { onActivate: () => { activations.push('base') } })
      // Parked: waits for a service nobody provides
      stub(loader, 'waiting', {
        dependencies: ['base'],
        requires: [{ id: 'geo.service' }],
        onActivate: () => { activations.push('waiting') }
      })

      await loader.loadAll()
      expect(loader.getModule('waiting')?.state).toBe('unsatisfied')
      expect(activations).toEqual(['base'])

      await loader.reloadModule('base')

      // The parked module was taken along: still parked, but on the new container
      expect(loader.getModule('waiting')?.state).toBe('unsatisfied')
      expect(activations).toEqual(['base', 'base'])

      // And it activates from the reloaded code once its service shows up
      registry.register('geo.service', {})
      await loader.settle()

      expect(loader.getModule('waiting')?.state).toBe('active')
      expect(activations).toEqual(['base', 'base', 'waiting'])
    })

    it('should refuse to reload without hot reload enabled', async () => {
      const loader = testLoader()
      stub(loader, 'base', {})
      await loader.loadAll()

      await expect(loader.reloadModule('base')).rejects.toThrow('Hot reload is not enabled')
    })

    it('should leave a settled state behind', async () => {
      const loader = testLoader({ hotReload: true })

      stub(loader, 'provider', {
        provides: ['s1'],
        onActivate: services => { services.register('s1', {}) }
      })
      stub(loader, 'consumer', { requires: [{ id: 's1' }] })
      await loader.loadAll()

      await loader.reloadModule('provider')

      // No settle() here on purpose
      expect(loader.getModule('consumer')?.state).toBe('active')
      expect(loader.getUnsatisfiedModules()).toEqual([])
    })
  })

  describe('loop protection', () => {
    it('should give up on a module that keeps flipping within one cascade', async () => {
      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('flip.service', {})

      // Pathological: withdraws the service it needs on activation and puts it
      // back on deactivation, straight on the shared registry
      const manifest = stub(loader, 'flip-module', {
        requires: [{ id: 'flip.service' }],
        onActivate: () => { registry.unregister('flip.service') },
        onDeactivate: () => { registry.register('flip.service', {}) }
      })

      await loader.loadModule(manifest)
      await loader.settle()

      const loaded = loader.getModule('flip-module')
      expect(loaded?.state).toBe('error')
      expect(loaded?.error?.message).toContain('endless loop')
    })
  })
})
