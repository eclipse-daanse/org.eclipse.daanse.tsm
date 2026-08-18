/**
 * TSM Workbench example — host application.
 *
 * Discovers separately built bundles from a repository, provides the regions as a
 * service, and loads what it found. The host knows no module by name except the
 * clock, which it loads on demand to show a view arriving late.
 */

import { installDevtools } from '../../../src/devtools/index.js'
import { ModuleLoader } from '../../../src/ModuleLoader.js'
import { PluginRegistry } from '../../../src/PluginRegistry.js'
import { initTsmRuntime } from '../../../src/TsmRuntime.js'
import { WORKBENCH_ROOT, type RegionName, type WorkbenchRoot } from '../bundles/contracts.js'

initTsmRuntime()

const loader = new ModuleLoader({ hotReload: true })
const registry = new PluginRegistry()

registry.addRepository({
  id: 'workbench',
  name: 'Workbench bundles',
  url: '/bundles'
})

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element: #${id}`)
  return found as T
}

const activityLog = element<HTMLOListElement>('activity-log')

const root: WorkbenchRoot = {
  region(name: RegionName) {
    return element(`region-${name}`)
  },

  log(message: string) {
    const entry = document.createElement('li')
    entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`
    activityLog.prepend(entry)
  }
}

loader.getServiceRegistry().register(WORKBENCH_ROOT, root, { providedBy: 'host' })

// ---------------------------------------------------------------- controls

const clockButton = element<HTMLButtonElement>('btn-clock')
const proButton = element<HTMLButtonElement>('btn-pro')
const churnButton = element<HTMLButtonElement>('btn-churn')

function manifestOf(moduleId: string) {
  const manifest = registry.getManifests().find(entry => entry.id === moduleId)
  if (!manifest) throw new Error(`Not discovered: ${moduleId}`)
  return manifest
}

async function toggleClock(): Promise<void> {
  if (loader.getModule('clock')) {
    await loader.unloadModule('clock')
    clockButton.textContent = 'Load the clock'
  } else {
    // awaitCascade: the shell has mounted the view by the time this resolves
    await loader.loadModule(manifestOf('clock'), { awaitCascade: true })
    clockButton.textContent = 'Unload the clock'
  }
}

clockButton.addEventListener('click', () => void toggleClock())

proButton.addEventListener('click', async () => {
  if (loader.isDisabled('outline-pro')) {
    await loader.enableModule('outline-pro')
    proButton.textContent = 'Disable Outline Pro'
  } else {
    await loader.disableModule('outline-pro')
    proButton.textContent = 'Enable Outline Pro'
  }
})

/** Loads and unloads the clock on a timer, so coming and going is continuous */
let churn: ReturnType<typeof setInterval> | undefined

churnButton.addEventListener('click', () => {
  if (churn !== undefined) {
    clearInterval(churn)
    churn = undefined
    churnButton.textContent = 'Start churn'
    return
  }

  churn = setInterval(() => void toggleClock(), 2500)
  churnButton.textContent = 'Stop churn'
})

// ---------------------------------------------------------------- start

installDevtools({ loader, registry })

const discovered = await registry.discoverAll()
root.log(`discovered ${discovered.length} bundle(s)`)

// Everything except the clock, which the button loads
loader.register(
  registry.getManifests().filter(manifest => manifest.id !== 'clock')
)
await loader.loadAll()

root.log('workbench ready')
console.log('%cTry: tsm.lb() · tsm.providers("ui.component")', 'color: gray')
