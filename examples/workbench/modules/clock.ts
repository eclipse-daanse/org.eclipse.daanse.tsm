import { activate, component, deactivate, inject } from '../../../src/index.js'
import {
  METRICS_SERVICE,
  UI_COMPONENT,
  type Metrics,
  type UiComponent
} from '../src/contracts.js'

/**
 * A declared component: no `activate` export, no `services.register()` call.
 * What it offers stands on the class, and the loader does the registering.
 *
 * `@activate` makes it an immediate component — it starts a ticking clock, which
 * has to happen whether or not anyone resolves its service.
 */
@component({
  service: [UI_COMPONENT],
  properties: { region: 'main', order: 1 }
})
export class ClockView implements UiComponent {
  readonly title = 'Clock'

  private timer: ReturnType<typeof setInterval> | undefined
  private ticks = 0
  private time: HTMLOutputElement | undefined
  private counter: HTMLElement | undefined

  /**
   * Optional injection: the clock reports to the metrics service when it is
   * there and works without it when it is not. No requirement in the manifest —
   * optionality is decided at the injection point.
   */
  constructor(@inject(METRICS_SERVICE, { optional: true }) private readonly metrics?: Metrics) {}

  @activate()
  start(): void {
    this.timer = setInterval(() => this.paint(), 1000)
  }

  /** Releases the interval — the difference between disappearing and leaking */
  @deactivate()
  stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }

  mount(host: HTMLElement): void {
    this.time = document.createElement('output')
    this.counter = document.createElement('small')
    host.append(this.time, this.counter)

    this.paint()
    this.metrics?.note('clock mounted')
  }

  unmount(): void {
    this.time = undefined
    this.counter = undefined
  }

  private paint(): void {
    this.ticks += 1
    if (this.time) this.time.textContent = new Date().toLocaleTimeString()
    if (this.counter) {
      this.counter.textContent = ` ${this.ticks} tick${this.ticks === 1 ? '' : 's'}`
    }
  }
}
