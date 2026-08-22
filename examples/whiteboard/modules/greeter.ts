import type { ModuleContext } from '../../../src/index.js'
import { Greeting, DemoUi } from '../src/contracts.js'

/**
 * Requires the greeting with `policyOption: "greedy"`, so it is rebuilt when a
 * better-ranked provider appears or disappears — that is how the displayed text
 * follows the ranking instead of sticking to whatever was there first.
 */
export function activate(context: ModuleContext): void {
  const greeting = context.services.getRequired<Greeting>(Greeting)
  context.services.get<DemoUi>(DemoUi)?.setGreeting(greeting.text())
}
