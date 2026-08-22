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
  ComponentInfo,
  ConfigurationProperties,
  LoadedModule,
  ModuleManifest,
  ModuleState,
  PluginRepository,
  ServiceReference
} from '../types.js'
import {
  CONFIGURATION_ADMIN_SERVICE_ID,
  type Configuration,
  type ConfigurationAdmin
} from '../ConfigurationAdmin.js'
import { CONDITION_SERVICE_ID, CONDITION_ID } from '../conditions.js'
import {
  COMPONENT_RUNTIME_SERVICE_ID,
  type ServiceComponentRuntime
} from '../componentRuntime.js'
import { METATYPE_SERVICE_ID, type MetatypeRegistry } from '../Metatype.js'
import { capabilitiesOf } from '../capabilities.js'

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
  /** Alias for `modules()`, named after Gogo's `lb` */
  lb(): void
  /** The manifest of a module */
  manifest(moduleId: string): ModuleManifest | undefined
  /** Load state, exports and error of a module */
  state(moduleId: string): LoadedModule | undefined

  load(moduleId: string): Promise<void>
  unload(moduleId: string): Promise<boolean>
  reload(moduleId: string): Promise<void>
  loadAll(): Promise<void>
  /** Stop a module and keep it stopped */
  disable(moduleId: string): Promise<void>
  /** Let a disabled module run again */
  enable(moduleId: string): Promise<void>

  /** Modules waiting for something, and what for */
  unsatisfied(): void
  /** Services a module declared in `provides` but never registered */
  mismatches(): void

  /** Every service ID with its provider */
  services(): void
  /** Alias for `services()`, named after Gogo's `ls` */
  ls(): void
  /** Resolve one service */
  service<T = unknown>(serviceId: string): T | undefined
  /** Every registration for a service ID, best first */
  providers(serviceId: string, target?: string): ServiceReference[]
  /** Which modules asked for a service, and how */
  consumers(serviceId: string): void

  /** The `@component()` classes of the loaded modules, as DS shows with scr:list */
  components(moduleId?: string): ComponentInfo[]

  /**
   * The factory components and what each has built.
   *
   * A withdrawn factory is the interesting entry: it means a mandatory reference
   * is missing, so no instance of it can be had.
   */
  factories(): ComponentInfo[]

  /**
   * Which conditions hold, and which are waited for in vain.
   *
   * The second half is the point: a condition nobody registered is invisible in
   * the service list, and a component waiting for it looks like one waiting for
   * nothing at all.
   */
  conditions(): { held: string[]; awaited: string[] }

  /** Switch one component off, leaving its module and siblings running */
  disableComponent(moduleId: string, className: string): Promise<void>
  /** Let it run again */
  enableComponent(moduleId: string, className: string): Promise<void>

  /** What every module offers to the resolution, by namespace */
  capabilities(namespace?: string): void
  /** What a module is wired to and what is wired to it — Gogo's `inspect` */
  wiring(moduleId: string): void
  /** Requirements no manifest can satisfy: modules waiting in vain */
  unresolved(): void

  /** Configurations that have values, or the values of one PID */
  config(pid?: string): void
  /** Set a PID's values, which starts, updates or rebuilds its components */
  configure(pid: string, values: ConfigurationProperties): Promise<void>
  /** Delete a PID's configuration */
  unconfigure(pid: string): Promise<void>
  /** What a PID accepts: attributes, types, defaults, ranges — and what is wrong now */
  describe(pid: string, locale?: string): void
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

  /**
   * Whether anything registered satisfies a condition filter.
   *
   * An unparseable filter counts as unsatisfied, exactly as the loader treats it:
   * a listing saying "holds" where the loader refuses to start would be worse
   * than no listing.
   */
  function conditionHolds(filter: string): boolean {
    try {
      return services.countProviders(CONDITION_SERVICE_ID, filter) > 0
    } catch {
      return false
    }
  }

  /**
   * The component layer, through the service the loader publishes it as.
   *
   * Deliberately not `loader.getComponents()` directly: in OSGi these commands
   * are what `scr:list` does, and `scr:list` is a shell bundle talking to the
   * `ServiceComponentRuntime` service. Going the same way here is the proof that
   * a component view can be a module — these devtools take a loader only because
   * they also show modules, wiring and repositories, which are the framework's
   * business rather than SCR's.
   *
   * Falls back to the loader for a registry that does not carry the service,
   * which is what a custom `serviceRegistry` could produce.
   */
  function components(moduleId?: string): ComponentInfo[] {
    const scr = services.get<ServiceComponentRuntime>(COMPONENT_RUNTIME_SERVICE_ID)
    return scr
      ? scr.getComponentDescriptions(moduleId)
      : loader.getComponents(moduleId)
  }

  function requireRegistry(command: string): PluginRegistry | undefined {
    if (!registry) {
      out.error(`${command}() needs a PluginRegistry — pass one to installDevtools()`)
      return undefined
    }
    return registry
  }

  /**
   * The Configuration Admin the loader works with.
   *
   * Taken from the registry rather than from an option: the loader publishes it
   * there, and one it does not know is one whose values would change nothing.
   */
  function configurationAdmin(): ConfigurationAdmin | undefined {
    const admin = services.get<ConfigurationAdmin>(CONFIGURATION_ADMIN_SERVICE_ID)
    if (!admin) {
      out.error(
        'No Configuration Admin — pass one to the ModuleLoader as configurationAdmin'
      )
      return undefined
    }
    return admin
  }

  /** Which components read a configuration, so a listing says who cares */
  function componentsUsing(configuration: Configuration): string[] {
    return components()
      .filter(declaration =>
        declaration.configurationPolicy !== 'ignore' &&
        (declaration.configurationPid.includes(configuration.pid) ||
          (configuration.factoryPid !== undefined &&
            declaration.configurationPid.includes(configuration.factoryPid)))
      )
      .map(declaration => `${declaration.moduleId}/${declaration.className}`)
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
        const off = loader.isDisabled(manifest.id) ? ' (disabled)' : ''
        out.log(
          `  %c${manifest.id}%c v${manifest.version} %c[${state}]${off}`,
          css('name'),
          css('muted'),
          css(off ? 'warn' : STATE_STYLE[state])
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

    async disable(moduleId) {
      if (!await loader.disableModule(moduleId)) {
        out.error(`Unknown module: ${moduleId}`)
        return
      }
      out.log(`%c${moduleId} disabled`, css('warn'))
    },

    async enable(moduleId) {
      if (!await loader.enableModule(moduleId)) {
        out.log(`%c${moduleId} was not disabled`, css('muted'))
        return
      }
      out.log(`%c${moduleId} is ${stateOf(moduleId)}`, css(STATE_STYLE[stateOf(moduleId)]))
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

    /**
     * The component factories on offer, and what each has built.
     *
     * A factory with no instances is not idle by mistake: nobody has asked yet.
     * A component whose factory is *withdrawn* is the interesting case — it means
     * a mandatory reference is missing, so no instance can be had.
     */
    factories() {
      const declarations = components()
        .filter(declaration => declaration.factory !== undefined)

      if (declarations.length === 0) {
        out.log('%cNo factory components', css('muted'))
        return declarations
      }

      out.log('%cComponent factories', css('heading'))
      for (const declaration of declarations) {
        const factory = declaration.factory!
        out.log(
          `  %c${factory.name}%c ${declaration.className} in ${declaration.moduleId} — ` +
          `${factory.instances} instance(s)`,
          css('name'),
          css(factory.registered ? 'muted' : 'warn')
        )
        if (!factory.registered) {
          const waiting = declaration.configurations
            .flatMap(instance => instance.waitingFor ?? [])
          out.log(
            `    %cwithdrawn%c waiting for ${waiting.join(', ') || 'satisfaction'}`,
            css('warn'),
            css('muted')
          )
        }
        for (const service of declaration.services) {
          out.log(`    instances register ${service}`, css('muted'))
        }
      }
      return declarations
    },

    /**
     * Which conditions hold, and which are waited for in vain.
     *
     * The second half is the point: a condition nobody registered is invisible in
     * the service list, and a component waiting for it looks like a component
     * waiting for nothing.
     */
    conditions() {
      const registered = services.getServiceReferences(CONDITION_SERVICE_ID)
      const held = registered
        .map(reference => String(reference.properties[CONDITION_ID] ?? '?'))
        .sort()

      out.log('%cConditions', css('heading'))
      for (const id of held) {
        out.log(`  %c${id}%c holds`, css('name'), css('ok'))
      }

      // Every filter some component named, and whether anything matches it
      const awaited = new Map<string, string[]>()
      for (const declaration of components()) {
        const filter = declaration.satisfyingCondition
        if (filter === undefined) continue
        const waiting = awaited.get(filter) ?? []
        waiting.push(`${declaration.className} in ${declaration.moduleId}`)
        awaited.set(filter, waiting)
      }

      for (const [filter, components] of awaited) {
        const holds = conditionHolds(filter)
        out.log(
          `  %c${filter}%c ${holds ? 'satisfied' : 'UNSATISFIED'} — ${components.join(', ')}`,
          css('name'),
          css(holds ? 'muted' : 'warn')
        )
      }

      if (held.length === 0 && awaited.size === 0) {
        out.log('%cNothing but the baseline', css('muted'))
      }
      return { held, awaited: [...awaited.keys()] }
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

    consumers(serviceId) {
      const asking = loader.getServiceConsumers(serviceId)
      if (asking.length === 0) {
        out.log(`%cNobody declared ${serviceId}`, css('muted'))
        return
      }

      out.log(`%cConsumers of ${serviceId}`, css('heading'))
      for (const entry of asking) {
        const how = [
          entry.requirement.cardinality ?? (entry.requirement.optional ? '0..1' : '1..1'),
          entry.requirement.policy ?? 'static',
          entry.requirement.target
        ].filter(Boolean).join(' · ')

        out.log(
          `  %c${entry.moduleId}%c [${entry.state}] ${how}`,
          css('name'),
          css('muted')
        )
      }
    },

    components(moduleId) {
      const declarations = components(moduleId)
      if (declarations.length === 0) {
        out.log(`%cNo components${moduleId ? ` in ${moduleId}` : ''}`, css('muted'))
        return declarations
      }

      out.log(`%cComponents${moduleId ? ` of ${moduleId}` : ''}`, css('heading'))
      for (const declaration of declarations) {
        const traits = [
          declaration.disabled ? 'DISABLED' : undefined,
          // A factory component registers a factory, not its own service, so
          // naming the services would say the opposite of what is registered
          declaration.factory
            ? `factory '${declaration.factory.name}'` +
              (declaration.factory.registered ? '' : ' (withdrawn)') +
              ` · ${declaration.factory.instances} instance(s)`
            : declaration.immediate ? 'immediate' : 'delayed',
          declaration.factory === undefined && declaration.services.length > 0
            ? declaration.services.join(', ')
            : declaration.factory === undefined ? 'no service' : undefined,
          declaration.configurationPolicy !== 'optional'
            ? `config ${declaration.configurationPolicy}`
            : undefined,
          declaration.hasModified ? 'modified' : undefined
        ].filter(Boolean).join(' · ')

        out.log(
          `  %c${declaration.className}%c in ${declaration.moduleId} — ${traits}`,
          css('name'),
          css('muted')
        )

        if (declaration.satisfyingCondition !== undefined) {
          out.log(
            `    %ccondition%c ${declaration.satisfyingCondition}`,
            css(conditionHolds(declaration.satisfyingCondition) ? 'ok' : 'warn'),
            css('muted')
          )
        }

        for (const collection of declaration.collections) {
          const count = services.countProviders(collection.serviceId, collection.target)
          out.log(
            `    %ccollects%c ${collection.serviceId}${collection.target ?? ''} — ` +
            `${count} · ${collection.fieldOption}`,
            css('muted'),
            css('muted')
          )
        }

        for (const instance of declaration.configurations) {
          // What it waits for matters more than the PID when it is waiting
          const detail = instance.waitingFor !== undefined
            ? instance.waitingFor.join(', ')
            : instance.pid ?? declaration.configurationPid.join(', ')

          out.log(
            `    %c${instance.state}%c ${detail}`,
            css(instance.state.startsWith('unsatisfied') ? 'warn' : 'ok'),
            css('muted')
          )
        }
      }
      return declarations
    },

    async disableComponent(moduleId, className) {
      if (await loader.disableComponent(moduleId, className)) {
        out.log(`%c${className} of ${moduleId} disabled`, css('warn'))
      } else {
        out.log(
          `%cNoted — ${className} of ${moduleId} will not run when its module loads`,
          css('muted')
        )
      }
    },

    async enableComponent(moduleId, className) {
      if (await loader.enableComponent(moduleId, className)) {
        out.log(`%c${className} of ${moduleId} enabled`, css('ok'))
      } else {
        out.log(`%c${className} of ${moduleId} was not disabled`, css('muted'))
      }
    },

    capabilities(namespace) {
      // With the system bundle: it is where the environment's capabilities hang,
      // and leaving it out would make a wire point at nothing visible
      const manifests = [...loader.getManifests(), loader.getSystemBundle()]

      out.log(`%cCapabilities${namespace ? ` in ${namespace}` : ''}`, css('heading'))
      for (const manifest of manifests) {
        const offered = capabilitiesOf(manifest)
          .filter(capability => namespace === undefined || capability.namespace === namespace)
        if (offered.length === 0) continue

        out.log(`  %c${manifest.id}`, css('name'))
        for (const capability of offered) {
          const attributes = Object.entries(capability.attributes ?? {})
            .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
            .join(' ')
          out.log(`    %c${capability.namespace}%c ${attributes}`, css('ok'), css('muted'))
        }
      }
    },

    wiring(moduleId) {
      const { requires, provides } = loader.getModuleWiring(moduleId)
      if (requires.length === 0 && provides.length === 0) {
        out.log(`%c${moduleId} is wired to nothing`, css('muted'))
        return
      }

      out.log(`%cWiring of ${moduleId}`, css('heading'))
      for (const wire of requires) {
        out.log(
          `  %crequires%c ${wire.requirement.namespace}` +
          `${wire.requirement.filter ? ` ${wire.requirement.filter}` : ''} → ${wire.provider}`,
          css('name'),
          css('muted')
        )
      }
      for (const wire of provides) {
        out.log(
          `  %cprovides%c ${wire.capability.namespace} → ${wire.requirer}`,
          css('ok'),
          css('muted')
        )
      }
    },

    unresolved() {
      const failing = loader.getUnresolvedModules()
      if (failing.length === 0) {
        out.log('%cEvery module can resolve', css('ok'))
        return
      }

      // Not the same as unsatisfied(): this is waiting in vain, because no
      // manifest even promises what the module needs
      out.log('%cModules that can never resolve', css('heading'))
      for (const entry of failing) {
        const what = entry.requirement.filter ?? entry.requirement.namespace
        out.log(
          `  %c${entry.moduleId}%c needs ${entry.requirement.namespace} ${what}` +
          ` — ${entry.reason === 'no-capability' ? 'nothing in that namespace' : 'nothing matches'}`,
          css('name'),
          css('bad')
        )
      }
    },

    config(pid) {
      const admin = configurationAdmin()
      if (!admin) return

      if (pid !== undefined) {
        const configuration = admin.findConfiguration(pid)
        if (!configuration) {
          out.log(`%cNo configuration for ${pid}`, css('muted'))
          return
        }
        out.inspect(pid, configuration.getProperties())
        return
      }

      const configurations = admin.listConfigurations()
      if (configurations.length === 0) {
        out.log('%cNo configuration', css('muted'))
        return
      }

      out.log('%cConfigurations', css('heading'))
      for (const configuration of configurations) {
        const consumers = componentsUsing(configuration)
        out.log(
          `  %c${configuration.pid}%c ${consumers.length > 0 ? consumers.join(', ') : 'nobody reads it'}`,
          css('name'),
          css('muted')
        )
      }
    },

    async configure(pid, values) {
      const admin = configurationAdmin()
      if (!admin) return

      await admin.getConfiguration(pid).update(values)
      // The components react in the loader's queue, so wait before reporting
      await loader.settle()
      out.log(`%cConfigured ${pid}`, css('ok'))
    },

    describe(pid, locale) {
      const registry = services.get<MetatypeRegistry>(METATYPE_SERVICE_ID)
      if (!registry) {
        out.error('No metatype registry — pass one to the ModuleLoader as metatype')
        return
      }

      const definition = registry.getObjectClassDefinition(pid, locale)
      if (!definition) {
        out.log(`%cNothing describes ${pid}`, css('muted'))
        return
      }

      out.log(`%c${definition.name ?? definition.id}%c ${pid}`, css('heading'), css('muted'))
      if (definition.description !== undefined) {
        out.log(`  %c${definition.description}`, css('muted'))
      }

      const current = configurationAdmin()?.findConfiguration(pid)?.getProperties()

      for (const [id, attribute] of Object.entries(definition.attributes)) {
        const traits = [
          attribute.type,
          attribute.cardinality !== undefined && attribute.cardinality !== 'single'
            ? `list${typeof attribute.cardinality === 'number' ? ` of ${attribute.cardinality}` : ''}`
            : undefined,
          attribute.required === false ? 'optional' : 'required',
          attribute.default !== undefined ? `default ${JSON.stringify(attribute.default)}` : undefined,
          attribute.min !== undefined ? `min ${attribute.min}` : undefined,
          attribute.max !== undefined ? `max ${attribute.max}` : undefined,
          attribute.options ? `one of ${attribute.options.map(o => o.value).join('|')}` : undefined
        ].filter(Boolean).join(' · ')

        const value = current?.[id]
        out.log(
          `  %c${attribute.name ?? id}%c (${id}) — ${traits}` +
          (value === undefined ? '' : ` = ${JSON.stringify(value)}`),
          css('name'),
          css('muted')
        )
      }

      const errors = current ? registry.validate(pid, current) : []
      for (const error of errors) {
        out.log(`  %c${error.attribute} ${error.message}`, css('bad'))
      }
    },

    async unconfigure(pid) {
      const admin = configurationAdmin()
      if (!admin) return

      const configuration = admin.findConfiguration(pid)
      if (!configuration) {
        out.log(`%cNo configuration for ${pid}`, css('muted'))
        return
      }

      await configuration.delete()
      await loader.settle()
      out.log(`%cDeleted configuration ${pid}`, css('ok'))
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
          'loadAll()            load everything registered',
          'disable(id)          stop it and keep it stopped',
          'enable(id)           let it run again'
        ]],
        ['Diagnosis', [
          'unsatisfied()        what is waiting, and for what',
          'unresolved()         what waits in vain — nothing promises it',
          'mismatches()         declared in provides but never registered',
          'capabilities(ns?)    what each module offers to the resolution',
          'wiring(id)           what a module is wired to, both ways'
        ]],
        ['Services', [
          'services()           every service with its provider',
          'service(id)          resolve one service',
          'providers(id, flt?)  every registration, best first',
          'consumers(id)        which modules asked for it',
          'shared()             shared libraries of the host'
        ]],
        ['Components', [
          'components(id?)      declared components and their state',
          'factories()          component factories and what they built',
          'conditions()         which conditions hold, and who waits in vain',
          'disableComponent(id, class) / enableComponent(id, class)',
          'config(pid?)         configurations, or the values of one',
          'describe(pid, loc?)  what a PID accepts, and what is wrong now',
          'configure(pid, v)    set values and let the components react',
          'unconfigure(pid)     delete a configuration'
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
          'lb / ls              aliases for modules() / services()',
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

    // Aliases for the OSGi shell names, so a Gogo habit works here too
    lb() { tools.modules() },
    ls() { tools.services() },

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
