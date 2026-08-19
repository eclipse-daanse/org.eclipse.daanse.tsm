/**
 * TSM: requirements and capabilities (OSGi Core 3.3).
 *
 * The page is built from `resolveWiring(manifests)` — a pure function over
 * manifests. Nothing is loaded to compute any of it, which is the point: the
 * question "can this module run at all" is answered before fetching anything.
 *
 * Only the last panel needs a loader, and only to show what resolution does *not*
 * answer: whether a promised service is really registered.
 */

import 'reflect-metadata'
import {
  DefaultServiceRegistry,
  ModuleLoader,
  capabilitiesOf,
  resolveWiring,
  type Capability,
  type ModuleManifest,
  type Requirement,
  type WiringResolution
} from '@eclipse-daanse/tsm'
import { installDevtools } from '@eclipse-daanse/tsm/devtools'
import { LOG_SERVICE, type Log } from './contracts.js'
import { startup, variants } from './manifests.js'

let manifests: ModuleManifest[] = [...startup]
let loader: ModuleLoader | undefined
const entries: Array<{ at: Date; source: string; message: string }> = []

const log: Log = {
  write(source, message) {
    entries.unshift({ at: new Date(), source, message })
    renderRuntime()
    renderLog()
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element: #${id}`)
  return found as T
}

function line(text: string, className = ''): HTMLDivElement {
  const div = document.createElement('div')
  div.className = className
  div.textContent = text
  return div
}

function attributesOf(capability: Capability): string {
  return Object.entries(capability.attributes ?? {})
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join(' ')
}

function describe(requirement: Requirement): string {
  return [
    requirement.namespace,
    requirement.filter,
    requirement.versionRange && `version ${requirement.versionRange}`,
    requirement.cardinality === 'multiple' && 'multiple',
    requirement.resolution === 'optional' && 'optional'
  ].filter(Boolean).join(' · ')
}

function renderCapabilities(): void {
  const host = element('capabilities')
  host.replaceChildren()

  for (const manifest of manifests) {
    const card = document.createElement('article')
    card.className = 'card'
    card.append(line(manifest.id, 'card-title'))

    for (const capability of capabilitiesOf(manifest)) {
      // Which of these were written by hand is worth seeing: identity and service
      // capabilities are derived, so the same model covers what the manifest
      // already said
      const declared = (manifest.capabilities ?? []).includes(capability)
      const row = line(
        `${capability.namespace}  ${attributesOf(capability)}`,
        `capability ${declared ? 'declared' : 'derived'}`
      )
      card.append(row)
    }

    host.append(card)
  }
}

function renderWires(resolution: WiringResolution): void {
  const host = element('wires')
  host.replaceChildren()

  for (const manifest of manifests) {
    // Straight from the resolution rather than calling requirementsOf() again:
    // the derived requirements are fresh objects on every call, so matching wires
    // against them by identity would silently find nothing
    const reports = resolution.requirements.filter(entry => entry.moduleId === manifest.id)
    if (reports.length === 0) continue

    const card = document.createElement('article')
    card.className = 'card'
    card.append(line(manifest.id, 'card-title'))

    for (const report of reports) {
      card.append(line(describe(report.requirement), 'requirement'))

      if (report.wires.length > 0) {
        for (const wire of report.wires) {
          card.append(line(`→ ${wire.provider}   ${attributesOf(wire.capability)}`, 'wire'))
        }
        continue
      }

      card.append(line(
        report.failure === undefined
          ? '→ nothing, and that is allowed (optional)'
          : report.failure.reason === 'no-capability'
            ? '→ nothing offers this namespace at all'
            : '→ something offers it, but nothing matches',
        report.failure === undefined ? 'wire optional' : 'wire failed'
      ))
    }

    host.append(card)
  }
}

function renderVerdict(resolution: WiringResolution): void {
  const host = element('verdict')
  host.replaceChildren()

  const failing = new Set(resolution.unresolved.map(entry => entry.moduleId))

  for (const manifest of manifests) {
    const resolvable = !failing.has(manifest.id)
    host.append(line(
      `${manifest.id} — ${resolvable ? 'could run' : 'can never run as things stand'}`,
      `verdict ${resolvable ? 'ok' : 'never'}`
    ))
  }
}

function renderRuntime(): void {
  const host = element('runtime')
  host.replaceChildren()

  if (!loader) {
    host.append(line('nothing loaded yet', 'muted'))
    return
  }

  const waiting = new Map(
    loader.getUnsatisfiedModules().map(entry => [entry.moduleId, entry.waitingFor])
  )

  for (const manifest of loader.getManifests()) {
    const state = loader.getModule(manifest.id)?.state ?? 'not loaded'
    const waitingFor = waiting.get(manifest.id)
    host.append(line(
      waitingFor
        ? `${manifest.id} — ${state}, waiting for ${waitingFor.join(', ')}`
        : `${manifest.id} — ${state}`,
      `runtime-state ${state}`
    ))
  }
}

function renderLog(): void {
  const host = element<HTMLOListElement>('log')
  host.replaceChildren()

  for (const entry of entries.slice(0, 20)) {
    const item = document.createElement('li')
    item.textContent = `${entry.at.toLocaleTimeString()} · ${entry.source}: ${entry.message}`
    host.append(item)
  }
}

function render(): void {
  // One pure call over the manifests; everything on the page follows from it
  const resolution = resolveWiring(manifests)
  renderCapabilities()
  renderWires(resolution)
  renderVerdict(resolution)
  renderRuntime()
  renderLog()
}

/** Replace a manifest by id, or add it if it is new */
function put(manifest: ModuleManifest): void {
  const index = manifests.findIndex(entry => entry.id === manifest.id)
  if (index < 0) manifests.push(manifest)
  else manifests[index] = manifest
  render()
}

element('btn-downgrade').addEventListener('click', () => {
  // The editor asked for ^2.0.0, so this is the version range doing its work —
  // and as text, '1.5.0' would have compared above '2.1.0'
  put(variants.themeDarkDowngraded)
})

element('btn-remove-light').addEventListener('click', () => {
  manifests = manifests.filter(manifest => manifest.id !== 'theme-light')
  render()
})

element('btn-add-pdf').addEventListener('click', () => {
  put(variants.pdfProvider)
})

element('btn-reset').addEventListener('click', () => {
  manifests = [...startup]
  loader?.dispose()
  loader = undefined
  entries.length = 0
  render()
})

element('btn-load').addEventListener('click', () => {
  void load()
})

/**
 * Load only what resolves.
 *
 * Nothing forces this — the loader would happily park an unresolvable module for
 * ever. Asking the resolution first means not fetching a module that cannot run.
 */
async function load(): Promise<void> {
  const resolution = resolveWiring(manifests)
  const runnable = manifests.filter(manifest => resolution.resolved.includes(manifest.id))

  const services = new DefaultServiceRegistry()
  loader = new ModuleLoader({ serviceRegistry: services })
  services.register(LOG_SERVICE, log, { providedBy: 'host' })
  loader.addEventListener({ onModuleEvent: () => renderRuntime() })
  loader.register(runnable)

  for (const skipped of manifests.filter(manifest => !runnable.includes(manifest))) {
    log.write('host', `not loading ${skipped.id}: it cannot resolve`)
  }

  await loader.loadAll()
  installDevtools({ loader })
  render()
}

render()
