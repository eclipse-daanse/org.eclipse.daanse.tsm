/**
 * TSM - TypeScript Module System
 * Configuration Admin - configuration values by PID
 *
 * The counterpart to OSGi's Configuration Admin (Compendium 104), which manages
 * configuration and knows nothing about components: the coupling to the
 * component lifecycle runs through PIDs alone and lives in the loader, exactly
 * as SCR consumes Config Admin rather than being part of it.
 *
 * What the OSGi specification requires is that configuration survives a restart;
 * where it is kept is left to the implementation. That is the seam here too: a
 * `ConfigurationStore` says where values live, and the application chooses one.
 */

import type { ConfigurationProperties } from './types.js'
import { createServiceFilter } from './serviceFilter.js'

// Re-exported for convenience; the definition lives with the other property
// types, next to the ServiceProperties it is an alias of
export type { ConfigurationProperties }

/**
 * Service ID the loader publishes its Configuration Admin under, so a module can
 * read and write configuration without a private channel to the host.
 */
export const CONFIGURATION_ADMIN_SERVICE_ID = 'tsm.configuration.admin'

/** Separator between factory PID and instance name, as in OSGi CM 1.6 */
export const FACTORY_PID_SEPARATOR = '~'

/** The service property carrying a configuration's PID, named as in OSGi */
export const SERVICE_PID = 'service.pid'

/** The service property carrying the factory PID of a factory configuration */
export const SERVICE_FACTORY_PID = 'service.factoryPid'

/**
 * One stored configuration, as a store keeps it.
 *
 * Plain data, so a store can serialize it without knowing about this module.
 */
export interface ConfigurationRecord {
  pid: string
  factoryPid?: string
  properties: ConfigurationProperties
  /** Increments on every update, so a consumer can tell a change from a repeat */
  changeCount: number
}

/**
 * Where configuration is kept.
 *
 * Deliberately the only part of configuration that is pluggable: whether values
 * come from a backend, a file baked into the build, or `localStorage` is a
 * decision about deployment, not about the module system.
 *
 * Every method may be asynchronous; `ConfigurationAdmin.ready()` resolves once
 * `load()` has been applied.
 */
export interface ConfigurationStore {
  load(): ConfigurationRecord[] | Promise<ConfigurationRecord[]>
  save(record: ConfigurationRecord): void | Promise<void>
  remove(pid: string): void | Promise<void>
}

/**
 * A configuration, identified by its PID.
 *
 * A handle rather than a snapshot: `getProperties()` reflects the current state,
 * so holding one across an update is safe.
 */
export interface Configuration {
  readonly pid: string

  /** Set when this configuration belongs to a factory PID */
  readonly factoryPid?: string

  /**
   * How often this configuration has been updated. Zero means it exists but was
   * never given values — `getConfiguration()` creates it that way.
   */
  readonly changeCount: number

  /**
   * The current values, or undefined while the configuration has none.
   *
   * A copy: changing the result changes nothing, an update has to go through
   * `update()` so that it is persisted and delivered.
   */
  getProperties(): ConfigurationProperties | undefined

  /**
   * Replace the values, persist them, and tell listeners.
   *
   * Without an argument the values stay as they are and listeners are notified
   * anyway — OSGi's `update()`, useful to re-deliver a configuration.
   *
   * Delivery to components is asynchronous, as in OSGi: the returned promise
   * resolves when the values are stored and the event is out, not when every
   * component has seen them. `ModuleLoader.settle()` waits for that.
   */
  update(properties?: ConfigurationProperties): Promise<void>

  /** Update only when the values differ from the current ones (OSGi CM 1.6) */
  updateIfDifferent(properties: ConfigurationProperties): Promise<boolean>

  /** Remove the configuration. A component requiring it becomes unsatisfied again. */
  delete(): Promise<void>
}

export interface ConfigurationEvent {
  type: 'updated' | 'deleted'
  pid: string
  factoryPid?: string
}

export interface ConfigurationListener {
  onConfigurationEvent(event: ConfigurationEvent): void
}

/** Keeps configuration for this session only */
export class MemoryConfigurationStore implements ConfigurationStore {
  private records = new Map<string, ConfigurationRecord>()

  constructor(initial: ConfigurationRecord[] = []) {
    for (const record of initial) {
      this.records.set(record.pid, record)
    }
  }

  load(): ConfigurationRecord[] {
    return [...this.records.values()]
  }

  save(record: ConfigurationRecord): void {
    this.records.set(record.pid, record)
  }

  remove(pid: string): void {
    this.records.delete(pid)
  }
}

/**
 * Keeps configuration in `localStorage`, one entry per PID.
 *
 * Per PID rather than one blob, so two tabs writing different PIDs do not
 * overwrite each other's values.
 */
