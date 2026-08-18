/**
 * TSM Whiteboard example — host application.
 *
 * Wires a loader, publishes the UI as a service, and loads the modules. What the
 * modules do with each other is decided by their manifests.
 */

import { installDevtools } from '../../../src/devtools/index.js'
import { DependencyResolver } from '../../../src/DependencyResolver.js'
import { ModuleLoader } from '../../../src/ModuleLoader.js'
import { initTsmRuntime, tsmRuntime } from '../../../src/TsmRuntime.js'
import { UI_SERVICE, type DemoUi } from './contracts.js'
import { lateWidget, manifests } from './manifests.js'

initTsmRuntime()

const loader = new ModuleLoader()
const services = loader.getServiceRegistry()

// ---------------------------------------------------------------- the UI service

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing element: #${id}`)
  return found as T
}

const ui: DemoUi = {
  setPalette(widgets) {
    const list = element<HTMLUListElement>('palette-list')
    if (widgets.length === 0) {
      list.innerHTML = '<li class="empty">nothing yet</li>'
      return
    }

    list.replaceChildren(...widgets.map(widget => {
      const item = document.createElement('li')
      item.textContent = widget.label
      const kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = `${widget.kind} · from ${widget.providedBy}`
      item.append(kind)
      return item
    }))
  },

  setGreeting(text) {
    element('greeting-text').textContent = text
  }
}

// The host is a provider like any module
services.register(UI_SERVICE, ui, { providedBy: 'host' })

// ---------------------------------------------------------------- module table

function renderModules(): void {
  const table = element<HTMLTableElement>('module-table')

  table.replaceChildren(...loader.getManifests().map(manifest => {
    const state = loader.getModule(manifest.id)?.state ?? 'not loaded'
    const row = document.createElement('tr')

    const name = document.createElement('td')
    name.textContent = manifest.id

    const status = document.createElement('td')
    status.className = `state ${state.replace(' ', '-')}`
    status.textContent = loader.isDisabled(manifest.id) ? `${state} (disabled)` : state

    row.append(name, status)
    return row
  }))
}

// Any lifecycle change redraws the table
loader.addEventListener({ onModuleEvent: () => renderModules() })

// ---------------------------------------------------------------- controls

element('load-late').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true

  // awaitCascade: the palette has reacted by the time this resolves
  await loader.loadModule(lateWidget, { awaitCascade: true })
  renderModules()
})

element('toggle-premium').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement

  if (loader.isDisabled('greeting-premium')) {
    await loader.enableModule('greeting-premium')
    button.textContent = 'Disable premium greeting'
  } else {
    await loader.disableModule('greeting-premium')
    button.textContent = 'Enable premium greeting'
  }
  renderModules()
})

element('unload-table').addEventListener('click', async event => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true

  await loader.unloadModule('table-widget')
  renderModules()
})

// ---------------------------------------------------------------- start

loader.register(manifests)

installDevtools({
  loader,
  resolver: new DependencyResolver(),
  runtime: tsmRuntime
})

await loader.loadAll()
renderModules()

console.log(
  '%cTry: tsm.modules() · tsm.unsatisfied() · tsm.providers(%c"demo.widget"%c)',
  'color: gray',
  'color: cyan',
  'color: gray'
)
