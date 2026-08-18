import type { ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/** Toolbar view, to show that regions are selected by a target filter */
const searchBox: UiComponent = {
  title: 'Search',
  mount(host) {
    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'search…'
    host.append(input)
  }
}

export function activate(context: ModuleContext): void {
  // Where it goes is declared in the manifest, not here
  context.services.register(UI_COMPONENT, searchBox)
}