export class LocalStorageConfigurationStore implements ConfigurationStore {
  constructor(private readonly prefix = 'tsm.config.') {
    if (typeof localStorage === 'undefined') {
      throw new Error(
        'LocalStorageConfigurationStore needs localStorage; use MemoryConfigurationStore ' +
        'or a store of your own outside the browser'
      )
    }
  }

  load(): ConfigurationRecord[] {
    const records: ConfigurationRecord[] = []

    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key === null || !key.startsWith(this.prefix)) continue

      const raw = localStorage.getItem(key)
      if (raw === null) continue

      try {
        records.push(JSON.parse(raw) as ConfigurationRecord)
      } catch {
        // A single unreadable entry must not take the rest of the configuration
        // with it; it is dropped on the next update of that PID
      }
    }

    return records
  }

  save(record: ConfigurationRecord): void {
    localStorage.setItem(this.prefix + record.pid, JSON.stringify(record))
  }

  remove(pid: string): void {
    localStorage.removeItem(this.prefix + pid)
  }
}

interface ConfigurationEntry {
  pid: string
  factoryPid?: string
  /** Undefined while the configuration exists but has never been updated */
  properties?: ConfigurationProperties
  changeCount: number
  deleted?: boolean
}

/**
 * Reject what cannot become a service property, and what cannot be persisted.
 *
 * OSGi restricts configuration values to primitives, strings and arrays of
 * those, for the same two reasons: a target filter has to be able to match them,
 * and a store has to be able to write them out.
 */
function assertValidProperties(pid: string, properties: ConfigurationProperties): void {
  const seen = new Map<string, string>()

  for (const [key, value] of Object.entries(properties)) {
    // OSGi treats configuration keys case-insensitively, and so does a target
    // filter here — two keys differing only in case would make the winner
    // depend on iteration order
    const lower = key.toLowerCase()
    const clash = seen.get(lower)
    if (clash !== undefined) {
      throw new Error(
        `Configuration '${pid}' has the keys '${clash}' and '${key}', which differ only in case`
      )
    }
    seen.set(lower, key)

    const values = Array.isArray(value) ? value : [value]
    for (const entry of values) {
      const type = typeof entry
      if (type !== 'string' && type !== 'number' && type !== 'boolean') {
        throw new Error(
          `Configuration '${pid}' property '${key}' is ${entry === null ? 'null' : type}; ` +
          `only strings, numbers, booleans and arrays of those can be stored and filtered on`
        )
      }
    }
  }
}

function sameProperties(
  left: ConfigurationProperties | undefined,
  right: ConfigurationProperties
): boolean {
  if (left === undefined) return false

  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false

  return leftKeys.every(key => {
    const a = left[key]
    const b = right[key]
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((entry, index) => entry === b[index])
    }
    return a === b
  })
}

/**
 * Configuration by PID, plus the events that let the loader act on it.
 *
 * A service of its own, as in OSGi: pass it to the `ModuleLoader` and it also
 * becomes available to modules under {@link CONFIGURATION_ADMIN_SERVICE_ID}, so
 * a module can configure another one without a private channel between them.
 */
export class ConfigurationAdmin {
  private entries = new Map<string, ConfigurationEntry>()
  private listeners = new Set<ConfigurationListener>()
  private readonly store: ConfigurationStore
  private loaded: Promise<void>
  private generated = 0

  constructor(options: { store?: ConfigurationStore } = {}) {
    this.store = options.store ?? new MemoryConfigurationStore()
    this.loaded = this.load()
  }

  private async load(): Promise<void> {
    const records = await this.store.load()

    for (const record of records) {
      // A configuration created in the meantime wins: it is newer than what the
      // store held when loading started
      if (this.entries.has(record.pid)) continue

      this.entries.set(record.pid, {
        pid: record.pid,
        factoryPid: record.factoryPid,
        properties: record.properties,
        changeCount: record.changeCount
      })
    }

    for (const entry of this.entries.values()) {
      if (entry.properties !== undefined) {
        this.notify({ type: 'updated', pid: entry.pid, factoryPid: entry.factoryPid })
      }
    }
  }

  /**
   * Resolves once the store's contents are available.
   *
   * `ModuleLoader.loadAll()` awaits this, so a component requiring
   * configuration is not parked for values that are already on disk.
   */
  async ready(): Promise<void> {
    await this.loaded
  }

  addListener(listener: ConfigurationListener): void {
    this.listeners.add(listener)
  }

  removeListener(listener: ConfigurationListener): void {
    this.listeners.delete(listener)
  }

