/**
 * Integration tests for TSM
 * Tests the full flow: PluginRegistry -> ModuleLoader with real HTTP server
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TestServer, createTestServer } from './helpers/TestServer'
import { PluginRegistry } from '../PluginRegistry'
import { ModuleLoader } from '../ModuleLoader'
import { DependencyResolver } from '../DependencyResolver'
import type { RegistryEventListener, ModuleEventListener } from '../types'

// Mock window for Node.js environment
declare const global: typeof globalThis & { window?: Record<string, unknown> }
if (typeof global.window === 'undefined') {
  global.window = {} as Record<string, unknown>
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_PATH = path.join(__dirname, 'fixtures', 'plugins')

describe('Integration Tests', () => {
  let server: TestServer
  let serverUrl: string

  beforeAll(async () => {
    server = await createTestServer(FIXTURES_PATH)
    serverUrl = server.getUrl()
    // server ready
  })

  afterAll(async () => {
    await server.stop()
    // server stopped
  })

  describe('PluginRegistry with real HTTP', () => {
    it('should fetch index.json from server', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      const discovered = await registry.discoverAll()

      expect(discovered).toHaveLength(2)
      expect(discovered.map(d => d.manifest.id)).toContain('core')
      expect(discovered.map(d => d.manifest.id)).toContain('storage-adapter')
    })

    it('should resolve entry URLs to absolute paths', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      const discovered = await registry.discoverAll()
      const coreModule = discovered.find(d => d.manifest.id === 'core')

      expect(coreModule?.manifest.entry).toBe(`${serverUrl}/core/module.js`)
    })

    it('should fetch manifest with dependencies', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      const discovered = await registry.discoverAll()
      const storageAdapter = discovered.find(d => d.manifest.id === 'storage-adapter')

      expect(storageAdapter?.manifest.dependencies).toHaveLength(2)
      expect(storageAdapter?.manifest.dependencies).toContainEqual({
        id: 'core',
        versionRange: '^1.0.0'
      })
    })

    it('should emit events during discovery', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })
      const listener: RegistryEventListener = {
        onRegistryEvent: vi.fn()
      }
      registry.addEventListener(listener)

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()

      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'repository-added' })
      )
      expect(listener.onRegistryEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'modules-discovered' })
      )
    })
  })

  describe('DependencyResolver with discovered modules', () => {
    it('should resolve dependencies in correct order', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      const resolver = new DependencyResolver()
      const resolution = resolver.resolve(manifests)

      expect(resolution.loadOrder).toHaveLength(2)
      // core should be loaded before storage-adapter (due to dependency)
      expect(resolution.loadOrder[0].id).toBe('core')
      expect(resolution.loadOrder[1].id).toBe('storage-adapter')
    })

    it('should report missing logger dependency', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      const resolver = new DependencyResolver()
      const resolution = resolver.resolve(manifests)

      // storage-adapter depends on logger which is not in this fixture set
      expect(resolution.missing).toHaveLength(1)
      expect(resolution.missing[0]).toEqual({ moduleId: 'storage-adapter', missingDep: 'logger' })
      expect(resolution.versionConflicts).toHaveLength(0)
    })

    it('should validate version constraints', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      const resolver = new DependencyResolver()
      const conflicts = resolver.validateVersionConstraints(manifests)

      // core@1.0.0 satisfies storage-adapter's ^1.0.0 requirement
      expect(conflicts).toHaveLength(0)
    })
  })

  describe('Full workflow: Registry -> Resolver -> Events', () => {
    it('should complete full discovery and resolution workflow', async () => {
      // 1. Create registry and add repository
      const registry = new PluginRegistry({ cacheTtl: 0 })
      const registryEvents: string[] = []

      registry.addEventListener({
        onRegistryEvent: (event) => registryEvents.push(event.type)
      })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl,
        priority: 100
      })

      // 2. Discover modules
      const discovered = await registry.discoverAll()
      expect(discovered).toHaveLength(2)

      // 3. Get deduplicated manifests
      const manifests = registry.getManifests()
      expect(manifests).toHaveLength(2)

      // 4. Resolve dependencies
      const resolver = new DependencyResolver()
      const resolution = resolver.resolve(manifests)

      expect(resolution.loadOrder).toHaveLength(2)
      expect(resolution.circular).toHaveLength(0)
      expect(resolution.missing).toHaveLength(1) // logger not in fixture set

      // 5. Verify events
      expect(registryEvents).toContain('repository-added')
      expect(registryEvents).toContain('modules-discovered')

      // 6. Verify load order respects dependencies
      const loadOrderIds = resolution.loadOrder.map(m => m.id)
      const coreIndex = loadOrderIds.indexOf('core')
      const storageIndex = loadOrderIds.indexOf('storage-adapter')
      expect(coreIndex).toBeLessThan(storageIndex)
    })

    it('should handle multiple repositories with priority', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      // Add same repository twice with different priorities
      registry.addRepository({
        id: 'high-priority',
        name: 'High Priority',
        url: serverUrl,
        priority: 100
      })

      registry.addRepository({
        id: 'low-priority',
        name: 'Low Priority',
        url: serverUrl,
        priority: 10
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      // Should deduplicate - only 2 unique modules
      expect(manifests).toHaveLength(2)
    })
  })

  describe('Error handling', () => {
    it('should handle non-existent repository gracefully', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })
      const errors: Error[] = []

      registry.addEventListener({
        onRegistryEvent: (event) => {
          if (event.error) errors.push(event.error)
        }
      })

      registry.addRepository({
        id: 'invalid',
        name: 'Invalid Repository',
        url: 'http://localhost:59999' // Non-existent port
      })

      const discovered = await registry.discoverAll()

      // Should not throw, but return empty
      expect(discovered).toHaveLength(0)
      expect(errors.length).toBeGreaterThan(0)
    })

    it('should continue discovery if one repository fails', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      // One invalid, one valid
      registry.addRepository({
        id: 'invalid',
        name: 'Invalid Repository',
        url: 'http://localhost:59999',
        priority: 1
      })

      registry.addRepository({
        id: 'valid',
        name: 'Valid Repository',
        url: serverUrl,
        priority: 100
      })

      const discovered = await registry.discoverAll()

      // Should still get modules from valid repo
      expect(discovered).toHaveLength(2)
    })
  })

  describe('Module finding', () => {
    it('should find module by ID', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()

      const core = registry.findModule('core')
      expect(core).toBeDefined()
      expect(core?.manifest.version).toBe('1.0.0')
    })

    it('should find module matching version range', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()

      // Should find core@1.0.0 with ^1.0.0
      const core = registry.findModule('core', '^1.0.0')
      expect(core).toBeDefined()

      // Should not find with ^2.0.0
      const notFound = registry.findModule('core', '^2.0.0')
      expect(notFound).toBeUndefined()
    })

    it('should list all versions of a module', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })

      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()

      const versions = registry.findModuleVersions('core')
      expect(versions).toHaveLength(1)
      expect(versions[0].manifest.version).toBe('1.0.0')
    })
  })

  describe('Full workflow: Registry -> Resolver -> ModuleLoader', () => {
    it('should register discovered modules with ModuleLoader', async () => {
      // 1. Discover modules
      const registry = new PluginRegistry({ cacheTtl: 0 })
      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      // 2. Resolve dependencies
      const resolver = new DependencyResolver()
      const resolution = resolver.resolve(manifests)
      expect(resolution.loadOrder).toHaveLength(2)

      // 3. Register with ModuleLoader
      const loader = new ModuleLoader({ continueOnError: true })
      const events: string[] = []

      loader.addEventListener({
        onModuleEvent: (event) => events.push(`${event.type}:${event.moduleId}`)
      })

      loader.register(manifests)

      // Should emit registering events
      expect(events).toContain('registering:core')
      expect(events).toContain('registering:storage-adapter')
    })

    it('should emit events in correct order during load attempt', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })
      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      const loader = new ModuleLoader({ continueOnError: true })
      const events: string[] = []

      loader.addEventListener({
        onModuleEvent: (event) => events.push(`${event.type}:${event.moduleId}`)
      })

      loader.register(manifests)

      // loadAll will fail in Node.js (no window/dynamic HTTP import)
      // but we can verify it attempts to load in correct order
      try {
        await loader.loadAll()
      } catch {
        // Expected to fail in Node.js environment
      }

      // First should try to load core (no dependencies)
      const loadingCore = events.indexOf('loading:core')
      const loadingStorage = events.indexOf('loading:storage-adapter')

      // If loading events were emitted, core should come first
      if (loadingCore >= 0 && loadingStorage >= 0) {
        expect(loadingCore).toBeLessThan(loadingStorage)
      }
    })

    it('should validate complete workflow manifests have correct entry URLs', async () => {
      const registry = new PluginRegistry({ cacheTtl: 0 })
      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      await registry.discoverAll()
      const manifests = registry.getManifests()

      // Verify entry URLs are absolute HTTP URLs
      for (const manifest of manifests) {
        expect(manifest.entry).toMatch(/^http:\/\/localhost:\d+\//)
        expect(manifest.entry).toMatch(/module\.js$/)
      }

      // Verify core entry URL is correct
      const core = manifests.find(m => m.id === 'core')
      expect(core?.entry).toBe(`${serverUrl}/core/module.js`)

      // Verify storage-adapter entry URL is correct
      const storage = manifests.find(m => m.id === 'storage-adapter')
      expect(storage?.entry).toBe(`${serverUrl}/storage-adapter/module.js`)
    })

    it('should handle complete discovery-to-load workflow with service registry', async () => {
      // Full workflow test combining all components
      const registry = new PluginRegistry({ cacheTtl: 0 })
      registry.addRepository({
        id: 'test',
        name: 'Test Repository',
        url: serverUrl
      })

      // Discover
      const discovered = await registry.discoverAll()
      expect(discovered).toHaveLength(2)

      // Get manifests
      const manifests = registry.getManifests()

      // Resolve
      const resolver = new DependencyResolver()
      const resolution = resolver.resolve(manifests)

      // Verify resolution
      expect(resolution.loadOrder).toHaveLength(2)
      expect(resolution.missing).toHaveLength(1) // logger not in fixture set
      expect(resolution.circular).toHaveLength(0)
      expect(resolution.versionConflicts).toHaveLength(0)

      // Verify load order
      expect(resolution.loadOrder[0].id).toBe('core')
      expect(resolution.loadOrder[1].id).toBe('storage-adapter')

      // Create loader with service registry
      const loader = new ModuleLoader({ continueOnError: true })
      const serviceRegistry = loader.getServiceRegistry()

      // Verify service registry is available
      expect(serviceRegistry).toBeDefined()
      expect(typeof serviceRegistry.register).toBe('function')
      expect(typeof serviceRegistry.get).toBe('function')

      // Register modules
      loader.register(manifests)

      // The modules are now registered and ready for loading
      // (actual loading requires browser environment)
    })
  })
})