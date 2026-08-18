/**
 * TSM: configuration, bound to components.
 *
 * The host owns the Configuration Admin and hands it to the loader; from there
 * on every lifecycle decision is made by PIDs. The panels are rendered from
 * `getComponents()` and the registry, so what you see is the state of the
 * system rather than a description of it.
 */

import 'reflect-metadata'
import {
  ConfigurationAdmin,
  DefaultServiceRegistry,
  LocalStorageConfigurationStore,
  MetatypeRegistry,
  ModuleLoader
} from '@eclipse-daanse/tsm'
import { installDevtools } from '@eclipse-daanse/tsm/devtools'
import {
  CLOCK_PID,
  LOG_SERVICE,
  RESTARTING_CLOCK,
  STEADY_CLOCK,
  TILES_PID,
  TILE_SERVICE,
  TILE_SOURCE_FACTORY_PID,
  type Clock,
  type Log
} from './contracts.js'
import { bundles } from './manifests.js'

// Persisting in localStorage: the OSGi specification requires that configuration
// survives a restart and says nothing about where it lives, which is exactly the
// seam a store is
// The components declare what their configuration looks like; the registry
// collects those declarations, applies the declared defaults, and — because the
// admin gets it too — refuses values that do not fit
const metatype = new MetatypeRegistry()
const configuration = new ConfigurationAdmin({
  store: new LocalStorageConfigurationStore('tsm.example.config.'),
  metatype
})

const services = new DefaultServiceRegistry()
const loader = new ModuleLoader({
  serviceRegistry: services,
  configurationAdmin: configuration,
  metatype
})

const entries: Array<{ at: Date; source: string; message: string }> = []

// A service of the host, so the components can report what happens to them —
// and so the example shows injection alongside configuration
const log: Log = {
  write(source, message) {
    entries.unshift({ at: new Date(), source, message })
    render()
  }
}
services.register(LOG_SERVICE, log, { providedBy: 'host' })

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element: #${id}`)
  return found as T
}

const tilesUrl = element<HTMLInputElement>('tiles-url')
const clockInterval = element<HTMLInputElement>('clock-interval')
const sourceName = element<HTMLInputElement>('source-name')
const sourceUrl = element<HTMLInputElement>('source-url')

/**
 * Every change goes through the admin, and the loader reacts in its queue.
 *
 * The admin validates against the declared schema, so a rejected value shows up
 * here rather than reaching a component.
 */
async function change(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    log.write('configuration', error instanceof Error ? error.message : String(error))
    return
  }
  await loader.settle()
  render()
}

element('tiles-save').addEventListener('click', () => {
  void change(() =>
    // Only `url` is set here; `zoom` and `retina` come from the schema's defaults
    configuration.getConfiguration(TILES_PID).update({ url: tilesUrl.value })
  )
})

element('tiles-delete').addEventListener('click', () => {
  void change(async () => {
    await configuration.findConfiguration(TILES_PID)?.delete()
  })
})

element('clock-save').addEventListener('click', () => {
  void change(() =>
    configuration.getConfiguration(CLOCK_PID).update({
      interval: Number(clockInterval.value) || 1000
    })
  )
})

element('clock-delete').addEventListener('click', () => {
  void change(async () => {
    await configuration.findConfiguration(CLOCK_PID)?.delete()
  })
})

element('source-add').addEventListener('click', () => {
  const name = sourceName.value.trim()
  if (name.length === 0) return

  void change(async () => {
    // A named factory configuration, so its PID stays the same across restarts
    await configuration
      .getFactoryConfiguration(TILE_SOURCE_FACTORY_PID, name)
      .update({ name, url: sourceUrl.value, kind: 'raster' })
    sourceName.value = ''
    sourceUrl.value = ''
  })
})

function renderComponents(): void {
  const host = element('components')
  host.replaceChildren()

  for (const declaration of loader.getComponents()) {
    const card = document.createElement('div')
    card.className = 'component'

    const title = document.createElement('div')
    title.className = 'component-title'
    title.textContent = `${declaration.className} · ${declaration.moduleId}`
    card.append(title)

    const traits = document.createElement('div')
    traits.className = 'component-traits'
    traits.textContent = [
      `pid ${declaration.configurationPid.join(', ')}`,
      `policy ${declaration.configurationPolicy}`,
      declaration.hasModified ? 'has @modified' : 'no @modified',
      declaration.services.length > 0 ? declaration.services.join(', ') : 'no service'
    ].join(' · ')
    card.append(traits)

    for (const instance of declaration.configurations) {
      const line = document.createElement('div')
      line.className = `instance ${instance.state}`

      const properties = Object.entries(instance.properties)
        .filter(([key]) => key !== 'service.ranking' && key !== 'service.providedBy')
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')

      line.textContent = instance.state === 'unsatisfied-configuration'
        ? 'waiting for configuration'
        : `${instance.state}${instance.pid ? ` · ${instance.pid}` : ''}${properties ? ` · ${properties}` : ''}`
      card.append(line)
    }

    host.append(card)
  }
}

