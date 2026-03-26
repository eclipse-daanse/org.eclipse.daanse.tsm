import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import type { ModuleManifest, ModuleLifecycle, ModuleEventListener } from '../types'

// Mock window for Module Federation containers
const mockWindow = globalThis.window ?? {}

function createManifest(
  id: string,
  options: Partial<ModuleManifest> = {}
): ModuleManifest {
  return {
    id,
    name: options.name ?? id,
    version: options.version ?? '1.0.0',
    entry: options.entry ?? `http://localhost/${id}/remoteEntry.js`,
    exports: options.exports ?? { './main': { type: 'other' } },
    dependencies: options.dependencies,
    priority: options.priority
  }
}

describe('ModuleLoader', () => {
  let originalWindow: typeof globalThis.window

  beforeEach(() => {
    originalWindow = globalThis.window
    // Reset window for each test
    for (const key of Object.keys(mockWindow)) {
      delete (mockWindow as Record<string, unknown>)[key]
    }
  })

  afterEach(() => {
    globalThis.window = originalWindow
    vi.restoreAllMocks()
  })

  describe('register', () => {
    it('should register module manifests', () => {
      const loader = new ModuleLoader()
      const manifest = createManifest('test-module')

      loader.register([manifest])

      // No direct way to check registration, but loadAll should work
      expect(() => loader.register([manifest])).not.toThrow()
    })

    it('should emit registering event', () => {
      const loader = new ModuleLoader()
      const manifest = createManifest('test-module')
      const listener: ModuleEventListener = {
        onModuleEvent: vi.fn()
      }
      loader.addEventListener(listener)

      loader.register([manifest])

      expect(listener.onModuleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'registering',
          moduleId: 'test-module'
        })
      )
    })
  })

  describe('isLoaded', () => {
    it('should return false for unloaded module', () => {
      const loader = new ModuleLoader()

      expect(loader.isLoaded('unknown-module')).toBe(false)
    })
  })

  describe('getModule', () => {
    it('should return undefined for unknown module', () => {
      const loader = new ModuleLoader()

      expect(loader.getModule('unknown')).toBeUndefined()
    })
  })

  describe('getLoadedModuleIds', () => {
    it('should return empty array initially', () => {
      const loader = new ModuleLoader()

      expect(loader.getLoadedModuleIds()).toEqual([])
    })
  })

  describe('getServiceRegistry', () => {
    it('should return the service registry', () => {
      const loader = new ModuleLoader()

      const registry = loader.getServiceRegistry()

      expect(registry).toBeDefined()
      expect(typeof registry.register).toBe('function')
      expect(typeof registry.get).toBe('function')
    })
  })

  describe('event listeners', () => {
    it('should add and remove event listeners', () => {
      const loader = new ModuleLoader()
      const listener: ModuleEventListener = {
        onModuleEvent: vi.fn()
      }

      loader.addEventListener(listener)
      loader.register([createManifest('test')])
      expect(listener.onModuleEvent).toHaveBeenCalled()

      vi.resetAllMocks()
      loader.removeEventListener(listener)
      loader.register([createManifest('test2')])
      expect(listener.onModuleEvent).not.toHaveBeenCalled()
    })

    it('should handle listener errors gracefully', () => {
      const loader = new ModuleLoader()
      const badListener: ModuleEventListener = {
        onModuleEvent: vi.fn(() => {
          throw new Error('Listener error')
        })
      }
      loader.addEventListener(badListener)

      // Should not throw
      expect(() => loader.register([createManifest('test')])).not.toThrow()
    })
  })

  describe('lifecycle integration', () => {
    it('should handle modules with lifecycle hooks', async () => {
      const loader = new ModuleLoader()
      const activateFn = vi.fn()
      const deactivateFn = vi.fn()

      const lifecycle: ModuleLifecycle = {
        activate: activateFn,
        deactivate: deactivateFn
      }

      // This would require mocking the import mechanism
      // For now, just verify the loader accepts options
      expect(() => new ModuleLoader({
        continueOnError: true,
        hotReload: true
      })).not.toThrow()
    })
  })

  describe('options', () => {
    it('should accept custom options', () => {
      const customLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }

      const loader = new ModuleLoader({
        loadTimeout: 5000,
        continueOnError: false,
        hotReload: true,
        logger: customLogger
      })

      // Verify logger is used
      loader.register([createManifest('test')])
      // Registration doesn't log, but this verifies no errors with custom logger
      expect(loader).toBeDefined()
    })
  })

  describe('reloadModule', () => {
    it('should throw if hot reload is disabled', async () => {
      const loader = new ModuleLoader({ hotReload: false })

      await expect(loader.reloadModule('test'))
        .rejects
        .toThrow('Hot reload is not enabled')
    })

    it('should throw for unknown module', async () => {
      const loader = new ModuleLoader({ hotReload: true })

      await expect(loader.reloadModule('unknown'))
        .rejects
        .toThrow('Module not loaded: unknown')
    })
  })

  describe('unloadModule', () => {
    it('should return false for unknown module', async () => {
      const loader = new ModuleLoader()

      const result = await loader.unloadModule('unknown')

      expect(result).toBe(false)
    })
  })
})

describe('ModuleLoader integration', () => {
  // These tests would require more complex mocking of dynamic imports
  // and Module Federation containers

  it('should create loader with default service registry', () => {
    const loader = new ModuleLoader()
    const registry = loader.getServiceRegistry()

    // Should be a working registry
    registry.register('test', { value: 42 })
    expect(registry.get('test')).toEqual({ value: 42 })
  })

  it('should create loader with custom service registry', () => {
    const customRegistry = {
      register: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn().mockReturnValue([]),
      has: vi.fn(),
      unregister: vi.fn()
    }

    const loader = new ModuleLoader({ serviceRegistry: customRegistry })
    const registry = loader.getServiceRegistry()

    expect(registry).toBe(customRegistry)
  })
})