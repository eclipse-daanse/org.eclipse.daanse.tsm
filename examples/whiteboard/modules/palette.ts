import type { ModuleContext, ServiceReference } from '../../../src/index.js'
import { UI_SERVICE, WIDGET_SERVICE, type DemoUi, type Widget } from '../src/contracts.js'

/**
 * Collects every widget. Declared as `0..n` with `policy: "dynamic"`, so the
 * module keeps running while the set changes and is told when it does.
 */
export function activate(context: ModuleContext): void {
  render(context)
}

export function onServiceBound(context: ModuleContext, serviceId: string): void {
  context.log.info(`a provider of ${serviceId} joined`)
  render(context)
}

export function onServiceUnbound(context: ModuleContext, serviceId: string): void {
  context.log.info(`a provider of ${serviceId} left`)
  render(context)
}

function render(context: ModuleContext): void {
  const ui = context.services.get<DemoUi>(UI_SERVICE)
  if (!ui) return

  const widgets = context.services
    .getServiceReferences(WIDGET_SERVICE)
    .map((reference: ServiceReference) => ({
      label: context.services.resolveReference<Widget>(reference)?.label ?? '?',
      kind: String(reference.properties.kind ?? 'unknown'),
      providedBy: reference.providedBy ?? 'unknown'
    }))

  ui.setPalette(widgets)
}
