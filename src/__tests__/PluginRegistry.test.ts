import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginRegistry } from '../PluginRegistry'
import type {
  PluginRepository,
  RepositoryIndex,
  ModuleManifest,
  RegistryEventListener
} from '../types'

// Mock data
const mockIndex: RepositoryIndex = {
  name: 'Test Repository',
  description: 'Test repo',
  version: '1.0.0',
  modules: ['module-a', 'module-b'],
  updatedAt: new Date().toISOString()
}

const mockManifestA: ModuleManifest = {
  id: 'module-a',
  name: 'Module A',
  version: '1.0.0',
  entry: 'remoteEntry.js',
  exports: { './main': { type: 'service' } }
}

const mockManifestB: ModuleManifest = {
  id: 'module-b',
  name: 'Module B',
  version: '2.0.0',
  entry: 'remoteEntry.js',
  exports: { './main': { type: 'adapter' } },
  dependencies: ['module-a']
}

function createMockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const data = responses[url]
    if (data === undefined) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => data
    } as Response
  })
}

const testRepo: PluginRepository = {
  id: 'test-repo',
  name: 'Test Repository',
  url: 'https://plugins.example.com',
  enabled: true,
  priority: 10
}

describe('PluginRegistry', () => {
  describe('repository management', () => {
    it('should add a repository', () => {
      const registry = new PluginRegistry()

      registry.addRepository(testRepo)

      expect(registry.getRepositories()).toHaveLength(1)
      expect(registry.getRepository('test-repo')).toEqual({
        ...testRepo,
        url: 'https://plugins.example.com' // trailing slash removed
      })
    })

    it('should remove trailing slash from URL', () => {
      const registry = new PluginRegistry()

      registry.addRepository({
        ...testRepo,
        url: 'https://plugins.example.com/'
      })

      expect(registry.getRepository('test-repo')?.url).toBe('https://plugins.example.com')
    })

    it('should remove a repository', () => {
      const registry = new PluginRegistry()
      registry.addRepository(testRepo)

      const result = registry.removeRepository('test-repo')

      expect(result).toBe(true)
      expect(registry.getRepositories()).toHaveLength(0)
    })

    it('should return false when removing non-existent repo', () => {
      const registry = new PluginRegistry()

      const result = registry.removeRepository('non-existent')

      expect(result).toBe(false)
    })

    it('should emit events on add/remove', () => {
      const registry = new PluginRegistry()
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }
      registry.addEventListener(listener)

      registry.addRepository(testRepo)
      registry.removeRepository('test-repo')

      expect(listener.onRegistryEvent).toHaveBeenCalledTimes(2)
      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'repository-added' })
      )
      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'repository-removed' })
      )
    })
  })

  describe('discovery', () => {
    it('should discover modules from repository', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)

      const discovered = await registry.discoverAll()

      expect(discovered).toHaveLength(2)
      expect(discovered[0].manifest.id).toBe('module-a')
      expect(discovered[1].manifest.id).toBe('module-b')
    })

    it('should resolve relative entry URLs to absolute', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)

      const discovered = await registry.discoverAll()

      expect(discovered[0].manifest.entry).toBe(
        'https://plugins.example.com/module-a/remoteEntry.js'
      )
    })

    it('should skip modules with invalid manifests', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': { invalid: true },
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)

      const discovered = await registry.discoverAll()

      expect(discovered).toHaveLength(1)
      expect(discovered[0].manifest.id).toBe('module-b')
    })

    it('should emit discovery events', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }
      registry.addEventListener(listener)
      registry.addRepository(testRepo)

      await registry.discoverAll()

      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'modules-discovered',
          modules: expect.arrayContaining([
            expect.objectContaining({
              manifest: expect.objectContaining({ id: 'module-a' })
            })
          ])
        })
      )
    })

    it('should emit error events on failure', async () => {
      const mockFetch = createMockFetch({})

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }
      registry.addEventListener(listener)
      registry.addRepository(testRepo)

      await registry.discoverAll()

      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'discovery-error',
          error: expect.any(Error)
        })
      )
    })

    it('should only discover from enabled repositories', async () => {
      const mockFetch = createMockFetch({
        'https://enabled.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://enabled.example.com/module-a/manifest.json': mockManifestA
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository({
        id: 'enabled',
        name: 'Enabled',
        url: 'https://enabled.example.com',
        enabled: true
      })
      registry.addRepository({
        id: 'disabled',
        name: 'Disabled',
        url: 'https://disabled.example.com',
        enabled: false
      })

      const discovered = await registry.discoverAll()

      expect(discovered).toHaveLength(1)
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('disabled.example.com'),
        expect.anything()
      )
    })
  })

  describe('getManifests', () => {
    it('should return deduplicated manifests', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)
      await registry.discoverAll()

      const manifests = registry.getManifests()

      expect(manifests).toHaveLength(2)
    })

    it('should prefer higher version from same priority repo', async () => {
      const v1 = { ...mockManifestA, version: '1.0.0' }
      const v2 = { ...mockManifestA, version: '2.0.0' }

      const mockFetch = createMockFetch({
        'https://repo1.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://repo1.example.com/module-a/manifest.json': v1,
        'https://repo2.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://repo2.example.com/module-a/manifest.json': v2
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository({
        id: 'repo1',
        name: 'Repo 1',
        url: 'https://repo1.example.com',
        priority: 10
      })
      registry.addRepository({
        id: 'repo2',
        name: 'Repo 2',
        url: 'https://repo2.example.com',
        priority: 10
      })
      await registry.discoverAll()

      const manifests = registry.getManifests()

      expect(manifests).toHaveLength(1)
      expect(manifests[0].version).toBe('2.0.0')
    })

    it('should prefer higher priority repository', async () => {
      const lowPriorityHighVersion = { ...mockManifestA, version: '3.0.0' }
      const highPriorityLowVersion = { ...mockManifestA, version: '1.0.0' }

      const mockFetch = createMockFetch({
        'https://low-priority.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://low-priority.example.com/module-a/manifest.json': lowPriorityHighVersion,
        'https://high-priority.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://high-priority.example.com/module-a/manifest.json': highPriorityLowVersion
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository({
        id: 'low',
        name: 'Low Priority',
        url: 'https://low-priority.example.com',
        priority: 1
      })
      registry.addRepository({
        id: 'high',
        name: 'High Priority',
        url: 'https://high-priority.example.com',
        priority: 100
      })
      await registry.discoverAll()

      const manifests = registry.getManifests()

      expect(manifests).toHaveLength(1)
      expect(manifests[0].version).toBe('1.0.0') // From high priority repo
    })
  })

  describe('findModule', () => {
    let registry: PluginRegistry

    beforeEach(async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)
      await registry.discoverAll()
    })

    it('should find module by ID', () => {
      const found = registry.findModule('module-a')

      expect(found).toBeDefined()
      expect(found?.manifest.id).toBe('module-a')
    })

    it('should return undefined for unknown module', () => {
      const found = registry.findModule('unknown')

      expect(found).toBeUndefined()
    })

    it('should find module matching version range', () => {
      const found = registry.findModule('module-a', '^1.0.0')

      expect(found).toBeDefined()
      expect(found?.manifest.version).toBe('1.0.0')
    })

    it('should return undefined if no version matches', () => {
      const found = registry.findModule('module-a', '^2.0.0')

      expect(found).toBeUndefined()
    })
  })

  describe('findModuleVersions', () => {
    it('should find all versions of a module', async () => {
      const v1 = { ...mockManifestA, version: '1.0.0' }
      const v2 = { ...mockManifestA, version: '2.0.0' }

      const mockFetch = createMockFetch({
        'https://repo1.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://repo1.example.com/module-a/manifest.json': v1,
        'https://repo2.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://repo2.example.com/module-a/manifest.json': v2
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository({
        id: 'repo1',
        name: 'Repo 1',
        url: 'https://repo1.example.com'
      })
      registry.addRepository({
        id: 'repo2',
        name: 'Repo 2',
        url: 'https://repo2.example.com'
      })
      await registry.discoverAll()

      const versions = registry.findModuleVersions('module-a')

      expect(versions).toHaveLength(2)
      expect(versions[0].manifest.version).toBe('2.0.0') // Sorted descending
      expect(versions[1].manifest.version).toBe('1.0.0')
    })
  })

  describe('checkUpdates', () => {
    it('should detect available updates', async () => {
      const newVersion = { ...mockManifestA, version: '2.0.0' }

      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://plugins.example.com/module-a/manifest.json': newVersion
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)

      const loaded: ModuleManifest[] = [mockManifestA] // v1.0.0
      const updates = await registry.checkUpdates(loaded)

      expect(updates).toHaveLength(1)
      expect(updates[0].moduleId).toBe('module-a')
      expect(updates[0].currentVersion).toBe('1.0.0')
      expect(updates[0].availableVersion).toBe('2.0.0')
    })

    it('should not report if current is up to date', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://plugins.example.com/module-a/manifest.json': mockManifestA
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      registry.addRepository(testRepo)

      const loaded: ModuleManifest[] = [mockManifestA] // same version
      const updates = await registry.checkUpdates(loaded)

      expect(updates).toHaveLength(0)
    })

    it('should emit update-available event', async () => {
      const newVersion = { ...mockManifestA, version: '2.0.0' }

      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': { ...mockIndex, modules: ['module-a'] },
        'https://plugins.example.com/module-a/manifest.json': newVersion
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }
      registry.addEventListener(listener)
      registry.addRepository(testRepo)

      await registry.checkUpdates([mockManifestA])

      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'update-available',
          updates: expect.arrayContaining([
            expect.objectContaining({ moduleId: 'module-a' })
          ])
        })
      )
    })
  })

  describe('caching', () => {
    it('should cache fetched data', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({
        fetchFn: mockFetch,
        cacheTtl: 60000 // 1 minute
      })
      registry.addRepository(testRepo)

      // First discovery
      await registry.discoverAll()
      const callsAfterFirst = mockFetch.mock.calls.length

      // Second discovery (should use cache)
      await registry.discoverAll()

      expect(mockFetch.mock.calls.length).toBe(callsAfterFirst)
    })

    it('should clear cache when requested', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({
        fetchFn: mockFetch,
        cacheTtl: 60000
      })
      registry.addRepository(testRepo)

      await registry.discoverAll()
      const callsAfterFirst = mockFetch.mock.calls.length

      registry.clearCache()
      await registry.discoverAll()

      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsAfterFirst)
    })
  })

  describe('event listeners', () => {
    it('should handle listener errors gracefully', async () => {
      const mockFetch = createMockFetch({
        'https://plugins.example.com/index.json': mockIndex,
        'https://plugins.example.com/module-a/manifest.json': mockManifestA,
        'https://plugins.example.com/module-b/manifest.json': mockManifestB
      })

      const registry = new PluginRegistry({ fetchFn: mockFetch, cacheTtl: 0 })
      const badListener: RegistryEventListener = {
        onRegistryEvent: vi.fn(() => {
          throw new Error('Listener error')
        })
      }
      registry.addEventListener(badListener)
      registry.addRepository(testRepo)

      // Should not throw
      await expect(registry.discoverAll()).resolves.not.toThrow()
    })

    it('should remove listener', () => {
      const registry = new PluginRegistry()
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }

      registry.addEventListener(listener)
      registry.removeEventListener(listener)
      registry.addRepository(testRepo)

      expect(listener.onRegistryEvent).not.toHaveBeenCalled()
    })
  })
})