function renderProviders(): void {
  const host = element('providers')
  host.replaceChildren()

  const references = services.getServiceReferences(TILE_SERVICE)
  if (references.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'no provider — configure demo.tiles or add a source'
    host.append(empty)
    return
  }

  for (const reference of references) {
    const line = document.createElement('div')
    line.className = 'provider'
    const name = reference.properties.name ?? reference.properties['service.pid'] ?? 'unnamed'
    line.textContent = `${String(name)} · from ${reference.providedBy ?? 'unknown'} · ranking ${reference.ranking}`
    host.append(line)
  }
}

function renderBundles(): void {
  const host = element('bundles')
  host.replaceChildren()

  const waiting = new Map(
    loader.getUnsatisfiedModules().map(entry => [entry.moduleId, entry.waitingFor])
  )

  for (const manifest of loader.getManifests()) {
    const state = loader.getModule(manifest.id)?.state ?? 'not loaded'
    const line = document.createElement('div')
    line.className = `bundle ${state}`
    const waitingFor = waiting.get(manifest.id)
    line.textContent = waitingFor
      ? `${manifest.id} · ${state} — waits for ${waitingFor.join(', ')}`
      : `${manifest.id} · ${state}`
    host.append(line)
  }
}

function renderSources(): void {
  const host = element<HTMLUListElement>('source-list')
  host.replaceChildren()

  for (const entry of configuration.listFactoryConfigurations(TILE_SOURCE_FACTORY_PID)) {
    const item = document.createElement('li')
    item.textContent = String(entry.getProperties()?.name ?? entry.pid)

    const remove = document.createElement('button')
    remove.className = 'link'
    remove.textContent = 'remove'
    remove.addEventListener('click', () => {
      void change(() => entry.delete())
    })

    item.append(remove)
    host.append(item)
  }
}

function renderLog(): void {
  const host = element<HTMLOListElement>('log')
  host.replaceChildren()

  for (const entry of entries.slice(0, 40)) {
    const item = document.createElement('li')
    item.textContent =
      `${entry.at.toLocaleTimeString()} · ${entry.source}: ${entry.message}`
    host.append(item)
  }
}

/**
 * The tick counts, which is where `@modified()` becomes visible.
 *
 * Change the interval: the steady clock keeps its number because its instance
 * survived, the restarting one starts over because it is a different object.
 */
function renderTicks(): void {
  const host = element('clock-ticks')
  const steady = services.get<Clock>(STEADY_CLOCK)
  const restarting = services.get<Clock>(RESTARTING_CLOCK)

  if (!steady && !restarting) {
    host.textContent = 'no clock is running'
    return
  }

  host.replaceChildren()
  for (const [label, clock, note] of [
    ['SteadyClock', steady, 'has @modified'],
    ['RestartingClock', restarting, 'rebuilt on change']
  ] as const) {
    const line = document.createElement('div')
    line.className = 'tick'
    line.textContent = clock
      ? `${label}: ${clock.count()} ticks (${note})`
      : `${label}: stopped`
    host.append(line)
  }
}

function render(): void {
  renderComponents()
  renderProviders()
  renderBundles()
  renderSources()
  renderTicks()
  renderLog()
}

async function start(): Promise<void> {
  // Wait for the store before loading: a component whose values are already
  // there should start straight away, not be parked and woken
  await configuration.ready()

  tilesUrl.value = String(configuration.findConfiguration(TILES_PID)?.getProperties()?.url ?? '')
  clockInterval.value = String(
    configuration.findConfiguration(CLOCK_PID)?.getProperties()?.interval ?? 1000
  )

  loader.register(bundles)
  loader.addEventListener({ onModuleEvent: () => render() })
  await loader.loadAll()

  installDevtools({ loader })
  render()

  // The counters advance on their own; only that panel is redrawn, so typing in
  // a field is not interrupted
  setInterval(renderTicks, 500)
}

void start()
