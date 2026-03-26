/**
 * TSM - TypeScript Module System
 * Plugin Registry - Discovers and manages modules from remote repositories
 */

import * as semver from 'semver'
import type {
  ModuleManifest,
  ModuleLogger,
  PluginRepository,
  PluginRegistryOptions,
  RepositoryIndex,
  DiscoveredModule,
  ModuleUpdate,
  RegistryEvent,
  RegistryEventListener
} from './types'

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<PluginRegistryOptions> = {
  fetchTimeout: 10000,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  logger: undefined as unknown as ModuleLogger,
  cacheTtl: 5 * 60 * 1000 // 5 minutes
}

/**
 * Console logger implementation
 */
class ConsoleLogger implements ModuleLogger {
  constructor(private prefix: string = '[TSM Registry]') {}

  debug(message: string, ...args: unknown[]): void {
    console.debug(`${this.prefix} ${message}`, ...args)
  }
  info(message: string, ...args: unknown[]): void {
    console.info(`${this.prefix} ${message}`, ...args)
  }
  warn(message: string, ...args: unknown[]): void {
    console.warn(`${this.prefix} ${message}`, ...args)
  }
  error(message: string, ...args: unknown[]): void {
    console.error(`${this.prefix} ${message}`, ...args)
  }
}

/**
 * Cache entry
 */
interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Plugin Registry - Manages remote plugin repositories
 *
 * Repository Structure:
 * ```
 * https://plugins.example.com/
 * ├── index.json           # RepositoryIndex with module list
 * ├── module-a/
 * │   ├── manifest.json    # ModuleManifest
 * │   └── remoteEntry.js   # Module entry point
 * └── module-b/
 *     ├── manifest.json
 *     └── remoteEntry.js
 * ```
 */
export class PluginRegistry {
  private repositories = new Map<string, PluginRepository>()
  private discovered = new Map<string, DiscoveredModule[]>()
  private listeners = new Set<RegistryEventListener>()
  private options: Required<PluginRegistryOptions>
  private logger: ModuleLogger

  // Caches
  private indexCache = new Map<string, CacheEntry<RepositoryIndex>>()
  private manifestCache = new Map<string, CacheEntry<ModuleManifest>>()

  constructor(options: PluginRegistryOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.logger = options.logger ?? new ConsoleLogger()
  }

  /**
   * Add a plugin repository
   */
  addRepository(repo: PluginRepository): void {
    // Normalize URL (remove trailing slash)
    const normalizedRepo: PluginRepository = {
      ...repo,
      url: repo.url.replace(/\/$/, ''),
      enabled: repo.enabled ?? true,
      priority: repo.priority ?? 0
    }

    this.repositories.set(repo.id, normalizedRepo)
    this.logger.info(`Added repository: ${repo.name} (${repo.url})`)

    this.emit({
      type: 'repository-added',
      repository: normalizedRepo,
      timestamp: new Date()
    })
  }

  /**
   * Remove a plugin repository
   */
  removeRepository(repoId: string): boolean {
    const repo = this.repositories.get(repoId)
    if (!repo) return false

    this.repositories.delete(repoId)
    this.discovered.delete(repoId)

    this.emit({
      type: 'repository-removed',
      repository: repo,
      timestamp: new Date()
    })

    this.logger.info(`Removed repository: ${repo.name}`)
    return true
  }

  /**
   * Get all configured repositories
   */
  getRepositories(): PluginRepository[] {
    return Array.from(this.repositories.values())
  }

  /**
   * Get a specific repository
   */
  getRepository(repoId: string): PluginRepository | undefined {
    return this.repositories.get(repoId)
  }

  /**
   * Discover all modules from all enabled repositories
   */
  async discoverAll(): Promise<DiscoveredModule[]> {
    const allDiscovered: DiscoveredModule[] = []

    const enabledRepos = Array.from(this.repositories.values())
      .filter(r => r.enabled)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const repo of enabledRepos) {
      try {
        const modules = await this.discoverFromRepository(repo)
        allDiscovered.push(...modules)
      } catch (error) {
        this.logger.error(`Failed to discover from ${repo.name}:`, error)
        this.emit({
          type: 'discovery-error',
          repository: repo,
          error: error as Error,
          timestamp: new Date()
        })
      }
    }

