import type { ModuleContext } from '../../../src/index.js'
import { Widget } from '../src/contracts.js'

const chart: Widget = {
  label: 'Chart',
  render: () => 'a chart'
}

export function activate(context: ModuleContext): void {
  // The properties are what a consumer's target filter selects on
  context.services.register(Widget, chart, { properties: { kind: 'chart' } })
  context.log.info('chart widget registered')
}
