/**
 * TSM DevTools - console commands for module and service introspection
 *
 * Installs a small command surface on the global object, so the state of a
 * running application can be inspected from the browser console:
 *
 *   import { installDevtools } from '@eclipse-daanse/tsm/devtools'
 *   installDevtools({ loader, registry })
 *   // then, in the console: tsm.help()
 *
 * The commands take the loader and registry directly rather than through a
 * facade, so they use the same types as the rest of the package and cannot drift
 * from them.
 */

import type { DependencyResolver } from '../DependencyResolver.js'
import type { ModuleLoader } from '../ModuleLoader.js'
import type { PluginRegistry } from '../PluginRegistry.js'
import type { TsmRuntime } from '../TsmRuntime.js'
import type {
  LoadedModule,
  ModuleManifest,
  ModuleState,
  PluginRepository,
  ServiceReference
} from '../types.js'
import { consoleOutput, css, type DevtoolsOutput } from './output.js'

export type { DevtoolsOutput } from './output.js'
export { consoleOutput, collectingOutput, type CollectingOutput } from './output.js'

export interface DevtoolsOptions {
  /** The loader to inspect */
  loader: ModuleLoader

  /** Optional: enables the discovery and repository commands */
  registry?: PluginRegistry

  /** Optional: enables `resolve()` */
  resolver?: DependencyResolver

  /** Optional: enables `shared()` */
  runtime?: TsmRuntime

  /**
   * Where to install the command object. Defaults to `globalThis`; pass `null`
   * to install nowhere and only use the returned object.
   */
  target?: Record<string, unknown> | null

  /** Property name on the target. Default: 'tsm' */
  name?: string

  /** Where output goes. Default: the browser console, with colours */
  output?: DevtoolsOutput
}

export interface TsmDevtools {
  /** Every known module with its state */
  modules(): void
  /** The manifest of a module */
  manifest(moduleId: string): ModuleManifest | undefined
  /** Load state, exports and error of a module */
  state(moduleId: string): LoadedModule | undefined

  load(moduleId: string): Promise<void>
  unload(moduleId: string): Promise<boolean>
  reload(moduleId: string): Promise<void>
  loadAll(): Promise<void>

  /** Modules waiting for something, and what for */
  unsatisfied(): void
  /** Services a module declared in `provides` but never registered */
  mismatches(): void

  /** Every service ID with its provider */
  services(): void
  /** Resolve one service */
  service<T = unknown>(serviceId: string): T | undefined
  /** Every registration for a service ID, best first */
  providers(serviceId: string, target?: string): ServiceReference[]
  /** Shared libraries the host registered */
  shared(): void

  discover(): Promise<void>
  available(): void
  resolve(): void
  repos(): void
  addRepo(repo: PluginRepository): void
  removeRepo(repoId: string): boolean

  /** Modules picked for a later `loadQueue()` */
  add(moduleId: string): void
  remove(moduleId: string): void
  queue(): void
  clearQueue(): void
  loadQueue(): Promise<void>

  help(): void
  /** Remove the command object from the target again */
  uninstall(): void

  /** The objects behind the commands, for anything the commands do not cover */
  raw: {
    loader: ModuleLoader
    registry?: PluginRegistry
    resolver?: DependencyResolver
    services: ReturnType<ModuleLoader['getServiceRegistry']>
  }
}

const STATE_STYLE: Record<ModuleState | 'not loaded', Parameters<typeof css>[0]> = {
  active: 'ok',
  unsatisfied: 'warn',
  error: 'bad',
  registered: 'muted',
  resolving: 'muted',
  loading: 'muted',
  activating: 'muted',
  deactivating: 'muted',
  stopped: 'muted',
  'not loaded': 'muted'
}

/**
 * Install the console commands.
 *
 * @returns The command object, also reachable as `globalThis.tsm` by default
 */
