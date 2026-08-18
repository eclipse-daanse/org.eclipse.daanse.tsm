import { injectable, type ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/**
 * The same sidebar slot, ranked higher in the manifest. Both registrations
 * exist; the shell shows this one and falls back to the plain outline when this
 * module is disabled.
 */
@injectable()
class OutlineProView implements UiComponent {
  readonly title = 'Outline Pro'

  mount(host: HTMLElement): void {
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
  context.services.bindClass(UI_COMPONENT, OutlineProView)
}
