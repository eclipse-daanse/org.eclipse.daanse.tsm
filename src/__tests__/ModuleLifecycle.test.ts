import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import type { ModuleContext, ModuleEvent, ModuleEventListener, ModuleManifest, ServiceRegistry } from '../types'

interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

interface StubOptions {
  requires?: Array<{ id: string; optional?: boolean }>
  provides?: string[]
  dependencies?: string[]
  onActivate?: (services: ServiceRegistry) => void
  onDeactivate?: (services: ServiceRegistry) => void
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
    provides: options.provides?.map(serviceId => ({ id: serviceId })),
    dependencies: options.dependencies
  }

  globalRef.window![id] = {
    activate: (context: ModuleContext) => { options.onActivate?.(context.services) },
    deactivate: (context: ModuleContext) => { options.onDeactivate?.(context.services) }
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
  let savedWindow: Record<string, unknown> | undefined

  beforeEach(() => {
    savedWindow = globalRef.window
    globalRef.window = {}
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  describe('parking instead of failing', () => {
    it('should park a module whose required service is missing', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
      const manifest = stub(loader, 'map-module', {
        requires: [{ id: 'geo.service', optional: true }]
      })

      const loaded = await loader.loadModule(manifest)
      await loader.settle()

      expect(loaded.state).toBe('active')
    })

    it('should still fail fast with strictRequirements', async () => {
      const loader = new ModuleLoader({ strictRequirements: true })
      const manifest = stub(loader, 'map-module', { requires: [{ id: 'geo.service' }] })

      await expect(loader.loadModule(manifest)).rejects.toThrow(
        'requires services that are not available: geo.service'
      )
      expect(loader.getModule('map-module')?.state).toBe('error')
    })

    it('should be idempotent for a parked module', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()

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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()

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
      const loader = new ModuleLoader()

      stub(loader, 'base', {})
      stub(loader, 'feature', { dependencies: ['base'] })
      await loader.loadAll()

      expect(await loader.unloadModule('base')).toBe(false)
      expect(loader.getModule('base')?.state).toBe('active')
      expect(loader.getModule('feature')?.state).toBe('active')
    })

    it('should bring a parked dependent back when the dependency returns', async () => {
      const loader = new ModuleLoader()
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
      const loader = new ModuleLoader()

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
      const loader = new ModuleLoader()
      const events = collectEvents(loader)

      stub(loader, 'a', { dependencies: ['b'] })
      stub(loader, 'b', { dependencies: ['a'] })

      await loader.loadAll()

      expect(events.filter(event => event.type === 'error')).toEqual([])
    })
  })

  describe('asynchronous hooks', () => {
    it('should serialize activations that await inside the hook', async () => {
      const loader = new ModuleLoader()
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
        globalRef.window![id] = {
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
      const loader = new ModuleLoader()
      const registry = loader.getServiceRegistry()

      const slow: ModuleManifest = {
        id: 'slow', name: 'slow', version: '1.0.0',
        entry: 'http://localhost/slow/remoteEntry.js', exports: {},
        requiresService: [{ id: 'late.service' }]
      }
      globalRef.window!['slow'] = {
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

  describe('loop protection', () => {
    it('should give up on a module that keeps flipping within one cascade', async () => {
      const loader = new ModuleLoader()
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
