import { inject, injectable, singleton, type ModuleContext } from '../../../src/index.js'
import {
  METRICS_SERVICE,
  UI_COMPONENT,
  WORKBENCH_ROOT,
  type Metrics,
  type UiComponent,
  type WorkbenchRoot
} from '../src/contracts.js'

/**
 * The only module that registers a service of its own alongside its view, so it
 * is the one that needs `implements`: the class answers to both ids, and the
 * manifest describes each of them separately.
 */
@injectable()
@singleton()
class WorkbenchMetrics implements Metrics {
  private mountCount = 0

  // Constructed by the registry, with the host's service handed in
  constructor(@inject(WORKBENCH_ROOT) private readonly root: WorkbenchRoot) {}

  mounts(): number {
    return this.mountCount
  }

  note(event: string): void {
    this.mountCount += 1
    this.root.log(`metrics: ${event} (${this.mountCount} total)`)
  }
}

/** A view that consumes the injected service */
@injectable()
class MetricsView implements UiComponent {
  readonly title = 'Metrics'

  constructor(@inject(METRICS_SERVICE) private readonly metrics: Metrics) {}

  mount(host: HTMLElement): void {
    this.metrics.note('metrics view mounted')

    const value = document.createElement('output')
    value.textContent = String(this.metrics.mounts())
    const label = document.createElement('small')
    label.textContent = ' events recorded'
    host.append(value, label)
  }
}

export function activate(context: ModuleContext): void {
  // Lazily constructed: nothing is built until someone resolves it
  context.services.bindClass(METRICS_SERVICE, WorkbenchMetrics)
  context.services.bindClass('workbench.metrics-view', MetricsView, {
    implements: [UI_COMPONENT]
  })
}
