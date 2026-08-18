import { injectable, type ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/** Sidebar view without a ranking — the plain variant of the outline slot */
@injectable()
class OutlineView implements UiComponent {
  readonly title = 'Outline'

  mount(host: HTMLElement): void {
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
  context.services.bindClass(UI_COMPONENT, OutlineView)
}
