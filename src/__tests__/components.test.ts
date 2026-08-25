import 'reflect-metadata'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import { activate, component, deactivate, inject } from '../decorators'
import { CONDITION_SERVICE_ID } from '../conditions'
import { COMPONENT_RUNTIME_SERVICE_ID } from '../componentRuntime'
import { FEATURE_SERVICE_ID } from '../features'
import type { ModuleContext, ModuleManifest } from '../types'

/**
 * Declarative components: what a class offers stands on the class, and the loader
 * does the registering — instead of a module calling register() in its activate
 * export.
 */

function loader(): ModuleLoader {
  return testLoader()
}

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

describe('declarative components', () => {

  beforeEach(() => {
    resetContainers()
  })

  afterEach(() => {
  })

  describe('registration', () => {
    it('should register a component under its declared service id', async () => {
      @component({ service: ['geo.service'] })
      class GeoService {
        locate(): string { return 'here' }
      }

      const loader = testLoader()
      containers.geo = { GeoService }

      await loader.loadModule(manifest('geo'))

      const registry = loader.getServiceRegistry()
      expect(registry.get<GeoService>('geo.service')?.locate()).toBe('here')
      expect(registry.getBindingInfo('geo.service')?.providedBy).toBe('geo')
    })

    it('should need no activate export at all', async () => {
      @component({ service: ['plain.service'] })
      class PlainService {}

      const loader = testLoader()
      // The module exports a class and nothing else
      containers.plain = { PlainService }

      const loaded = await loader.loadModule(manifest('plain'))

      expect(loaded.state).toBe('active')
      expect(loader.getServiceRegistry().has('plain.service')).toBe(true)
    })

    it('should apply properties and ranking from the declaration', async () => {
      @component({
        service: ['ui.component'],
        properties: { region: 'main' },
        ranking: 7
      })
      class Widget {}

      const loader = testLoader()
      containers.widget = { Widget }

      await loader.loadModule(manifest('widget'))

      const [reference] = loader.getServiceRegistry().getServiceReferences('ui.component')
      expect(reference.ranking).toBe(7)
      expect(reference.properties.region).toBe('main')
    })

    it('should register additional service ids as aliases', async () => {
      @component({
        service: ['chart.renderer', 'ui.component'],
        propertiesById: { 'ui.component': { region: 'main' } }
      })
      class ChartRenderer {}

      const loader = testLoader()
      containers.chart = { ChartRenderer }

      await loader.loadModule(manifest('chart'))

      const registry = loader.getServiceRegistry()
      expect(registry.get('chart.renderer')).toBeInstanceOf(ChartRenderer)
      expect(registry.get('ui.component')).toBe(registry.get('chart.renderer'))
      expect(registry.getServiceReferences('ui.component')[0].properties.region).toBe('main')
    })

    it('should ignore exports that are not components', async () => {
      class NotAComponent {}

      const loader = testLoader()
      containers.mixed = { NotAComponent, helper: () => 'x', value: 42 }

      const loaded = await loader.loadModule(manifest('mixed'))

      expect(loaded.state).toBe('active')
      // Everything but what the runtime registers itself — this test is about the
      // module's exports
      expect(loader.getServiceRegistry().getServiceIds())
        .toEqual([CONDITION_SERVICE_ID, COMPONENT_RUNTIME_SERVICE_ID, FEATURE_SERVICE_ID])
    })
  })

  describe('immediate and delayed', () => {
    it('should create a component with an activate method right away', async () => {
      const started = vi.fn()

      @component({ service: ['immediate.service'] })
      class Immediate {
        @activate()
        start(context: ModuleContext): void {
          started(context.manifest.id)
        }
      }

      const loader = testLoader()
      containers.immediate = { Immediate }

      await loader.loadModule(manifest('immediate'))

      // DS calls this an immediate component: something has to run whether or
      // not anyone asks for the service
      expect(started).toHaveBeenCalledWith('immediate')
      expect(loader.getServiceRegistry().getServiceReferences('immediate.service')[0].instantiated)
        .toBe(true)
    })

    it('should leave a component without an activate method unbuilt', async () => {
      const constructed = vi.fn()

      @component({ service: ['delayed.service'] })
      class Delayed {
        constructor() { constructed() }
      }

      const loader = testLoader()
      containers.delayed = { Delayed }

      await loader.loadModule(manifest('delayed'))

      expect(constructed).not.toHaveBeenCalled()
      expect(loader.getServiceRegistry().getServiceReferences('delayed.service')[0].instantiated)
        .toBe(false)

      // Built on first resolution — a delayed component
      loader.getServiceRegistry().get('delayed.service')
      expect(constructed).toHaveBeenCalledTimes(1)
    })

    it('should honour immediate: true without an activate method', async () => {
      const constructed = vi.fn()

      @component({ service: ['eager.service'], immediate: true })
      class Eager {
        constructor() { constructed() }
      }

      const loader = testLoader()
      containers.eager = { Eager }

      await loader.loadModule(manifest('eager'))

      expect(constructed).toHaveBeenCalledTimes(1)
    })

    it('should await an async activate method', async () => {
      const order: string[] = []

      @component({ service: ['async.service'] })
      class AsyncComponent {
        @activate()
        async start(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 10))
          order.push('activated')
        }
      }

      const loader = testLoader()
      containers.asyncmod = { AsyncComponent }

      await loader.loadModule(manifest('asyncmod'))
      order.push('load returned')

      expect(order).toEqual(['activated', 'load returned'])
    })

    it('should run a component that offers no service at all', async () => {
      const started = vi.fn()

      @component()
      class Background {
        @activate()
        start(): void { started() }
      }

      const loader = testLoader()
      containers.background = { Background }

      await loader.loadModule(manifest('background'))

      expect(started).toHaveBeenCalledTimes(1)
    })
  })

  describe('several components under one service id', () => {
    it('should activate each on its own instance', async () => {
      const started: string[] = []

      @component({ service: ['ui.component'], properties: { name: 'first' } })
      class First {
        @activate() start(): void { started.push('first') }
      }

      @component({ service: ['ui.component'], properties: { name: 'second' } })
      class Second {
        @activate() start(): void { started.push('second') }
      }

      const loader = testLoader()
      containers.pairmod = { First, Second }

      await loader.loadModule(manifest('pairmod'))

      // get('ui.component') would have answered with the visible one twice
      expect(started).toEqual(['first', 'second'])
      const registry = loader.getServiceRegistry()
      expect(registry.countProviders('ui.component')).toBe(2)
      expect(registry.getMatching('ui.component', '(name=first)')).toBeInstanceOf(First)
      expect(registry.getMatching('ui.component', '(name=second)')).toBeInstanceOf(Second)
    })

    it('should resolve a registration handle to its own service', () => {
      const registry = loader().getServiceRegistry()
      const first = registry.register('shared.id', { tag: 'first' }, { providedBy: 'a' })
      const second = registry.register('shared.id', { tag: 'second' }, { providedBy: 'b', ranking: 10 })

      // get() answers with the ranked one; each handle answers with its own
      expect(registry.get('shared.id')).toEqual({ tag: 'second' })
      expect(first.resolve()).toEqual({ tag: 'first' })
      expect(second.resolve()).toEqual({ tag: 'second' })

      first.unregister()
      expect(first.resolve()).toBeUndefined()
    })
  })

  describe('components of one module depending on each other', () => {
    it('should register every component before activating any', async () => {
      @component({ service: ['metrics.service'] })
      class MetricsService {
        readonly tag = 'metrics'
      }

      @component({ service: ['ui.component'] })
      class MetricsView {
        constructor(@inject('metrics.service') readonly metrics: MetricsService) {}

        @activate()
        start(): void {}
      }

      const loader = testLoader()
      // Declared in the order that used to fail: the consumer comes first
      containers.metrics = { MetricsView, MetricsService }

      const loaded = await loader.loadModule(manifest('metrics'))

      expect(loaded.state).toBe('active')
      const registry = loader.getServiceRegistry()
      expect(registry.has('metrics.service')).toBe(true)
      expect(registry.get<MetricsView>('ui.component')?.metrics.tag).toBe('metrics')
    })
  })

  describe('listing components', () => {
    it('should report what each component declared', async () => {
      @component({ service: ['geo.service'] })
      class GeoService {
        @activate() start(): void {}
        @deactivate() stop(): void {}
      }

      @component({ service: ['ui.component', 'ui.widget'] })
      class Widget {}

      @component()
      class Background {
        @activate() start(): void {}
      }

      const loader = testLoader()
      containers.listed = { GeoService, Widget, Background }

      await loader.loadModule(manifest('listed'))

      expect(loader.getComponents('listed')).toEqual([
        {
          moduleId: 'listed', className: 'GeoService', services: ['geo.service'],
          disabled: false, immediate: true, hasActivate: true, hasDeactivate: true, hasModified: false,
          references: [], collections: [],
          satisfyingCondition: undefined, factory: undefined,
          // The class name is the default PID, as the component name is in DS
          configurationPid: ['GeoService'], configurationPolicy: 'optional',
          configurations: [{ pid: undefined, state: 'active', properties: {} }]
        },
        {
          moduleId: 'listed', className: 'Widget', services: ['ui.component', 'ui.widget'],
          disabled: false, immediate: false, hasActivate: false, hasDeactivate: false, hasModified: false,
          references: [], collections: [],
          satisfyingCondition: undefined, factory: undefined,
          configurationPid: ['Widget'], configurationPolicy: 'optional',
          // Registered, but nobody resolved it, so no instance exists
          configurations: [{ pid: undefined, state: 'satisfied', properties: {} }]
        },
        {
          moduleId: 'listed', className: 'Background', services: [],
          disabled: false, immediate: true, hasActivate: true, hasDeactivate: false, hasModified: false,
          references: [], collections: [],
          satisfyingCondition: undefined, factory: undefined,
          configurationPid: ['Background'], configurationPolicy: 'optional',
          configurations: [{ pid: undefined, state: 'active', properties: {} }]
        }
      ])
    })

    it('should list the components of every module', async () => {
      @component({ service: ['a.service'] })
      class A {}

      @component({ service: ['b.service'] })
      class B {}

      const loader = testLoader()
      containers.first = { A }
      containers.second = { B }

      await loader.loadModule(manifest('first'))
      await loader.loadModule(manifest('second'))

      expect(loader.getComponents().map(entry => `${entry.moduleId}/${entry.className}`))
        .toEqual(['first/A', 'second/B'])
    })

    it('should forget the components of an unloaded module', async () => {
      @component({ service: ['gone.service'] })
      class Gone {}

      const loader = testLoader()
      containers.temporary = { Gone }
      await loader.loadModule(manifest('temporary'))

      await loader.unloadModule('temporary')

      expect(loader.getComponents()).toEqual([])
    })

    it('should return nothing for a module without components', async () => {
      const loader = testLoader()
      containers.plainmod = { activate: vi.fn() }
      await loader.loadModule(manifest('plainmod'))

      expect(loader.getComponents('plainmod')).toEqual([])
    })
  })

  describe('teardown', () => {
    it('should call deactivate when the module is unloaded', async () => {
      const stopped = vi.fn()

      @component({ service: ['timer.service'] })
      class Timer {
        @activate()
        start(): void {}

        @deactivate()
        stop(): void { stopped() }
      }

      const loader = testLoader()
      containers.timer = { Timer }
      await loader.loadModule(manifest('timer'))

      await loader.unloadModule('timer')

      expect(stopped).toHaveBeenCalledTimes(1)
    })

    it('should call deactivate on the same instance that was activated', async () => {
      const seen: string[] = []

      @component({ service: ['stateful.service'] })
      class Stateful {
        private token = Math.random().toString(36).slice(2)

        @activate()
        start(): void { seen.push(`start:${this.token}`) }

        @deactivate()
        stop(): void { seen.push(`stop:${this.token}`) }
      }

      const loader = testLoader()
      containers.stateful = { Stateful }
      await loader.loadModule(manifest('stateful'))
      await loader.unloadModule('stateful')

      const [start, stop] = seen
      expect(start.split(':')[1]).toBe(stop.split(':')[1])
    })

    it('should tear components down in reverse order', async () => {
      const order: string[] = []

      @component()
      class First {
        @activate() start(): void { order.push('start first') }
        @deactivate() stop(): void { order.push('stop first') }
      }

      @component()
      class Second {
        @activate() start(): void { order.push('start second') }
        @deactivate() stop(): void { order.push('stop second') }
      }

      const loader = testLoader()
      containers.pair = { First, Second }
      await loader.loadModule(manifest('pair'))

      await loader.unloadModule('pair')

      expect(order).toEqual(['start first', 'start second', 'stop second', 'stop first'])
    })

    it('should keep tearing down after a failing deactivate', async () => {
      const stopped = vi.fn()

      @component()
      class Broken {
        @activate() start(): void {}
        @deactivate() stop(): void { throw new Error('boom') }
      }

      @component()
      class Fine {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      const loader = testLoader()
      containers.mixed2 = { Broken, Fine }
      await loader.loadModule(manifest('mixed2'))

      await loader.unloadModule('mixed2')

      expect(stopped).toHaveBeenCalledTimes(1)
    })

    it('should stop components when a required service is withdrawn', async () => {
      const stopped = vi.fn()

      @component({ service: ['consumer.service'] })
      class Consumer {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      const loader = testLoader()
      const registry = loader.getServiceRegistry()
      registry.register('geo.service', {})
      containers.consumer = { Consumer }
      await loader.loadModule(manifest('consumer', {
        requiresService: [{ id: 'geo.service' }]
      }))

      registry.unregister('geo.service')
      await loader.settle()

      expect(stopped).toHaveBeenCalledTimes(1)
      expect(loader.getModule('consumer')?.state).toBe('unsatisfied')
    })
  })

  describe('injection', () => {
    it('should inject declared dependencies into a component', async () => {
      @component({ service: ['reporter.service'] })
      class Reporter {
        constructor(@inject('geo.service') readonly geo: { locate(): string }) {}

        @activate()
        start(): void {}
      }

      const loader = testLoader()
      loader.getServiceRegistry().register('geo.service', { locate: () => 'here' })
      containers.reporter = { Reporter }

      await loader.loadModule(manifest('reporter'))

      expect(loader.getServiceRegistry().get<Reporter>('reporter.service')?.geo.locate())
        .toBe('here')
    })

    it('should let an imperative activate prepare what a component injects', async () => {
      @component({ service: ['reader.service'] })
      class Reader {
        constructor(@inject('prepared.service') readonly prepared: { ready: boolean }) {}

        @activate()
        start(): void {}
      }

      const loader = testLoader()
      containers.both = {
        Reader,
        // Runs before the components, so it can set up their dependencies
        activate: (context: ModuleContext) => {
          context.services.register('prepared.service', { ready: true })
        }
      }

      await loader.loadModule(manifest('both'))

      const registry = loader.getServiceRegistry()
      expect(registry.get<Reader>('reader.service')?.prepared.ready).toBe(true)
    })

    it('should expose declared components to consumers after activation', async () => {
      @component({ service: ['declared.service'] })
      class Declared {}

      const loader = testLoader()
      containers.declaring = { Declared }

      await loader.loadModule(manifest('declaring'))

      expect(loader.getServiceRegistry().has('declared.service')).toBe(true)
    })
  })
})

