/**
 * The undo stack — one per consuming module.
 *
 * This is what `module` scope is for. An undo stack keeps state *about* whoever
 * uses it: a singleton would mix two bundles' history into one list, and
 * `transient` would lose it between two calls.
 */

import type { ModuleContext } from '@eclipse-daanse/tsm'
import { JOURNAL, UNDO_STACK, type Journal, type UndoStack } from '../src/contracts.js'

export function activate(context: ModuleContext): void {
  let built = 0

  // `bind` with a factory, so the registry can call it once per consumer
  context.services.bind<UndoStack>(UNDO_STACK, () => {
    const entries: string[] = []
    const serial = ++built

    context.services.get<Journal>(JOURNAL)?.note(
      `history: built undo stack #${serial}`
    )

    return {
      entries,
      push(what: string) { entries.push(what) },
      // Called when the holding module goes: a per-module instance outliving its
      // module is exactly the leak this scope would otherwise introduce
      dispose() {
        context.services.get<Journal>(JOURNAL)?.note(
          `history: disposed undo stack #${serial} (${entries.length} entries)`
        )
      }
    }
  }, { scope: 'module' })

  context.log.info('undo stacks on offer, one per module')
}
