import type { ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/** Sidebar view, provided without a ranking — the plain variant */
const outline: UiComponent = {
  title: 'Outline',
  mount(host) {
    const list = document.createElement('ul')
    list.append(...['Introduction', 'Method', 'Results'].map(entry => {
      const item = document.createElement('li')
      item.textContent = entry
      return item
    }))
    host.append(list)
  }
}

export function activate(context: ModuleContext): void {
  // Where it goes is declared in the manifest, not here
  context.services.register(UI_COMPONENT, outline)
}
