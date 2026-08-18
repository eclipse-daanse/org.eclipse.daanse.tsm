import { component, activate, deactivate, inject, singleton } from '@eclipse-daanse/tsm/decorators'
import {
  METRICS_SERVICE,
  UI_COMPONENT,
  WORKBENCH_ROOT,
  type Metrics,
  type UiComponent,
  type WorkbenchRoot
} from '../../contracts.js'

/**
 * Two components in one bundle. Each declares its own service, so neither needs
 * `implements` — a class answering to two ids is a different thing from two
 * classes offering one each.
 */
@component({ service: [METRICS_SERVICE] })
@singleton()
export class WorkbenchMetrics implements Metrics {
  private mountCount = 0

  constructor(@inject(WORKBENCH_ROOT) private readonly root: WorkbenchRoot) {}

  mounts(): number {
    return this.mountCount
  }

  note(event: string): void {
    this.mountCount += 1
    this.root.log(`metrics: ${event} (${this.mountCount} total)`)
  }
}

@component({
  service: [UI_COMPONENT],
  properties: { region: 'main', order: 3 }
})
export class MetricsView implements UiComponent {
  readonly title = 'Metrics'

  constructor(@inject(METRICS_SERVICE) private readonly metrics: Metrics) {}

  /**
   * This one does have something to do without being shown: it records that it
   * exists. That makes it an immediate component.
   */
  @activate()
  start(): void {
    this.metrics.note('metrics view created')
  }

  @deactivate()
  stop(): void {
    this.metrics.note('metrics view gone')
  }

  mount(host: HTMLElement): void {
    const value = document.createElement('output')
    value.textContent = String(this.metrics.mounts())
    const label = document.createElement('small')
    label.textContent = ' events recorded'
    host.append(value, label)
  }
}
