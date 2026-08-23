/**
 * Collection references and the field option (Declarative Services 112.3.9).
 *
 * Cardinality 0..n on a field, kept current while the component runs — and the
 * choice between assigning a new array and mutating the one it holds.
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader.js'
import { component, activate, injectAll, getInjectAllMetadata } from '../decorators.js'
import type { ModuleManifest } from '../types.js'

const manifest = (id: string): ModuleManifest => ({
  id, version: '1.0.0', entry: `${id}.js`, provides: []
})

interface Tile { name: string }

describe('collection references', () => {
  let loader: ModuleLoader

  beforeEach(() => {
    loader = new ModuleLoader()
  })

  describe('the decorator', () => {
    it('records what was declared', () => {
      class Map2D {
        @injectAll('tile.source', { target: '(kind=raster)', fieldOption: 'update' })
        sources: Tile[] = []
      }

      const [declared] = getInjectAllMetadata(Map2D)
      expect(declared.serviceId).toBe('tile.source')
      expect(declared.target).toBe('(kind=raster)')
      expect(declared.fieldOption).toBe('update')
    })

    it('defaults to replace', () => {
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
      }
      expect(getInjectAllMetadata(Map2D)[0].fieldOption).toBe('replace')
    })

    it('records several collections on one class', () => {
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @injectAll('overlay') overlays: Tile[] = []
      }
      expect(getInjectAllMetadata(Map2D).map(entry => entry.serviceId))
        .toEqual(['tile.source', 'overlay'])
    })
  })

  describe('collecting', () => {
    it('hands the component every provider', async () => {
      loader.getServiceRegistry().register('tile.source', { name: 'a' })

      let seen: Tile[] = []
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { seen = this.sources }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      expect(seen.map(tile => tile.name)).toEqual(['a'])
    })

    it('collects several providers of one id', async () => {
      const registry = loader.getServiceRegistry()
      // Distinct providers: two registrations from the same one replace rather
      // than accumulate, which is a different question than cardinality
      registry.register('tile.source', { name: 'a' }, { ranking: 1, providedBy: 'raster-mod' })
      registry.register('tile.source', { name: 'b' }, { ranking: 5, providedBy: 'vector-mod' })

      let seen: Tile[] = []
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { seen = this.sources }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      // Best first, as getServiceReferences orders them
      expect(seen.map(tile => tile.name)).toEqual(['b', 'a'])
    })

    it('starts with an empty collection when nothing provides', async () => {
      let seen: Tile[] | undefined
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { seen = this.sources }
      }

      // 0..n does not block: an empty collection is a satisfied reference
      await loader.loadModule(manifest('map'), { container: { Map2D } })
      expect(seen).toEqual([])
    })

    it('narrows by target filter', async () => {
      const registry = loader.getServiceRegistry()
      registry.register('tile.source', { name: 'raster' },
        { properties: { kind: 'raster' }, providedBy: 'raster-mod' })
      registry.register('tile.source', { name: 'vector' },
        { properties: { kind: 'vector' }, providedBy: 'vector-mod' })

      let seen: Tile[] = []
      @component()
      class Map2D {
        @injectAll('tile.source', { target: '(kind=raster)' }) sources: Tile[] = []
        @activate() start(): void { seen = this.sources }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      expect(seen.map(tile => tile.name)).toEqual(['raster'])
    })

    it('fills the collection before @activate runs', async () => {
      loader.getServiceRegistry().register('tile.source', { name: 'a' })

      let countAtActivate = -1
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { countAtActivate = this.sources.length }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      expect(countAtActivate).toBe(1)
    })
  })

  describe('staying current', () => {
    it('activates a component that only collects, so the collection stays current', async () => {
      /*
       * No @activate and no @bind - just the collection. Without counting a
       * collector as immediate it would stay a delayed instance record with
       * no object, and applyCollections() would have nothing to write into:
       * the collection stayed empty forever, however many providers came.
       */
      @component({ service: ['palette'] })
      class Palette {
        @injectAll('tile.source') sources: Tile[] = []
      }

      loader.getServiceRegistry().register('tile.source', { name: 'a' }, { providedBy: 'raster-mod' })
      await loader.loadModule(manifest('map'), { container: { Palette } })

      const palette = loader.getServiceRegistry().getRequired<Palette>('palette')
      expect(palette.sources.map(tile => tile.name)).toEqual(['a'])

      loader.getServiceRegistry().register('tile.source', { name: 'b' }, { providedBy: 'vector-mod' })
      await loader.settle()
      expect(palette.sources.map(tile => tile.name).sort()).toEqual(['a', 'b'])
    })

    it('grows when a provider arrives', async () => {
      const held: { current?: Map2D } = {}

      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      expect(held.current!.sources).toHaveLength(0)

      loader.getServiceRegistry().register('tile.source', { name: 'a' })
      await loader.settle()

      expect(held.current!.sources.map(tile => tile.name)).toEqual(['a'])
    })

    it('shrinks when a provider leaves', async () => {
      const registration = loader.getServiceRegistry().register('tile.source', { name: 'a' })

      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      registration.unregister()
      await loader.settle()

      expect(held.current!.sources).toHaveLength(0)
    })

    it('does not rebuild the component', async () => {
      const started = vi.fn()
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      loader.getServiceRegistry().register('tile.source', { name: 'a' })
      await loader.settle()

      // A collection change is absorbed, not a reason to start over
      expect(started).toHaveBeenCalledOnce()
    })
  })

  describe('the field option', () => {
    it('replaces the array by default', async () => {
      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      const before = held.current!.sources

      loader.getServiceRegistry().register('tile.source', { name: 'a' })
      await loader.settle()

      expect(held.current!.sources).not.toBe(before)
    })

    it('keeps the array identity with update', async () => {
      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source', { fieldOption: 'update' }) sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      const before = held.current!.sources

      loader.getServiceRegistry().register('tile.source', { name: 'a' })
      await loader.settle()

      // This is what a reactive view bound to the array needs: with `replace` a
      // template holding the old array would never see the change
      expect(held.current!.sources).toBe(before)
      expect(before.map(tile => tile.name)).toEqual(['a'])
    })

    it('empties the held array with update', async () => {
      const registration = loader.getServiceRegistry().register('tile.source', { name: 'a' })

      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source', { fieldOption: 'update' }) sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      const before = held.current!.sources

      registration.unregister()
      await loader.settle()

      expect(held.current!.sources).toBe(before)
      expect(before).toHaveLength(0)
    })

    it('warns and replaces when the field is not an array', async () => {
      const warn = vi.fn()
      loader = new ModuleLoader({
        logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
      })
      loader.getServiceRegistry().register('tile.source', { name: 'a' })

      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        // Nothing to mutate: there is no array yet
        @injectAll('tile.source', { fieldOption: 'update' }) sources!: Tile[]
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("initialise it with '= []'"))
      expect(held.current!.sources.map(tile => tile.name)).toEqual(['a'])
    })

    it('leaves the array alone when nothing changed', async () => {
      loader.getServiceRegistry().register('tile.source', { name: 'a' })

      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source') sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })
      const before = held.current!.sources

      // An unrelated service moving must not make a reactive view re-render
      loader.getServiceRegistry().register('something.else', {})
      await loader.settle()

      expect(held.current!.sources).toBe(before)
    })
  })

  describe('a bad target', () => {
    it('is reported and leaves the collection alone', async () => {
      const error = vi.fn()
      loader = new ModuleLoader({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error }
      })

      const held: { current?: Map2D } = {}
      @component()
      class Map2D {
        @injectAll('tile.source', { target: '(kind=' }) sources: Tile[] = []
        @activate() start(): void { held.current = this }
      }

      await loader.loadModule(manifest('map'), { container: { Map2D } })

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid target on Map2D.sources'),
        expect.anything()
      )
      expect(held.current!.sources).toEqual([])
    })
  })
})