export function installDevtools(options: DevtoolsOptions): TsmDevtools {
  const { loader, registry, resolver, runtime } = options
  const out = options.output ?? consoleOutput()
  const name = options.name ?? 'tsm'
  const target = options.target === undefined
    ? (globalThis as unknown as Record<string, unknown>)
    : options.target

  const services = loader.getServiceRegistry()
  const queued = new Set<string>()

  function requireRegistry(command: string): PluginRegistry | undefined {
    if (!registry) {
      out.error(`${command}() needs a PluginRegistry — pass one to installDevtools()`)
      return undefined
    }
    return registry
  }

  function findManifest(moduleId: string): ModuleManifest | undefined {
    return loader.getManifests().find(manifest => manifest.id === moduleId)
      ?? registry?.getManifests().find(manifest => manifest.id === moduleId)
  }

  function stateOf(moduleId: string): ModuleState | 'not loaded' {
    return loader.getModule(moduleId)?.state ?? 'not loaded'
  }

  const tools: TsmDevtools = {
    modules() {
      const manifests = loader.getManifests()
      if (manifests.length === 0) {
        out.log('%cNo modules registered', css('muted'))
        return
      }

      out.log('%cModules', css('heading'))
      for (const manifest of manifests) {
        const state = stateOf(manifest.id)
        out.log(
          `  %c${manifest.id}%c v${manifest.version} %c[${state}]`,
          css('name'),
          css('muted'),
          css(STATE_STYLE[state])
        )
      }
      out.log(
        `%c${loader.getLoadedModuleIds().length} of ${manifests.length} active`,
        css('muted')
      )
    },

    manifest(moduleId) {
      const manifest = findManifest(moduleId)
      if (!manifest) {
        out.error(`Unknown module: ${moduleId}`)
        return undefined
      }
      out.inspect(`Manifest of ${moduleId}`, manifest)
      return manifest
    },

    state(moduleId) {
      const loaded = loader.getModule(moduleId)
      if (!loaded) {
        out.error(`Module not loaded: ${moduleId}`)
        return undefined
      }

      out.table({
        id: loaded.manifest.id,
        version: loaded.manifest.version,
        state: loaded.state,
        loadedAt: loaded.loadedAt.toISOString(),
        exports: Array.from(loaded.exports.keys()).join(', '),
        error: loaded.error?.message ?? ''
      })
      return loaded
    },

    async load(moduleId) {
      const manifest = findManifest(moduleId)
      if (!manifest) {
        out.error(`Unknown module: ${moduleId}. Run discover() first?`)
        return
      }

      try {
        const loaded = await loader.loadModule(manifest, { awaitCascade: true })
        out.log(`%c${moduleId} is ${loaded.state}`, css(STATE_STYLE[loaded.state]))
        if (loaded.state === 'unsatisfied') tools.unsatisfied()
      } catch (error) {
        out.error(`Failed to load ${moduleId}`, error)
      }
    },

    async unload(moduleId) {
      try {
        const removed = await loader.unloadModule(moduleId)
        out.log(
          removed ? `%c${moduleId} unloaded` : `%c${moduleId} was not loaded`,
          css(removed ? 'ok' : 'muted')
        )
        return removed
      } catch (error) {
        out.error(`Failed to unload ${moduleId}`, error)
        return false
      }
    },

    async reload(moduleId) {
      try {
        await loader.reloadModule(moduleId)
        out.log(`%c${moduleId} reloaded`, css('ok'))
      } catch (error) {
        out.error(`Failed to reload ${moduleId}`, error)
      }
    },

    async loadAll() {
      try {
        await loader.loadAll()
        tools.modules()
      } catch (error) {
        out.error('loadAll failed', error)
      }
    },

    unsatisfied() {
      const waiting = loader.getUnsatisfiedModules()
      if (waiting.length === 0) {
        out.log('%cNothing is waiting', css('ok'))
        return
      }

      out.log('%cWaiting modules', css('heading'))
      for (const entry of waiting) {
        out.log(
          `  %c${entry.moduleId}%c waits for ${entry.waitingFor.join(', ')}`,
          css('name'),
          css('warn')
        )
      }
    },

    mismatches() {
      const drift = loader.getDeclarationMismatches()
      if (drift.length === 0) {
        out.log('%cEvery declared service was registered', css('ok'))
        return
      }

      out.log('%cDeclared but never registered', css('heading'))
      for (const entry of drift) {
        out.log(
          `  %c${entry.moduleId}%c declares ${entry.serviceIds.join(', ')}`,
          css('name'),
          css('warn')
        )
      }
    },

    services() {
      const ids = services.getServiceIds()
      if (ids.length === 0) {
        out.log('%cNo services registered', css('muted'))
        return
      }

      out.log('%cServices', css('heading'))
      for (const id of ids.slice().sort()) {
        const info = services.getBindingInfo(id)
        const count = services.countProviders(id)
        const extra = count > 1 ? ` (+${count - 1} standing by)` : ''
        out.log(
          `  %c${id}%c ${info?.providedBy ?? 'unknown'} · ${info?.scope ?? '?'}${extra}`,
          css('name'),
          css('muted')
        )
      }
    },

    service<T>(serviceId: string) {
      const service = services.get<T>(serviceId)
      if (service === undefined) {
        out.error(`No service under: ${serviceId}`)
        return undefined
      }
      out.inspect(serviceId, service)
      return service
    },

    providers(serviceId, target) {
      const references = services.getServiceReferences(serviceId, target)
      if (references.length === 0) {
        out.log(`%cNo provider for ${serviceId}`, css('muted'))
        return references
      }

      out.log(`%cProviders of ${serviceId}`, css('heading'))
      for (const reference of references) {
        out.log(
          `  %c${reference.providedBy ?? 'unknown'}%c ranking ${reference.ranking} · ` +
          `${reference.scope}${reference.instantiated ? ' · instantiated' : ''}`,
          css('name'),
          css('muted')
        )
      }
      return references
    },

    shared() {
      if (!runtime) {
        out.error('shared() needs the TSM runtime — pass it to installDevtools()')
        return
      }

      const libraries = runtime.getRegistered()
      if (libraries.size === 0) {
        out.log('%cNo shared libraries registered', css('muted'))
        return
      }

      out.log('%cShared libraries', css('heading'))
      for (const [id, library] of libraries) {
        out.log(
          `  %c${id}%c ${library.version}${library.providedBy ? ` · by ${library.providedBy}` : ''}`,
          css('name'),
          css('muted')
        )
      }
    },

    async discover() {
      const pluginRegistry = requireRegistry('discover')
      if (!pluginRegistry) return

      try {
        const discovered = await pluginRegistry.discoverAll()
        out.log(`%cDiscovered ${discovered.length} module(s)`, css('ok'))
        tools.available()
      } catch (error) {
        out.error('Discovery failed', error)
      }
    },

    available() {
      const pluginRegistry = requireRegistry('available')
      if (!pluginRegistry) return

      const manifests = pluginRegistry.getManifests()
      if (manifests.length === 0) {
        out.log('%cNothing discovered yet — run discover()', css('muted'))
        return
      }

      out.log('%cAvailable modules', css('heading'))
      for (const manifest of manifests) {
        const state = stateOf(manifest.id)
        out.log(
          `  %c${manifest.id}%c v${manifest.version} %c[${state}]`,
          css('name'),
          css('muted'),
          css(STATE_STYLE[state])
        )
      }
    },

    resolve() {
      if (!resolver) {
        out.error('resolve() needs a DependencyResolver — pass one to installDevtools()')
        return
      }

      const manifests = registry?.getManifests() ?? loader.getManifests()
      const resolution = resolver.resolve(manifests)

      out.log('%cLoad order', css('heading'))
      out.log(`  ${resolution.loadOrder.map(manifest => manifest.id).join(' → ')}`)

      if (resolution.circular.length > 0) {
        out.log('%cCircular', css('bad'))
        for (const cycle of resolution.circular) {
          out.log(`  ${cycle.join(' → ')}`)
        }
      }
      if (resolution.missing.length > 0) {
        out.log('%cMissing dependencies', css('bad'))
        for (const entry of resolution.missing) {
          out.log(`  ${entry.moduleId} needs ${entry.missingDep}`)
        }
      }
    },

    repos() {
      const pluginRegistry = requireRegistry('repos')
      if (!pluginRegistry) return

      const repositories = pluginRegistry.getRepositories()
      if (repositories.length === 0) {
        out.log('%cNo repositories', css('muted'))
        return
      }

      out.log('%cRepositories', css('heading'))
      for (const repo of repositories) {
        out.log(`  %c${repo.id}%c ${repo.url}`, css('name'), css('muted'))
      }
    },

    addRepo(repo) {
      const pluginRegistry = requireRegistry('addRepo')
      if (!pluginRegistry) return

      pluginRegistry.addRepository(repo)
      out.log(`%cAdded repository ${repo.id}`, css('ok'))
    },

    removeRepo(repoId) {
      const pluginRegistry = requireRegistry('removeRepo')
      if (!pluginRegistry) return false

      const removed = pluginRegistry.removeRepository(repoId)
      out.log(
        removed ? `%cRemoved ${repoId}` : `%cNo repository ${repoId}`,
        css(removed ? 'ok' : 'muted')
      )
      return removed
    },

    add(moduleId) {
      if (!findManifest(moduleId)) {
        out.error(`Unknown module: ${moduleId}`)
        return
      }
      queued.add(moduleId)
      out.log(`%c${moduleId} queued (${queued.size})`, css('ok'))
    },

    remove(moduleId) {
      const removed = queued.delete(moduleId)
      out.log(
        removed ? `%c${moduleId} removed from queue` : `%c${moduleId} was not queued`,
        css(removed ? 'ok' : 'muted')
      )
    },

    queue() {
      if (queued.size === 0) {
        out.log('%cQueue is empty', css('muted'))
        return
      }

      out.log('%cQueue', css('heading'))
      for (const moduleId of queued) {
        out.log(`  %c${moduleId}%c [${stateOf(moduleId)}]`, css('name'), css('muted'))
      }
    },

    clearQueue() {
      const size = queued.size
      queued.clear()
      out.log(`%cCleared ${size} entr${size === 1 ? 'y' : 'ies'}`, css('muted'))
    },

    async loadQueue() {
      if (queued.size === 0) {
        out.log('%cQueue is empty', css('muted'))
        return
      }

      // Loaded one after another so an early failure does not hide the rest
      for (const moduleId of [...queued]) {
        await tools.load(moduleId)
      }
      queued.clear()
    },

    help() {
      const sections: Array<[string, string[]]> = [
        ['Modules', [
          'modules()            every known module with its state',
          'manifest(id)         the manifest',
          'state(id)            load state, exports, error',
          'load(id)             load and activate, waiting for the cascade',
          'unload(id)           deactivate and remove',
          'reload(id)           hot reload, with its dependents',
          'loadAll()            load everything registered'
        ]],
        ['Diagnosis', [
          'unsatisfied()        what is waiting, and for what',
          'mismatches()         declared in provides but never registered'
        ]],
        ['Services', [
          'services()           every service with its provider',
          'service(id)          resolve one service',
          'providers(id, flt?)  every registration, best first',
          'shared()             shared libraries of the host'
        ]],
        ['Repositories', [
          'discover()           fetch manifests from repositories',
          'available()          what discovery found',
          'resolve()            load order, cycles, missing',
          'repos()              configured repositories',
          'addRepo(r) / removeRepo(id)'
        ]],
        ['Queue', [
          'add(id) / remove(id) pick modules',
          'queue()              show the selection',
          'loadQueue()          load them in order',
          'clearQueue()         drop the selection'
        ]],
        ['Other', [
          'raw                  loader, registry, resolver, services',
          'uninstall()          remove these commands'
        ]]
      ]

      out.log(`%cTSM DevTools — ${name}.<command>()`, css('heading'))
      for (const [title, commands] of sections) {
        out.log(`%c${title}`, css('name'))
        for (const command of commands) {
          out.log(`  ${command}`)
        }
      }
    },

    uninstall() {
      if (target && target[name] === tools) {
        delete target[name]
      }
      out.log('%cDevTools removed', css('muted'))
    },

    raw: { loader, registry, resolver, services }
  }

  if (target) {
    target[name] = tools
    out.log(
      `%cTSM DevTools ready — type %c${name}.help()`,
      css('ok'),
      css('name')
    )
  }

  return tools
}
