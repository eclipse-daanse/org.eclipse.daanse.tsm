import { component, inject } from '@eclipse-daanse/tsm/decorators'
import {
  METRICS_SERVICE,
  UI_COMPONENT,
  type Metrics,
  type UiComponent
} from '../../contracts.js'

/**
 * A declared component: no `activate` export, no `services.register()` call.
 * What it offers stands on the class, and the loader does the registering.
 *
 * No `@activate` either, on purpose — a view has nothing to do until it is
 * shown, so it is a delayed component: the class is constructed when a shell
 * resolves it, and never if none does. The interval belongs to `mount`, not to
 * the component's lifetime, or it would tick against nothing.
 *
 * The bundle declares no dependency on the shell. It registers a service and
 * does not know who collects it — reversing that would make a provider depend on
 * its consumer.
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

  mount(host: HTMLElement): void {
    this.time = document.createElement('output')
    this.counter = document.createElement('small')
    host.append(this.time, this.counter)

    this.paint()
    this.timer = setInterval(() => this.paint(), 1000)
    this.metrics?.note('clock mounted')
  }

  /** Releases the interval — the difference between disappearing and leaking */
  unmount(): void {
    clearInterval(this.timer)
    this.timer = undefined
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
