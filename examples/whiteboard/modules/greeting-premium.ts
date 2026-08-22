import type { ModuleContext } from '../../../src/index.js'
import { Greeting } from '../src/contracts.js'

const premium: Greeting = {
  text: () => 'Hello from the premium greeting'
}

/**
 * Ranked above the basic one in the manifest, so this is what consumers see —
 * until the module is disabled, when the basic greeting takes over again.
 */
export function activate(context: ModuleContext): void {
  context.services.register(Greeting, premium)
}
