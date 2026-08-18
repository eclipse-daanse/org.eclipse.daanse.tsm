import { component } from '@eclipse-daanse/tsm/decorators'
import { UI_COMPONENT, type UiComponent } from '../../contracts.js'

/** A view with a listener, which `unmount()` takes off again */
@component({
  service: [UI_COMPONENT],
  properties: { region: 'main', order: 2 }
})
export class NotesView implements UiComponent {
  readonly title = 'Notes'

  private field: HTMLTextAreaElement | undefined
  private onInput: (() => void) | undefined

  mount(host: HTMLElement): void {
    const field = document.createElement('textarea')
    field.rows = 3
    field.placeholder = 'survives nothing — this view is a demo'

    const count = document.createElement('small')
    this.onInput = () => { count.textContent = ` ${field.value.length} characters` }
    field.addEventListener('input', this.onInput)

    host.append(field, count)
    this.field = field
  }

  unmount(): void {
    if (this.field && this.onInput) {
      this.field.removeEventListener('input', this.onInput)
    }
    this.field = undefined
    this.onInput = undefined
  }
}
