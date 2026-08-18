import type { ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/** A view with a listener, which `unmount()` takes off again */
function createNotes(): UiComponent {
  let field: HTMLTextAreaElement | undefined
  let onInput: (() => void) | undefined

  return {
    title: 'Notes',

    mount(host) {
      field = document.createElement('textarea')
      field.rows = 3
      field.placeholder = 'survives nothing — this view is a demo'

      const count = document.createElement('small')
      onInput = () => { count.textContent = ` ${field?.value.length ?? 0} characters` }
      field.addEventListener('input', onInput)

      host.append(field, count)
    },

    unmount() {
      if (field && onInput) field.removeEventListener('input', onInput)
      field = undefined
      onInput = undefined
    }
  }
}

export function activate(context: ModuleContext): void {
  // Where it goes is declared in the manifest, not here
  context.services.register(UI_COMPONENT, createNotes())
}