  private notify(event: ConfigurationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onConfigurationEvent(event)
      } catch {
        // A listener that throws must not stop the others from hearing about it
      }
    }
  }

  /**
   * The configuration for a PID, created empty if it does not exist yet — the
   * same conflation of get and create that OSGi's `getConfiguration()` has.
   *
   * A configuration without values is not delivered anywhere; only `update()`
   * makes it count. That is what lets a management UI list a PID it has never
   * configured.
   */
  getConfiguration(pid: string): Configuration {
    return this.handleFor(this.entryFor(pid))
  }

  /** The configuration for a PID, or undefined when there is none */
  findConfiguration(pid: string): Configuration | undefined {
    const entry = this.entries.get(pid)
    return entry ? this.handleFor(entry) : undefined
  }

  /**
   * A named configuration of a factory PID (OSGi CM 1.6).
   *
   * The resulting PID is `factoryPid~name`, so it stays stable across restarts —
   * unlike {@link createFactoryConfiguration}, which generates one.
   */
  getFactoryConfiguration(factoryPid: string, name: string): Configuration {
    if (name.length === 0) {
      throw new Error(`Factory configuration of '${factoryPid}' needs a name`)
    }
    return this.handleFor(
      this.entryFor(factoryPid + FACTORY_PID_SEPARATOR + name, factoryPid)
    )
  }

  /**
   * A configuration of a factory PID under a generated name.
   *
   * Convenient for a configuration nobody has to find again; prefer
   * {@link getFactoryConfiguration} when it should survive a restart as itself.
   */
  createFactoryConfiguration(factoryPid: string): Configuration {
    let name: string
    do {
      name = String(++this.generated)
    } while (this.entries.has(factoryPid + FACTORY_PID_SEPARATOR + name))

    return this.getFactoryConfiguration(factoryPid, name)
  }

  /**
   * Every configuration that has values, optionally narrowed by an LDAP-style
   * filter over its properties — the same syntax a target filter uses.
   *
   * Returns an empty array when nothing matches. OSGi returns `null` here; that
   * is a documented wart of the API, not something worth copying.
   */
  listConfigurations(filter?: string): Configuration[] {
    const matches = filter === undefined ? undefined : createServiceFilter(filter)

    return [...this.entries.values()]
      .filter(entry => entry.properties !== undefined)
      .filter(entry => matches === undefined || matches(this.effectiveProperties(entry)))
      .map(entry => this.handleFor(entry))
  }

  /** The configurations belonging to a factory PID, in creation order */
  listFactoryConfigurations(factoryPid: string): Configuration[] {
    return [...this.entries.values()]
      .filter(entry => entry.factoryPid === factoryPid && entry.properties !== undefined)
      .map(entry => this.handleFor(entry))
  }

  private entryFor(pid: string, factoryPid?: string): ConfigurationEntry {
    let entry = this.entries.get(pid)
    if (!entry) {
      entry = { pid, factoryPid, changeCount: 0 }
      this.entries.set(pid, entry)
    }
    return entry
  }

  /**
   * What a consumer sees: the stored values plus the PID properties the admin
   * knows itself, as Config Admin adds `service.pid`.
   */
  private effectiveProperties(entry: ConfigurationEntry): ConfigurationProperties {
    const properties: ConfigurationProperties = { ...entry.properties }
    properties[SERVICE_PID] = entry.pid
    if (entry.factoryPid !== undefined) {
      properties[SERVICE_FACTORY_PID] = entry.factoryPid
    }
    return properties
  }

  private handleFor(entry: ConfigurationEntry): Configuration {
    const assertAlive = (): void => {
      if (entry.deleted) {
        throw new Error(`Configuration '${entry.pid}' has been deleted`)
      }
    }

    return {
      pid: entry.pid,
      factoryPid: entry.factoryPid,
      get changeCount() {
        return entry.changeCount
      },
      getProperties: () =>
        entry.properties === undefined || entry.deleted
          ? undefined
          : this.effectiveProperties(entry),

      update: async (properties?: ConfigurationProperties) => {
        assertAlive()
        if (properties !== undefined) {
          assertValidProperties(entry.pid, properties)
          entry.properties = { ...properties }
        } else if (entry.properties === undefined) {
          // OSGi's argument-less update() re-delivers existing values; with none
          // there is nothing to deliver, and creating empty ones would silently
          // satisfy a component that requires configuration
          throw new Error(
            `Configuration '${entry.pid}' has no properties to re-deliver; ` +
            `call update(properties) first`
          )
        }

        entry.changeCount++
        await this.store.save({
          pid: entry.pid,
          factoryPid: entry.factoryPid,
          properties: entry.properties,
          changeCount: entry.changeCount
        })
        this.notify({ type: 'updated', pid: entry.pid, factoryPid: entry.factoryPid })
      },

      updateIfDifferent: async (properties: ConfigurationProperties) => {
        assertAlive()
        if (sameProperties(entry.properties, properties)) return false

        await this.handleFor(entry).update(properties)
        return true
      },

      delete: async () => {
        assertAlive()
        entry.deleted = true
        this.entries.delete(entry.pid)
        await this.store.remove(entry.pid)
        this.notify({ type: 'deleted', pid: entry.pid, factoryPid: entry.factoryPid })
      }
    }
  }
}
