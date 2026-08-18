import type { ModuleContext } from '../../../src/index.js'
import { WIDGET_SERVICE, type Widget } from '../src/contracts.js'

const table: Widget = {
  label: 'Table',
  render: () => 'a table'
}

export function activate(context: ModuleContext): void {
  context.services.register(WIDGET_SERVICE, table, { properties: { kind: 'table' } })
  context.log.info('table widget registered')
}
