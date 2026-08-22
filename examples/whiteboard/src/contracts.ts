/**
 * The service contracts of this example.
 *
 * Each service is named once, with `serviceId()`, which ties the id to the
 * contract it stands for. The name is deliberately the same in both namespaces —
 * TypeScript keeps values and types apart — so a consumer writes one import and
 * one name:
 *
 * ```typescript
 * import { Widget } from './contracts.js'
 * constructor(@inject(Widget) private widget: Widget) {}
 * ```
 *
 * At runtime these are plain strings, which is what lets a manifest, a target
 * filter and a capability all keep working. Types are shared through imports that
 * leave no runtime trace, so a module can be typed against a service it never
 * bundles.
 */

import { serviceId } from '@eclipse-daanse/tsm'

/** A widget offered to the palette. Several modules provide this ID. */
export interface Widget {
  label: string
  render(): string
}
export const Widget = serviceId<Widget>('demo.widget')

/** A greeting. Two modules provide it; ranking decides which one is visible. */
export interface Greeting {
  text(): string
}
export const Greeting = serviceId<Greeting>('demo.greeting')

/** Where the palette and the greeting are shown. Provided by the host. */
export interface DemoUi {
  setPalette(widgets: Array<{ label: string; kind: string; providedBy: string }>): void
  setGreeting(text: string): void
}
export const DemoUi = serviceId<DemoUi>('demo.ui')
