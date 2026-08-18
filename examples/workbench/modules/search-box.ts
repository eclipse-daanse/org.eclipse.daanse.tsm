import { injectable, type ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/** Toolbar view, to show that regions are selected by a target filter */
@injectable()
class SearchBoxView implements UiComponent {
  readonly title = 'Search'

  mount(host: HTMLElement): void {
    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'search…'
    host.append(input)
  }
}

export function activate(context: ModuleContext): void {
  context.services.bindClass(UI_COMPONENT, SearchBoxView)
}
