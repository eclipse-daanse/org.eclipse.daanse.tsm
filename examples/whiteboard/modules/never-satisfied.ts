import type { ModuleContext } from '../../../src/index.js'

/**
 * Requires a service nobody provides, so it stays parked. It is here to be
 * found: `tsm.unsatisfied()` in the console names it and what it waits for.
 */
export function activate(context: ModuleContext): void {
  context.log.warn('this should never run')
}
