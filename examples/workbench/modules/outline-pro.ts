import type { ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/**
 * The same sidebar slot, ranked higher in the manifest. Both registrations
 * exist; the shell shows this one and falls back to the plain outline when this
 * module is disabled.
 */
const outlinePro: UiComponent = {
  title: 'Outline Pro',
  mount(host) {
    const list = document.createElement('ol')
    list.append(...['Introduction', 'Method', 'Results', 'Discussion', 'Appendix'].map(entry => {
      const item = document.createElement('li')
      item.textContent = entry
      return item
    }))
    host.append(list)
  }
}

export function activate(context: ModuleContext): void {
  // Where it goes is declared in the manifest, not here
  context.services.register(UI_COMPONENT, outlinePro)
}
