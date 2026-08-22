/**
 * The Service Component Runtime as a service (DS 112.10).
 *
 * In OSGi, SCR is an ordinary bundle, so introspecting components goes through a
 * service rather than through the framework. The test that matters here is the
 * last group: a *module* seeing and switching components, which is what the
 * whole thing is for — before this, only the host could.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader.js'
import { activate, component, deactivate, inject } from '../decorators.js'
import {
  COMPONENT_RUNTIME_SERVICE_ID,
  COMPONENT_EXTENDER,
  CONFIGURATION_IMPLEMENTATION,
  EXTENDER_NAMESPACE,
  IMPLEMENTATION_NAMESPACE,
  METATYPE_EXTENDER,
  type ServiceComponentRuntime
} from '../componentRuntime.js'
import type { ModuleContext, ModuleManifest } from '../types.js'

const manifest = (id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest =>
  ({ id, version: '1.0.0', entry: `${id}.js`, provides: [], ...extra })

describe('the component runtime service', () => {
  let loader: ModuleLoader

  beforeEach(() => {
    loader = new ModuleLoader()
  })

  const runtime = (): ServiceComponentRuntime =>
    loader.getServiceRegistry().getRequired<ServiceComponentRuntime>(
      COMPONENT_RUNTIME_SERVICE_ID
    )

  describe('publication', () => {
    it('is there before any module is loaded', () => {
      // A module asking for it must not depend on load order
      expect(loader.getServiceRegistry().has(COMPONENT_RUNTIME_SERVICE_ID)).toBe(true)
    })

    it('is attributed to the runtime', () => {
      expect(loader.getServiceRegistry()
        .getBindingInfo(COMPONENT_RUNTIME_SERVICE_ID)?.providedBy).toBe('tsm')
    })
  })

  describe('the extender capability', () => {
    it('is offered by the system bundle, as the SCR bundle offers it', () => {
      const capability = loader.getSystemBundle().capabilities
        ?.find(entry => entry.namespace === EXTENDER_NAMESPACE)

      expect(capability?.attributes[EXTENDER_NAMESPACE]).toBe(COMPONENT_EXTENDER)
    })

    it('resolves a module that requires it', () => {
      loader.register([manifest('ui', {
        requirements: [{
          namespace: EXTENDER_NAMESPACE,
          filter: `(${EXTENDER_NAMESPACE}=${COMPONENT_EXTENDER})`
        }]
      })])

      expect(loader.getWiring().unresolved).toEqual([])
    })

    it('leaves a module requiring an unknown extender waiting in vain', () => {
      loader.register([manifest('ui', {
        requirements: [{
          namespace: EXTENDER_NAMESPACE,
          filter: `(${EXTENDER_NAMESPACE}=osgi.blueprint)`
        }]
      })])

      // The point of declaring it: not running is better than running wrong
      expect(loader.getWiring().unresolved.map(entry => entry.moduleId)).toEqual(['ui'])
    })
  })

  describe('descriptions', () => {
    beforeEach(async () => {
      @component({ service: ['tile.service'] })
      class Tiles {
        @activate() start(): void {}
        @deactivate() stop(): void {}
      }

      @component()
      class Waiting {
        constructor(@inject('nothing.provides.this') readonly missing: unknown) {}
        @activate() start(): void {}
      }

      await loader.loadModule(manifest('map'), { container: { Tiles, Waiting } })
    })

    it('lists the components of a module', () => {
      expect(runtime().getComponentDescriptions('map').map(entry => entry.className))
        .toEqual(['Tiles', 'Waiting'])
    })

    it('lists every component when no module is named', () => {
      expect(runtime().getComponentDescriptions()).toHaveLength(2)
    })

    it('finds one by module and class', () => {
      const found = runtime().getComponentDescription('map', 'Tiles')
      expect(found?.services).toEqual(['tile.service'])
    })

    it('returns undefined for one that is not there', () => {
      expect(runtime().getComponentDescription('map', 'Nothing')).toBeUndefined()
    })

    it('carries the state, including what a component waits for', () => {
      const waiting = runtime().getComponentDescription('map', 'Waiting')

      expect(waiting?.configurations[0].state).toBe('unsatisfied-reference')
      expect(waiting?.configurations[0].waitingFor).toEqual(['nothing.provides.this'])
    })

    it('is the same description the loader gives', () => {
      expect(runtime().getComponentDescriptions('map'))
        .toEqual(loader.getComponents('map'))
    })
  })

  describe('the switch', () => {
    let stopped: () => void

    beforeEach(async () => {
      stopped = vi.fn()

      @component({ service: ['tile.service'] })
      class Tiles {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('map'), { container: { Tiles } })
    })

    it('reports an enabled component as enabled', () => {
      expect(runtime().isComponentEnabled('map', 'Tiles')).toBe(true)
    })

    it('switches one off', async () => {
      await runtime().disableComponent('map', 'Tiles')

      expect(stopped).toHaveBeenCalledOnce()
      expect(runtime().isComponentEnabled('map', 'Tiles')).toBe(false)
      expect(loader.getServiceRegistry().has('tile.service')).toBe(false)
    })

    it('leaves the module running', async () => {
      await runtime().disableComponent('map', 'Tiles')
      expect(loader.getModule('map')?.state).toBe('active')
    })

    it('switches it on again', async () => {
      await runtime().disableComponent('map', 'Tiles')
      await runtime().enableComponent('map', 'Tiles')

      expect(loader.getServiceRegistry().has('tile.service')).toBe(true)
    })

    it('lists what is switched off', async () => {
      await runtime().disableComponent('map', 'Tiles')
      expect(runtime().getDisabledComponents()).toEqual(['map/Tiles'])
    })
  })

  describe('a module doing the introspecting', () => {
    it('sees the components of another module', async () => {
      // What this service is for. Before it, a component view or a diagnostics
      // panel had to live in the host, because the loader was the only way in
      let seen: string[] = []

      @component({ service: ['tile.service'] })
      class Tiles {
        @activate() start(): void {}
      }

      await loader.loadModule(manifest('map'), { container: { Tiles } })

      await loader.loadModule(manifest('inspector'), {
        container: {
          activate(context: ModuleContext) {
            const scr = context.services.get<ServiceComponentRuntime>(
              COMPONENT_RUNTIME_SERVICE_ID
            )
            seen = (scr?.getComponentDescriptions() ?? []).map(
              entry => `${entry.moduleId}/${entry.className}`
            )
          }
        }
      })

      expect(seen).toEqual(['map/Tiles'])
    })

    it('can switch a component of another module off', async () => {
      const stopped = vi.fn()

      @component({ service: ['tile.service'] })
      class Tiles {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('map'), { container: { Tiles } })

      let switchOff: (() => Promise<boolean>) | undefined
      await loader.loadModule(manifest('inspector'), {
        container: {
          activate(context: ModuleContext) {
            const scr = context.services.getRequired<ServiceComponentRuntime>(
              COMPONENT_RUNTIME_SERVICE_ID
            )
            switchOff = () => scr.disableComponent('map', 'Tiles')
          }
        }
      })

      await switchOff!()
      expect(stopped).toHaveBeenCalledOnce()
    })

    it('reaches it as a component reference too', async () => {
      let described: number | undefined

      @component()
      class Inspector {
        constructor(
          @inject(COMPONENT_RUNTIME_SERVICE_ID) private readonly scr: ServiceComponentRuntime
        ) {}

        @activate()
        start(): void { described = this.scr.getComponentDescriptions().length }
      }

      await loader.loadModule(manifest('tools'), { container: { Inspector } })

      // Itself included: a declaration is a declaration
      expect(described).toBe(1)
    })
  })
})

describe('what else the runtime offers as a capability', () => {
  const extenders = (loader: ModuleLoader): string[] =>
    (loader.getSystemBundle().capabilities ?? [])
      .filter(entry => entry.namespace === EXTENDER_NAMESPACE)
      .map(entry => String(entry.attributes[EXTENDER_NAMESPACE]))

  it('offers metatype only when there is one', async () => {
    const { MetatypeRegistry } = await import('../Metatype.js')

    expect(extenders(new ModuleLoader())).toEqual([COMPONENT_EXTENDER])
    expect(extenders(new ModuleLoader({ metatype: new MetatypeRegistry() })))
      .toEqual([COMPONENT_EXTENDER, METATYPE_EXTENDER])
  })

  it('offers configuration admin only when there is one', async () => {
    const { ConfigurationAdmin } = await import('../ConfigurationAdmin.js')
    const withAdmin = new ModuleLoader({ configurationAdmin: new ConfigurationAdmin() })

    const implementations = (loader: ModuleLoader): string[] =>
      (loader.getSystemBundle().capabilities ?? [])
        .filter(entry => entry.namespace === IMPLEMENTATION_NAMESPACE)
        .map(entry => String(entry.attributes[IMPLEMENTATION_NAMESPACE]))

    expect(implementations(new ModuleLoader())).toEqual([])
    expect(implementations(withAdmin)).toEqual([CONFIGURATION_IMPLEMENTATION])
  })

  it('leaves a module needing metatype unresolved without one', () => {
    // A capability nobody can rely on is worse than none: this module would
    // otherwise resolve and then find its configurationSchema dropped
    const loader = new ModuleLoader()
    loader.register([manifest('forms', {
      requirements: [{
        namespace: EXTENDER_NAMESPACE,
        filter: `(${EXTENDER_NAMESPACE}=${METATYPE_EXTENDER})`
      }]
    })])

    expect(loader.getWiring().unresolved.map(entry => entry.moduleId)).toEqual(['forms'])
  })

  it('resolves it when the application supplied one', async () => {
    const { MetatypeRegistry } = await import('../Metatype.js')
    const loader = new ModuleLoader({ metatype: new MetatypeRegistry() })
    loader.register([manifest('forms', {
      requirements: [{
        namespace: EXTENDER_NAMESPACE,
        filter: `(${EXTENDER_NAMESPACE}=${METATYPE_EXTENDER})`
      }]
    })])

    expect(loader.getWiring().unresolved).toEqual([])
  })
})
