import { component } from '@eclipse-daanse/tsm/decorators'
import { UI_COMPONENT, type UiComponent } from '../../contracts.js'

/** Toolbar view, to show that regions are selected by a target filter */
@component({
  service: [UI_COMPONENT],
  properties: { region: 'toolbar', order: 1 }
})
export class SearchBoxView implements UiComponent {
  readonly title = 'Search'

  mount(host: HTMLElement): void {
    const input = document.createElement('input')
    input.type = 'search'
    input.placeholder = 'search…'
    host.append(input)
  }
}
