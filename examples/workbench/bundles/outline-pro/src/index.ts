import { component } from '@eclipse-daanse/tsm/decorators'
import { UI_COMPONENT, type UiComponent } from '../../contracts.js'

/**
 * The same sidebar slot, ranked higher in the manifest. Both registrations
 * exist; the shell shows this one and falls back to the plain outline when this
 * module is disabled.
 */
@component({
  service: [UI_COMPONENT],
  properties: { region: 'sidebar', order: 1, slot: 'outline' },
  ranking: 10
})
export class OutlineProView implements UiComponent {
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