describe('a component whose activation fails', () => {
  it('should be discarded without taking the module with it', async () => {
    // DS 112.5.8: the component configuration is not activated and is discarded —
    // this one, and nothing else. What keeps one broken plugin from taking an
    // application with it
    const started = vi.fn()

    @component({ service: ['broken.service'] })
    class Broken {
      @activate() start(): void { throw new Error('boom') }
    }

    @component({ service: ['fine.service'] })
    class Fine {
      @activate() start(): void { started() }
    }

    const loader = testLoader()
    containers.mixed3 = { Broken, Fine }

    const loaded = await loader.loadModule(manifest('mixed3'))

    expect(loaded.state).toBe('active')
    expect(started).toHaveBeenCalledOnce()
  })

  it('should withdraw the services of the component that failed', async () => {
    @component({ service: ['broken.service'] })
    class Broken {
      @activate() start(): void { throw new Error('boom') }
    }

    const loader = testLoader()
    containers.broken = { Broken }
    await loader.loadModule(manifest('broken'))

    // A registration whose object never finished starting would hand consumers a
    // half-initialised thing
    expect(loader.getServiceRegistry().has('broken.service')).toBe(false)
  })

  it('should report it as failed rather than as waiting', async () => {
    @component({ service: ['broken.service'] })
    class Broken {
      @activate() start(): void { throw new Error('boom') }
    }

    const loader = testLoader()
    containers.broken2 = { Broken }
    await loader.loadModule(manifest('broken2'))

    // Neither active nor unsatisfied: it failed, and which of the three it is
    // matters to whoever has to find out why
    expect(loader.getComponents('broken2')[0].configurations[0].state)
      .toBe('failed-activation')
  })

  it('should log the error it was given', async () => {
    const error = vi.fn()
    const loader = testLoader({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
    })

    @component()
    class Broken {
      @activate() start(): void { throw new Error('boom') }
    }

    containers.broken3 = { Broken }
    await loader.loadModule(manifest('broken3'))

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('@activate of Broken'),
      expect.any(Error)
    )
  })

  it('should leave a later component of the same module running', async () => {
    // Registration happens for every component before any is activated, so the
    // failure has to come after the others are already registered
    const loader = testLoader()

    @component({ service: ['a.service'] })
    class Broken {
      @activate() start(): void { throw new Error('boom') }
    }
    @component({ service: ['b.service'] })
    class Later {
      @activate() start(): void {}
    }

    containers.order = { Broken, Later }
    await loader.loadModule(manifest('order'))

    expect(loader.getServiceRegistry().has('a.service')).toBe(false)
    expect(loader.getServiceRegistry().has('b.service')).toBe(true)
  })
})
