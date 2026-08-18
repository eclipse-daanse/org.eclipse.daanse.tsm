import type { ModuleContext } from '../../../src/index.js'
import { GREETING_SERVICE, type Greeting } from '../src/contracts.js'

const basic: Greeting = {
  text: () => 'Hello from the basic greeting'
}

export function activate(context: ModuleContext): void {
  // No ranking, so this is the fallback
  context.services.register(GREETING_SERVICE, basic)
}
