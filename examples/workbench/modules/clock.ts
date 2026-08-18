import type { ModuleContext } from '../../../src/index.js'
import { UI_COMPONENT, type UiComponent } from '../src/contracts.js'

/**
 * A view with a running timer — the case where unmounting has to do something.
 * Without `unmount()` the interval would keep firing after the view is gone.
 */
function createClock(): UiComponent {
  let timer: ReturnType<typeof setInterval> | undefined
  let ticks = 0

  return {
    title: 'Clock',

    mount(host) {
      const time = document.createElement('output')
      const counter = document.createElement('small')
      host.append(time, counter)

      const paint = () => {
        ticks += 1
        time.textContent = new Date().toLocaleTimeString()
        counter.textContent = ` ${ticks} tick${ticks === 1 ? '' : 's'}`
      }

      paint()
      timer = setInterval(paint, 1000)
    },

    unmount() {
      clearInterval(timer)
      timer = undefined
    }
  }
}

export function activate(context: ModuleContext): void {
  // Where it goes is declared in the manifest, not here
  context.services.register(UI_COMPONENT, createClock())
}
