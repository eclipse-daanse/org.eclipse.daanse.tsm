import { component } from '@eclipse-daanse/tsm/decorators'
import { UI_COMPONENT, type UiComponent } from '../../contracts.js'

/** Sidebar view without a ranking — the plain variant of the outline slot */
@component({
  service: [UI_COMPONENT],
  properties: { region: 'sidebar', order: 1, slot: 'outline' }
})
export class OutlineView implements UiComponent {
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
