/**
 * The service contracts of this example.
 *
 * Types are shared through plain imports — they leave no runtime trace, so a
 * module can be typed against a service it never bundles.
 */

/** A widget offered to the palette. Several modules provide this ID. */
export const WIDGET_SERVICE = 'demo.widget'

export interface Widget {
  label: string
  render(): string
}

/** A greeting. Two modules provide it; ranking decides which one is visible. */
export const GREETING_SERVICE = 'demo.greeting'

export interface Greeting {
  text(): string
}

/** Where the palette and the greeting are shown. Provided by the host. */
export const UI_SERVICE = 'demo.ui'

export interface DemoUi {
  setPalette(widgets: Array<{ label: string; kind: string; providedBy: string }>): void
  setGreeting(text: string): void
}