    return allDiscovered
  }

  /**
   * Discover modules from a specific repository
   */
  async discoverFromRepository(repo: PluginRepository): Promise<DiscoveredModule[]> {
    this.logger.debug(`Discovering modules from ${repo.name}...`)

    // Fetch repository index
    const index = await this.fetchIndex(repo)
    this.logger.debug(`Found ${index.modules.length} modules in ${repo.name}`)

    // Fetch each module manifest
    const discovered: DiscoveredModule[] = []

    for (const moduleId of index.modules) {
      try {
        const manifest = await this.fetchManifest(repo, moduleId)

        // Resolve relative entry URL to absolute
        if (!manifest.entry.startsWith('http')) {
          manifest.entry = `${repo.url}/${moduleId}/${manifest.entry}`
        }

        const discoveredModule: DiscoveredModule = {
          manifest,
          repository: repo,
          manifestUrl: `${repo.url}/${moduleId}/manifest.json`
        }

        discovered.push(discoveredModule)
      } catch (error) {
        this.logger.warn(`Failed to fetch manifest for ${moduleId}:`, error)
      }
    }

    // Update discovered cache
    this.discovered.set(repo.id, discovered)

    this.emit({
      type: 'modules-discovered',
      repository: repo,
      modules: discovered,
      timestamp: new Date()
    })

    this.logger.info(`Discovered ${discovered.length} modules from ${repo.name}`)
    return discovered
  }

  /**
   * Get all discovered modules (from cache)
   */
  getDiscoveredModules(): DiscoveredModule[] {
    const all: DiscoveredModule[] = []
    for (const modules of this.discovered.values()) {
      all.push(...modules)
    }
    return all
  }

  /**
   * Get manifests for all discovered modules
   * Deduplicates by ID, keeping highest version from highest priority repo
   */
  getManifests(): ModuleManifest[] {
    const moduleMap = new Map<string, { manifest: ModuleManifest; priority: number }>()

    // Sort by repository priority (highest first)
    const sortedRepos = Array.from(this.repositories.values())
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const repo of sortedRepos) {
      const modules = this.discovered.get(repo.id) ?? []
      for (const { manifest } of modules) {
        const existing = moduleMap.get(manifest.id)

        if (!existing) {
          moduleMap.set(manifest.id, { manifest, priority: repo.priority ?? 0 })
        } else if (repo.priority === existing.priority) {
          // Same priority repo - take higher version
          if (semver.gt(manifest.version, existing.manifest.version)) {
            moduleMap.set(manifest.id, { manifest, priority: repo.priority ?? 0 })
          }
        }
        // Lower priority repos don't override
      }
    }

    return Array.from(moduleMap.values()).map(e => e.manifest)
  }

  /**
   * Find a specific module by ID
   */
  findModule(moduleId: string, versionRange?: string): DiscoveredModule | undefined {
    const candidates: DiscoveredModule[] = []

    for (const modules of this.discovered.values()) {
      for (const discovered of modules) {
        if (discovered.manifest.id === moduleId) {
          if (!versionRange || semver.satisfies(discovered.manifest.version, versionRange)) {
            candidates.push(discovered)
          }
        }
      }
    }

    if (candidates.length === 0) return undefined

    // Return highest version
    return candidates.sort((a, b) =>
      semver.rcompare(a.manifest.version, b.manifest.version)
    )[0]
  }

  /**
   * Find all versions of a module
   */
  findModuleVersions(moduleId: string): DiscoveredModule[] {
    const versions: DiscoveredModule[] = []

    for (const modules of this.discovered.values()) {
      for (const discovered of modules) {
        if (discovered.manifest.id === moduleId) {
          versions.push(discovered)
        }
      }
    }

    return versions.sort((a, b) =>
      semver.rcompare(a.manifest.version, b.manifest.version)
    )
  }

  /**
   * Check for updates to currently loaded modules
   */
  async checkUpdates(loadedManifests: ModuleManifest[]): Promise<ModuleUpdate[]> {
    // Refresh discovery
    await this.discoverAll()

    const updates: ModuleUpdate[] = []

    for (const loaded of loadedManifests) {
      const available = this.findModule(loaded.id)
      if (available && semver.gt(available.manifest.version, loaded.version)) {
        updates.push({
          moduleId: loaded.id,
          currentVersion: loaded.version,
          availableVersion: available.manifest.version,
          repository: available.repository
        })
      }
    }

    if (updates.length > 0) {
      this.emit({
        type: 'update-available',
        updates,
        timestamp: new Date()
      })
    }

    return updates
  }

  /**
   * Fetch repository index
   */
  private async fetchIndex(repo: PluginRepository): Promise<RepositoryIndex> {
    const url = `${repo.url}/index.json`

    // Check cache
    const cached = this.indexCache.get(url)
    if (cached && this.isCacheValid(cached)) {
      return cached.data
    }

    const response = await this.fetchWithTimeout(url, repo.token)
    if (!response.ok) {
      throw new Error(`Failed to fetch index: ${response.status} ${response.statusText}`)
    }

    const index = await response.json() as RepositoryIndex

    // Validate
    if (!index.modules || !Array.isArray(index.modules)) {
      throw new Error('Invalid repository index: missing modules array')
    }

    // Cache
    this.indexCache.set(url, { data: index, timestamp: Date.now() })

    return index
  }

  /**
   * Fetch module manifest
   */
  private async fetchManifest(repo: PluginRepository, moduleId: string): Promise<ModuleManifest> {
    const url = `${repo.url}/${moduleId}/manifest.json`

    // Check cache
    const cached = this.manifestCache.get(url)
    if (cached && this.isCacheValid(cached)) {
      return cached.data
    }

    const response = await this.fetchWithTimeout(url, repo.token)
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`)
    }

    const manifest = await response.json() as ModuleManifest

    // Validate required fields
    if (!manifest.id || !manifest.name || !manifest.version || !manifest.entry) {
      throw new Error(`Invalid manifest for ${moduleId}: missing required fields`)
    }

    // Cache
    this.manifestCache.set(url, { data: manifest, timestamp: Date.now() })

    return manifest
  }

  /**
   * Fetch with timeout and optional auth
   */
  private async fetchWithTimeout(url: string, token?: string): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.fetchTimeout)

    try {
      const headers: HeadersInit = {}
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      return await this.options.fetchFn(url, {
        headers,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T>): boolean {
    if (this.options.cacheTtl === 0) return false
    return Date.now() - entry.timestamp < this.options.cacheTtl
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.indexCache.clear()
    this.manifestCache.clear()
    this.logger.debug('Cache cleared')
  }

  /**
   * Add event listener
   */
  addEventListener(listener: RegistryEventListener): void {
    this.listeners.add(listener)
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: RegistryEventListener): void {
    this.listeners.delete(listener)
  }

  /**
   * Emit event to listeners
   */
  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onRegistryEvent(event)
      } catch (error) {
        this.logger.error('Registry event listener error:', error)
      }
    }
  }
}