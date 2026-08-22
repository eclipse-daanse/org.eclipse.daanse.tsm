import type { ModuleManifest } from '../../../src/index.js'
import { Greeting, DemoUi, Widget } from './contracts.js'

/**
 * Registered in a deliberately unhelpful order: consumers first, providers last.
 * The load order follows from the manifests, not from this array.
 */
export const manifests: ModuleManifest[] = [
  {
    id: 'palette',
    name: 'Widget palette',
    version: '1.0.0',
    entry: '/modules/palette.ts',
    exports: {},
    requiresService: [
      { id: Widget, cardinality: '0..n', policy: 'dynamic' },
      { id: DemoUi }
    ]
  },
  {
    id: 'greeter',
    name: 'Greeting display',
    version: '1.0.0',
    entry: '/modules/greeter.ts',
    exports: {},
    requiresService: [
      { id: Greeting, policyOption: 'greedy' },
      { id: DemoUi }
    ]
  },
  {
    id: 'never-satisfied',
    name: 'Waits forever',
    version: '1.0.0',
    entry: '/modules/never-satisfied.ts',
    exports: {},
    requiresService: [{ id: 'demo.nobody-provides-this' }]
  },
  {
    id: 'chart-widget',
    name: 'Chart widget',
    version: '1.0.0',
    entry: '/modules/chart-widget.ts',
    exports: {},
    provides: [{ id: Widget, properties: { kind: 'chart' } }]
  },
  {
    id: 'table-widget',
    name: 'Table widget',
    version: '1.0.0',
    entry: '/modules/table-widget.ts',
    exports: {},
    provides: [{ id: Widget, properties: { kind: 'table' } }]
  },
  {
    id: 'greeting-basic',
    name: 'Basic greeting',
    version: '1.0.0',
    entry: '/modules/greeting-basic.ts',
    exports: {},
    provides: [{ id: Greeting }]
  },
  {
    id: 'greeting-premium',
    name: 'Premium greeting',
    version: '1.0.0',
    entry: '/modules/greeting-premium.ts',
    exports: {},
    // Outranks the basic greeting, so this is the visible one
    provides: [{ id: Greeting, ranking: 10 }]
  }
]

/** Loaded on demand, to show the palette growing at runtime */
export const lateWidget: ModuleManifest = {
  id: 'late-widget',
  name: 'Map widget (loaded later)',
  version: '1.0.0',
  entry: '/modules/late-widget.ts',
  exports: {},
  provides: [{ id: Widget, properties: { kind: 'map' } }]
}
