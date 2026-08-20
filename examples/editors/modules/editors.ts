/**
 * The two components that carry this example.
 *
 * `Toolbar` collects every tool with `@injectAll` and holds the array it was
 * given — the field option decides whether it keeps seeing changes.
 *
 * `Editor` is a factory component: it registers no service of its own, only a
 * factory. One instance per open file, and only the code that opens files knows
 * that a file was opened — which is exactly what a factory *configuration* could
 * not express.
 */

import { activate, component, deactivate, inject, injectAll } from '@eclipse-daanse/tsm/decorators'
import { conditionFilter } from '@eclipse-daanse/tsm'
import type { ComponentContext } from '@eclipse-daanse/tsm'
import {
  EDITOR_INSTANCE,
  EDITOR_TOOL,
  REPLACING_TOOLBAR,
  UPDATING_TOOLBAR,
  JOURNAL,
  UNDO_STACK,
  WORKSPACE_READY,
  type Journal,
  type Tool,
  type UndoStack
} from '../src/contracts.js'

/**
 * Collects the tools of every bundle.
 *
 * `fieldOption: 'update'` keeps the array's identity, so the host's view — which
 * holds a reference to `tools` from the moment the component started — keeps
 * seeing what is in it. With `replace` it would hold an array that is no longer
 * the component's own.
 */
@component({
  service: [UPDATING_TOOLBAR],
  satisfyingCondition: conditionFilter(WORKSPACE_READY)
})
export class UpdatingToolbar {
  @injectAll(EDITOR_TOOL, { fieldOption: 'update' })
  readonly tools: Tool[] = []

  @activate()
  start(context: ComponentContext): void {
    context.log.info(`toolbar up with ${this.tools.length} tool(s)`)
  }

  @deactivate()
  stop(context: ComponentContext): void {
    context.log.info('toolbar down')
  }
}

/**
 * The same thing with `replace`, side by side, because the difference is only
 * visible in the comparison.
 *
 * The host takes the `tools` array from both when they start and renders from
 * what it took. This one's array is replaced on every change, so what the host
 * holds stops being the component's own and freezes at the moment it was taken.
 * Nothing is broken here — it is what `replace` means, and why a view bound to
 * the array needs the other option.
 */
@component({
  service: [REPLACING_TOOLBAR],
  satisfyingCondition: conditionFilter(WORKSPACE_READY)
})
export class ReplacingToolbar {
  @injectAll(EDITOR_TOOL)
  tools: Tool[] = []

  @activate()
  start(): void {}
}

/**
 * One open editor. Built by whoever calls `newInstance`, not by configuration.
 *
 * It also injects the undo stack: the instance gets the one belonging to *this*
 * bundle, shared with the toolbar next to it and separate from the tool bundles'.
 */
@component({
  factory: 'editor',
  service: [EDITOR_INSTANCE],
  // An editor without a workspace makes no sense, so it waits for the same
  // condition. This is what makes the factory follow satisfaction visible: close
  // the workspace and the factory is withdrawn along with what it built
  satisfyingCondition: conditionFilter(WORKSPACE_READY)
})
export class Editor {
  private opened = ''

  constructor(
    @inject(UNDO_STACK) private readonly undo: UndoStack,
    @inject(JOURNAL, { optional: true }) private readonly journal?: Journal
  ) {}

  @activate()
  start(context: ComponentContext): void {
    this.opened = String(context.configuration.file ?? 'untitled')
    this.undo.push(`opened ${this.opened}`)
    this.journal?.note(`editor: opened ${this.opened}`)
  }

  @deactivate()
  stop(): void {
    this.undo.push(`closed ${this.opened}`)
    this.journal?.note(`editor: closed ${this.opened}`)
  }

  get file(): string {
    return this.opened
  }
}
