/**
 * Factory components (Declarative Services 112.2.4).
 *
 * A component somebody instantiates by asking, rather than one the loader builds
 * from configuration. The distinction from a factory *configuration* is who
 * decides there should be another one: data, or a call.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader.js'
import { ConfigurationAdmin } from '../ConfigurationAdmin.js'
import { component, activate, deactivate, inject, objectClass } from '../index.js'
import {
  COMPONENT_FACTORY_SERVICE_ID,
  COMPONENT_FACTORY,
  COMPONENT_NAME,
  componentFactoryFilter
} from '../componentFactory.js'
import type { ComponentContext, ComponentFactory, ModuleManifest } from '../types.js'

const manifest = (id: string): ModuleManifest => ({
  id, version: '1.0.0', entry: `${id}.js`, provides: []
})

describe('factory components', () => {
  let loader: ModuleLoader

  beforeEach(() => {
    loader = new ModuleLoader()
  })

  const theFactory = (): ComponentFactory =>
    loader.getServiceRegistry().getMatching<ComponentFactory>(
      COMPONENT_FACTORY_SERVICE_ID, componentFactoryFilter('editor')
    )!

  describe('registration', () => {
    it('registers a factory rather than the component service', async () => {
      @component({ factory: 'editor', service: ['editor.instance'] })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })

      expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(true)
      // Nobody is meant to reach the template, only instances built from it
      expect(loader.getServiceRegistry().has('editor.instance')).toBe(false)
    })

    it('carries the factory name and the class name', async () => {
      @component({ factory: 'editor' })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const [reference] = loader.getServiceRegistry()
        .getServiceReferences(COMPONENT_FACTORY_SERVICE_ID)

      expect(reference.properties[COMPONENT_FACTORY]).toBe('editor')
      expect(reference.properties[COMPONENT_NAME]).toBe('Editor')
    })

    it('builds nothing until asked', async () => {
      const built = vi.fn()

      @component({ factory: 'editor' })
      class Editor {
        constructor() { built() }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      expect(built).not.toHaveBeenCalled()
    })

    it('withdraws the factory when the module unloads', async () => {
      @component({ factory: 'editor' })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await loader.unloadModule('ide')

      expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(false)
    })
  })

  describe('building instances', () => {
    it('builds one on request', async () => {
      @component({ factory: 'editor' })
      class Editor {
        opened = true
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()

      expect((handle.instance as Editor).opened).toBe(true)
    })

    it('builds a delayed component too', async () => {
      // The caller asked for the object, so handing back one that does not exist
      // yet would be no answer
      @component({ factory: 'editor' })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()

      expect(handle.instance).toBeDefined()
    })

    it('builds as many as asked for', async () => {
      @component({ factory: 'editor' })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const factory = theFactory()
      const one = await factory.newInstance()
      const two = await factory.newInstance()

      expect(one.instance).not.toBe(two.instance)
      expect(factory.instances).toHaveLength(2)
    })

    it('runs @activate on each', async () => {
      const started: string[] = []

      @component({ factory: 'editor' })
      class Editor {
        @activate() start(context: ComponentContext): void {
          started.push(String(context.configuration.file))
        }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const factory = theFactory()
      await factory.newInstance({ file: 'a.ts' })
      await factory.newInstance({ file: 'b.ts' })

      expect(started).toEqual(['a.ts', 'b.ts'])
    })

    it('hands the caller properties to the instance as its configuration', async () => {
      let seen: unknown
      @component({ factory: 'editor' })
      class Editor {
        @activate() start(context: ComponentContext): void { seen = context.configuration.file }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await theFactory().newInstance({ file: 'a.ts' })

      expect(seen).toBe('a.ts')
    })

    it('applies the declared defaults underneath', async () => {
      const schema = objectClass({
        id: 'editor',
        name: 'Editor',
        attributes: { theme: { type: 'string' as const, default: 'dark' } }
      })

      loader = new ModuleLoader({ metatype: new (await import('../Metatype.js')).MetatypeRegistry() })

      let seen: Record<string, unknown> = {}
      @component({ factory: 'editor', configurationSchema: schema })
      class Editor {
        @activate() start(context: ComponentContext): void { seen = { ...context.configuration } }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await theFactory().newInstance({ file: 'a.ts' })

      expect(seen.theme).toBe('dark')
      expect(seen.file).toBe('a.ts')
    })

    it('registers the instance services with the caller properties', async () => {
      @component({ factory: 'editor', service: ['editor.instance'] })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await theFactory().newInstance({ file: 'a.ts' })

      // Reachable by anyone filtering on those properties, not only the caller
      expect(loader.getServiceRegistry()
        .countProviders('editor.instance', '(file=a.ts)')).toBe(1)
    })

    it('keeps several instances under one service id apart', async () => {
      @component({ factory: 'editor', service: ['editor.instance'] })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const factory = theFactory()
      await factory.newInstance({ file: 'a.ts' })
      await factory.newInstance({ file: 'b.ts' })

      expect(loader.getServiceRegistry().countProviders('editor.instance')).toBe(2)
    })

    it('injects into each instance', async () => {
      loader.getServiceRegistry().register('workspace', { root: '/tmp' })

      @component({ factory: 'editor' })
      class Editor {
        constructor(@inject('workspace') readonly workspace: { root: string }) {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()

      expect((handle.instance as Editor).workspace.root).toBe('/tmp')
    })
  })

  describe('disposing', () => {
    it('runs @deactivate and withdraws the services', async () => {
      const stopped = vi.fn()

      @component({ factory: 'editor', service: ['editor.instance'] })
      class Editor {
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()
      await handle.dispose()

      expect(stopped).toHaveBeenCalledOnce()
      expect(loader.getServiceRegistry().has('editor.instance')).toBe(false)
    })

    it('leaves the other instances alone', async () => {
      @component({ factory: 'editor', service: ['editor.instance'] })
      class Editor {}

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const factory = theFactory()
      const one = await factory.newInstance({ file: 'a.ts' })
      await factory.newInstance({ file: 'b.ts' })

      await one.dispose()

      expect(factory.instances).toHaveLength(1)
      expect(loader.getServiceRegistry().countProviders('editor.instance')).toBe(1)
    })

    it('is harmless a second time', async () => {
      const stopped = vi.fn()
      @component({ factory: 'editor' })
      class Editor {
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()
      await handle.dispose()
      await handle.dispose()

      expect(stopped).toHaveBeenCalledOnce()
    })

    it('disposes what is left when the module unloads', async () => {
      const stopped = vi.fn()
      @component({ factory: 'editor' })
      class Editor {
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const factory = theFactory()
      await factory.newInstance()
      await factory.newInstance()

      await loader.unloadModule('ide')
      expect(stopped).toHaveBeenCalledTimes(2)
    })

    it('leaves a caller dispose() harmless after the module went', async () => {
      @component({ factory: 'editor' })
      class Editor {
        @deactivate() stop(): void {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      const handle = await theFactory().newInstance()
      await loader.unloadModule('ide')

      await expect(handle.dispose()).resolves.toBeUndefined()
    })
  })

  describe('satisfaction', () => {
    it('registers no factory while a mandatory reference is missing', async () => {
      @component({ factory: 'editor' })
      class Editor {
        constructor(@inject('workspace') readonly workspace: unknown) {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })

      // Nobody can ask for an instance of something that cannot run
      expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(false)
    })

    it('registers it when the reference arrives', async () => {
      @component({ factory: 'editor' })
      class Editor {
        constructor(@inject('workspace') readonly workspace: unknown) {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      loader.getServiceRegistry().register('workspace', {})
      await loader.settle()

      expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(true)
    })

    it('withdraws factory and instances when the reference goes', async () => {
      const stopped = vi.fn()
      const registration = loader.getServiceRegistry().register('workspace', {})

      @component({ factory: 'editor' })
      class Editor {
        constructor(@inject('workspace') readonly workspace: unknown) {}
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await theFactory().newInstance()

      registration.unregister()
      await loader.settle()

      expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(false)
      expect(stopped).toHaveBeenCalledOnce()
    })

    it('does not bring the old instances back when it is satisfied again', async () => {
      const registration = loader.getServiceRegistry().register('workspace', {})

      @component({ factory: 'editor' })
      class Editor {
        constructor(@inject('workspace') readonly workspace: unknown) {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })
      await theFactory().newInstance()

      registration.unregister()
      await loader.settle()
      loader.getServiceRegistry().register('workspace', {})
      await loader.settle()

      // Re-creating them would be inventing state nobody asked for twice
      expect(theFactory().instances).toHaveLength(0)
    })
  })

  describe('not to be confused with a factory configuration', () => {
    it('ignores configuration under its own PID', async () => {
      const admin = new ConfigurationAdmin()
      loader = new ModuleLoader({ configurationAdmin: admin })
      await admin.getConfiguration('Editor').update({ theme: 'light' })

      @component({ factory: 'editor' })
      class Editor {
        @activate() start(): void {}
      }

      await loader.loadModule(manifest('ide'), { container: { Editor } })

      // Instances are configured by their caller, not by a PID
      expect(theFactory().instances).toHaveLength(0)
    })
  })
})

describe('a factory component that requires configuration', () => {
  it('is warned about, and runs anyway', async () => {
    const warn = vi.fn()
    const loader = new ModuleLoader({
      logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
    })

    @component({ factory: 'editor', configurationPolicy: 'require' })
    class Editor {}

    await loader.loadModule(manifest('ide'), { container: { Editor } })

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("configurationPolicy 'require' does not apply")
    )
    expect(loader.getServiceRegistry().has(COMPONENT_FACTORY_SERVICE_ID)).toBe(true)
  })
})
