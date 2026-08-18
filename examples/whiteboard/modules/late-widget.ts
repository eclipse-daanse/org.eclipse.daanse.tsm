import type { ModuleContext } from '../../../src/index.js'
import { WIDGET_SERVICE, type Widget } from '../src/contracts.js'

const map: Widget = {
  label: 'Map',
  render: () => 'a map'
}

/**
 * Loaded on a button press rather than at startup, to show that the palette
 * picks it up without being restarted.
 */
export function activate(context: ModuleContext): void {
  context.services.register(WIDGET_SERVICE, map, { properties: { kind: 'map' } })
  context.log.info('late widget registered')
}
