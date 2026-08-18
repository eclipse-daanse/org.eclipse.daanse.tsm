import type { ModuleContext } from '../../../src/index.js'
import { WIDGET_SERVICE, type Widget } from '../src/contracts.js'

const chart: Widget = {
  label: 'Chart',
  render: () => 'a chart'
}

export function activate(context: ModuleContext): void {
  // The properties are what a consumer's target filter selects on
  context.services.register(WIDGET_SERVICE, chart, { properties: { kind: 'chart' } })
  context.log.info('chart widget registered')
}
