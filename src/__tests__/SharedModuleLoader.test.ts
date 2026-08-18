import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SharedModuleLoader } from '../SharedModuleLoader'
import type { ModuleLogger } from '../types'

interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

function silentLogger(): ModuleLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('SharedModuleLoader', () => {
  let savedWindow: Record<string, unknown> | undefined

  beforeEach(() => {
    savedWindow = globalRef.window
    globalRef.window = {}
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  describe('registration', () => {
    it('should take modules from the constructor', () => {
      const loader = new SharedModuleLoader({
        modules: [
          { name: '@gene/storage-core', factory: async () => ({}) },
          { name: '@gene/ui', factory: async () => ({}) }
        ],
        logger: silentLogger()
      })

      expect(loader.getSharedModuleNames()).toEqual(['@gene/storage-core', '@gene/ui'])
      expect(loader.isShared('@gene/ui')).toBe(true)
      expect(loader.isShared('unknown')).toBe(false)
    })

    it('should accept modules added afterwards', () => {
      const loader = new SharedModuleLoader({ modules: [], logger: silentLogger() })

      loader.addModule({ name: 'late', factory: async () => ({}) })

      expect(loader.isShared('late')).toBe(true)
    })

    it('should replace a module registered under the same name', () => {
      const loader = new SharedModuleLoader({ modules: [], logger: silentLogger() })
      loader.addModule({ name: 'dup', factory: async () => ({ v: 1 }) })
      loader.addModule({ name: 'dup', factory: async () => ({ v: 2 }) })

      expect(loader.getSharedModuleNames()).toEqual(['dup'])
    })

    it('should work without options at all', () => {
      expect(() => new SharedModuleLoader()).not.toThrow()
      expect(new SharedModuleLoader().getSharedModuleNames()).toEqual([])
    })
  })

  describe('loadAll', () => {
    it('should resolve every factory and expose the result', async () => {
      const storage = { save: () => {} }
      const loader = new SharedModuleLoader({
        modules: [{ name: '@gene/storage-core', factory: async () => storage }],
        logger: silentLogger()
      })

      await loader.loadAll()

      expect(loader.isLoaded('@gene/storage-core')).toBe(true)
      expect(loader.get('@gene/storage-core')).toBe(storage)
      expect(globalRef.window!.__TSM_SHARED__).toEqual({ '@gene/storage-core': storage })
    })

    it('should load modules concurrently', async () => {
      const order: string[] = []
      const loader = new SharedModuleLoader({
        modules: [
          {
            name: 'slow',
            factory: async () => {
              await new Promise(resolve => setTimeout(resolve, 20))
              order.push('slow')
              return {}
            }
          },
          {
            name: 'fast',
            factory: async () => {
              order.push('fast')
              return {}
            }
          }
        ],
        logger: silentLogger()
      })

      await loader.loadAll()

      // Concurrent, so the fast one finishes first despite being declared second
      expect(order).toEqual(['fast', 'slow'])
    })

    it('should not load a second time', async () => {
      const factory = vi.fn().mockResolvedValue({})
      const loader = new SharedModuleLoader({
        modules: [{ name: 'once', factory }],
        logger: silentLogger()
      })

      await loader.loadAll()
      await loader.loadAll()

      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('should propagate a failing factory and log it', async () => {
      const logger = silentLogger()
      const loader = new SharedModuleLoader({
        modules: [{ name: 'broken', factory: async () => { throw new Error('boom') } }],
        logger
      })

      await expect(loader.loadAll()).rejects.toThrow('boom')
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to load shared module: broken',
        expect.any(Error)
      )
      expect(loader.isLoaded('broken')).toBe(false)
    })

    it('should report an unloaded module as undefined', async () => {
      const loader = new SharedModuleLoader({
        modules: [{ name: 'pending', factory: async () => ({}) }],
        logger: silentLogger()
      })

      expect(loader.isLoaded('pending')).toBe(false)
      expect(loader.get('pending')).toBeUndefined()
    })
  })

  describe('global access', () => {
    it('should read a shared module off the global namespace', async () => {
      const storage = { save: () => {} }
      const loader = new SharedModuleLoader({
        modules: [{ name: '@gene/storage-core', factory: async () => storage }],
        logger: silentLogger()
      })
      await loader.loadAll()

      expect(SharedModuleLoader.getGlobal('@gene/storage-core')).toBe(storage)
      expect(SharedModuleLoader.getGlobal('unknown')).toBeUndefined()
    })

    it('should return undefined without a window', () => {
      delete globalRef.window

      expect(SharedModuleLoader.getGlobal('anything')).toBeUndefined()
    })

    it('should keep an existing global namespace', () => {
      globalRef.window = { __TSM_SHARED__: { existing: { id: 'kept' } } }

      new SharedModuleLoader({ modules: [], logger: silentLogger() })

      expect(SharedModuleLoader.getGlobal('existing')).toEqual({ id: 'kept' })
    })
  })
})
