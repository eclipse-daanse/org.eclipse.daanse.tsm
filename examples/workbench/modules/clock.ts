import { inject, injectable, type ModuleContext } from '../../../src/index.js'
import {
  METRICS_SERVICE,
  UI_COMPONENT,
  type Metrics,
  type UiComponent
} from '../src/contracts.js'

/**
 * A view with a running timer — the case where unmounting has to do something.
 * Without `unmount()` the interval would keep firing after the view is gone.
 */
@injectable()
class ClockView implements UiComponent {
  readonly title = 'Clock'

  private timer: ReturnType<typeof setInterval> | undefined
  private ticks = 0

  /**
   * Optional injection: the clock reports to the metrics service when it is
   * there and works without it when it is not. No requirement in the manifest —
   * `optional` is decided here, at the injection point.
   */
  constructor(@inject(METRICS_SERVICE, { optional: true }) private readonly metrics?: Metrics) {}

  mount(host: HTMLElement): void {
    const time = document.createElement('output')
    const counter = document.createElement('small')
    host.append(time, counter)

    const paint = () => {
      this.ticks += 1
      time.textContent = new Date().toLocaleTimeString()
      counter.textContent = ` ${this.ticks} tick${this.ticks === 1 ? '' : 's'}`
    }

    paint()
    this.timer = setInterval(paint, 1000)
    this.metrics?.note('clock mounted')
  }

  unmount(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
}

export function activate(context: ModuleContext): void {
  // Registered under the interface directly: a view needs no id of its own
  context.services.bindClass(UI_COMPONENT, ClockView)
}
