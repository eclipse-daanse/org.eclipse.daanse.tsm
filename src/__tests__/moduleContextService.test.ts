/**
 * A module's context as a service (tsm#24).
 *
 * `@activate(context)` already hands a component its context. This is for the
 * case that cannot reach: a class whose dependency on the registry is
 * constructional — a resolver that looks services up when it is called.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader.js'
import { MODULE_CONTEXT_SERVICE_ID } from '../moduleContext.js'
import { component, activate, inject, injectAll } from '../decorators.js'
import { serviceId } from '../serviceId.js'
import type { ComponentContext, ModuleContext, ModuleManifest } from '../types.js'

const manifest = (id: string): ModuleManifest =>
  ({ id, version: '1.0.0', entry: `${id}.js`, exports: {} })

interface Datasource { name: string }
const Datasource = serviceId<Datasource>('demo.datasource')

describe('the module context service', () => {
  let loader: ModuleLoader

  beforeEach(() => { loader = new ModuleLoader() })

  describe('as a constructor dependency', () => {
    it('reaches the registry from a constructor', async () => {
      // What could not be declared before: the repository resolves at call time,
      // so it needs the registry as a constructional dependency
      loader.getServiceRegistry().register(Datasource, { name: 'sql' })
      let resolved: Datasource | undefined

      @component()
      class Repository {
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) private readonly context: ModuleContext) {}
        @activate() start(): void { resolved = this.context.services.get(Datasource) }
      }

      await loader.loadModule(manifest('repo'), { container: { Repository } })
      expect(resolved?.name).toBe('sql')
    })

    it('carries the module manifest, not the host one', async () => {
      let seen = ''

      @component()
      class Probe {
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) readonly context: ModuleContext) {}
        @activate() start(): void { seen = this.context.manifest.id }
      }

      await loader.loadModule(manifest('mine'), { container: { Probe } })
      expect(seen).toBe('mine')
    })

    it('gives each module its own', async () => {
      const seen: string[] = []

      @component()
      class Left {
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) readonly context: ModuleContext) {}
        @activate() start(): void { seen.push(this.context.manifest.id) }
      }
      @component()
      class Right {
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) readonly context: ModuleContext) {}
        @activate() start(): void { seen.push(this.context.manifest.id) }
      }

      await loader.loadModule(manifest('one'), { container: { Left } })
      await loader.loadModule(manifest('two'), { container: { Right } })

      expect(seen).toEqual(['one', 'two'])
    })

    it('registers through the module scope, so a teardown reaches it', async () => {
      @component()
      class Registrar {
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) readonly context: ModuleContext) {}
        @activate() start(): void {
          this.context.services.register('demo.late', { v: 1 })
        }
      }

      await loader.loadModule(manifest('registrar'), { container: { Registrar } })
      expect(loader.getServiceRegistry().has('demo.late')).toBe(true)

      // The context is the module's own scope, not the shared registry: what a
      // component registers through it goes when the module goes
      await loader.unloadModule('registrar')
      expect(loader.getServiceRegistry().has('demo.late')).toBe(false)
    })
  })

  describe('the whiteboard pattern it unblocks', () => {
    it('collects providers and resolves by id at call time', async () => {
      // The shape tsm#24 is after: one component, one collection, no hand-written
      // tracking, and a resolver that still works for anything not collected
      const REPOSITORY = serviceId<{ all(): string[]; resolve(id: string): unknown }>('demo.repo')

      @component({ service: [REPOSITORY] })
      class Repository {
        @injectAll(Datasource) private readonly sources: Datasource[] = []

        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) private readonly context: ModuleContext) {}

        all(): string[] { return this.sources.map(source => source.name) }
        resolve(id: string): unknown { return this.context.services.get(id) }
      }

      loader.getServiceRegistry().register(Datasource, { name: 'sql' }, { providedBy: 'a' })
      loader.getServiceRegistry().register('demo.other', { kind: 'other' })

      await loader.loadModule(manifest('repo'), { container: { Repository } })

      const repository = loader.getServiceRegistry().getRequired(REPOSITORY)
      expect(repository.all()).toEqual(['sql'])
      expect(repository.resolve('demo.other')).toEqual({ kind: 'other' })
    })

    it('keeps the collection current after construction', async () => {
      const REPOSITORY = serviceId<{ all(): string[] }>('demo.repo')

      @component({ service: [REPOSITORY] })
      class Repository {
        @injectAll(Datasource) private readonly sources: Datasource[] = []
        constructor(@inject(MODULE_CONTEXT_SERVICE_ID) readonly context: ModuleContext) {}
        all(): string[] { return this.sources.map(source => source.name) }
      }

      await loader.loadModule(manifest('repo'), { container: { Repository } })
      const repository = loader.getServiceRegistry().getRequired(REPOSITORY)
      expect(repository.all()).toEqual([])

      loader.getServiceRegistry().register(Datasource, { name: 'late' }, { providedBy: 'b' })
      await loader.settle()

      expect(repository.all()).toEqual(['late'])
    })
  })

  describe('asked for from outside a module', () => {
    it('refuses rather than answering with somebody else', () => {
      // Handing over another module's context would make a teardown release the
      // wrong registrations
      expect(() => loader.getServiceRegistry().getRequired(MODULE_CONTEXT_SERVICE_ID))
        .toThrow('per-module service')
    })
  })

  describe('what @activate already gave', () => {
    it('still hands the component context to the lifecycle', async () => {
      // Unchanged, and the closer analogue of DS 112.5.8 — this service is for the
      // constructional case only
      let pid: string | undefined
      let hasServices = false

      @component()
      class Probe {
        @activate() start(context: ComponentContext): void {
          pid = context.configurationPid
          hasServices = typeof context.services.get === 'function'
        }
      }

      await loader.loadModule(manifest('probe'), { container: { Probe } })
      expect(hasServices).toBe(true)
      expect(pid).toBeUndefined()
    })
  })
})

describe('a registry that cannot bind factories', () => {
  it('leaves the context absent instead of failing the loader', async () => {
    // A per-module answer needs a factory. A registry that only holds instances
    // is a legitimate minimal implementation, and the loader has to survive it
    const { DefaultServiceRegistry } = await import('../ServiceRegistry.js')
    const full = new DefaultServiceRegistry()
    const minimal = Object.create(full) as Record<string, unknown>
    minimal.bind = undefined

    const bare = new ModuleLoader({
      serviceRegistry: minimal as unknown as ConstructorParameters<
        typeof ModuleLoader
      >[0]['serviceRegistry']
    })

    expect(bare.getServiceRegistry().has(MODULE_CONTEXT_SERVICE_ID)).toBe(false)
  })
})
