/**
 * TSM: bundles, components and services — drawn from the running loader.
 *
 * The host loads a handful of bundles and renders the three layers after every
 * lifecycle event. Nothing is hard-coded in the picture: every box and every line
 * comes from `getManifests()`, `getComponents()`, `getServiceReferences()` and
 * `getServiceConsumers()`.
 */

import { installDevtools } from '@eclipse-daanse/tsm/devtools'
import { DefaultServiceRegistry, ModuleLoader } from '@eclipse-daanse/tsm'
import { draw, type BundleNode, type GraphModel, type ServiceNode } from './draw.js'
import { onDemand, serviceOrder, startup } from './manifests.js'

// The registry is created here rather than taken from the loader: listening for
// service events needs the observable type, and `getServiceRegistry()` returns
// the plain interface because a custom registry need not be observable
const services = new DefaultServiceRegistry()
const loader = new ModuleLoader({ serviceRegistry: services })

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element: #${id}`)
  return found as T
}

const graphHost = element('graph')
const report = element('report')

/** Everything the picture shows, read from the loader */
function model(): GraphModel {
  const waiting = new Map(
    loader.getUnsatisfiedModules().map(entry => [entry.moduleId, entry.waitingFor])
  )

  const bundles: BundleNode[] = loader.getManifests().map(manifest => ({
    id: manifest.id,
    state: loader.getModule(manifest.id)?.state ?? 'not loaded',
    disabled: loader.isDisabled(manifest.id),
    waitingFor: waiting.get(manifest.id) ?? [],
    components: loader.getComponents(manifest.id)
  }))

  // Also the services somebody asks for but nobody provides — that is what
  // explains a parked bundle, so it belongs in the picture
  const required = loader
    .getManifests()
    .flatMap(manifest => manifest.requiresService?.map(requirement => requirement.id) ?? [])

  const ids = new Set([...serviceOrder, ...services.getServiceIds(), ...required])
  const serviceNodes: ServiceNode[] = [...ids].map(id => ({
    id,
    references: services.getServiceReferences(id),
    consumers: loader.getServiceConsumers(id).map(entry => ({
      moduleId: entry.moduleId,
      optional: entry.requirement.optional === true
    }))
  }))

  return { bundles, services: serviceNodes }
}

function render(): void {
  const current = model()
  draw(graphHost, current)

  report.textContent = [
    `bundles      ${current.bundles.length} (${current.bundles.filter(b => b.state === 'active').length} active)`,
    `components   ${current.bundles.reduce((total, b) => total + b.components.length, 0)}`,
    `services     ${current.services.filter(s => s.references.length > 0).length} provided`,
    '',
    ...current.services.map(service => {
      const providers = service.references
        .map((reference, index) => `${reference.providedBy}${index === 0 ? '' : ' (standing by)'}`)
        .join(', ') || 'none'
      const consumers = service.consumers
        .map(consumer => `${consumer.moduleId}${consumer.optional ? '?' : ''}`)
        .join(', ') || 'none'
      return `${service.id}\n  provided by  ${providers}\n  required by  ${consumers}`
    })
  ].join('\n')
}

// Any lifecycle change redraws
loader.addEventListener({ onModuleEvent: () => render() })
services.addListener({ onServiceEvent: () => render() })

// ---------------------------------------------------------------- controls

const vectorButton = element<HTMLButtonElement>('btn-vector')
const trafficButton = element<HTMLButtonElement>('btn-traffic')
const navButton = element<HTMLButtonElement>('btn-disable-nav')

async function toggle(button: HTMLButtonElement, moduleId: string, label: string): Promise<void> {
  if (loader.getModule(moduleId)) {
    await loader.unloadModule(moduleId)
    button.textContent = `Load ${label}`
    button.setAttribute('aria-pressed', 'false')
  } else {
    await loader.loadModule(onDemand[moduleId], { awaitCascade: true })
    button.textContent = `Unload ${label}`
    button.setAttribute('aria-pressed', 'true')
  }
  render()
}

vectorButton.addEventListener('click', () =>
  void toggle(vectorButton, 'tiles-vector', 'vector tiles (ranked higher)')
)
trafficButton.addEventListener('click', () =>
  void toggle(trafficButton, 'traffic', 'traffic (optional dependency)')
)

navButton.addEventListener('click', async () => {
  if (loader.isDisabled('navigation')) {
    await loader.enableModule('navigation')
    navButton.textContent = 'Disable navigation'
    navButton.setAttribute('aria-pressed', 'false')
  } else {
    await loader.disableModule('navigation')
    navButton.textContent = 'Enable navigation'
    navButton.setAttribute('aria-pressed', 'true')
  }
  render()
})

// ---------------------------------------------------------------- start

loader.register(startup)
installDevtools({ loader })

await loader.loadAll()
render()

console.log('%cTry: tsm.lb() · tsm.providers("demo.tiles") · tsm.consumers("demo.routing")', 'color: gray')
