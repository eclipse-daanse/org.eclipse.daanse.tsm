/**
 * Contracts of the workbench example.
 *
 * A module contributes UI by registering a `UiComponent` and saying in its
 * properties which region it belongs to. Nothing imports another module.
 */

/** Every contributed view registers under this one ID */
export const UI_COMPONENT = 'ui.component'

export interface UiComponent {
  title: string

  /** Build the view inside the given element */
  mount(host: HTMLElement): void

  /**
   * Release what `mount` acquired: timers, listeners, observers.
   *
   * Called when the component goes away — the moment where a contributed view
   * either cleans up or leaks.
   */
  unmount?(): void
}

/**
 * Properties a contributed component is registered with.
 *
 * - `region`: where it goes; the shell selects per region with a target filter
 * - `order`: position inside the region
 * - `slot`: optional. Components sharing a slot compete instead of accumulating —
 *   the shell mounts only the highest ranked one. Without a slot, everything in
 *   the region is mounted side by side.
 */
export interface ComponentProperties {
  region: RegionName
  order: number
  slot?: string
}

/**
 * Counts what the workbench does. Registered as a class through `bindClass()`,
 * so the registry constructs it and injects what it declares.
 */
export const METRICS_SERVICE = 'workbench.metrics'

export interface Metrics {
  mounts(): number
  note(event: string): void
}

/** The shell's regions, provided by the host */
export const WORKBENCH_ROOT = 'workbench.root'

export type RegionName = 'toolbar' | 'sidebar' | 'main'

export interface WorkbenchRoot {
  region(name: RegionName): HTMLElement
  /** Write to the visible activity log, so coming and going is observable */
  log(message: string): void
}
