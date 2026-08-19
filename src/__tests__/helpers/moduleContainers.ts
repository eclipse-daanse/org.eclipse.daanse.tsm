/**
 * Handing modules to a loader in tests, without a global.
 *
 * Modules used to arrive through `window[moduleId]`, so every test had to fake
 * `globalThis.window` — which is why the loader could not run in Node at all.
 * Now they are handed over explicitly, and these tests run in plain Node.
 *
 * `containers` is per test file: Vitest gives each file its own module instance.
 */

import { ModuleLoader } from '../../ModuleLoader'
import type { ModuleLoaderOptions } from '../../types'

/** The modules this file hands over, keyed by module id */
export const containers: Record<string, unknown> = {}

/** Clear the table between tests */
export function resetContainers(): void {
  for (const id of Object.keys(containers)) {
    delete containers[id]
  }
}

/** A loader that takes its modules from {@link containers} */
export function testLoader(options: ModuleLoaderOptions = {}): ModuleLoader {
  return new ModuleLoader({
    entryResolver: manifest => containers[manifest.id],
    ...options
  })
}
