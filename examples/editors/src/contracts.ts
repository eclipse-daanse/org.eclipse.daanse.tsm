/**
 * What the bundles of this example agree on.
 *
 * Ids and types only: a contract module carries no implementation, so a bundle
 * importing it takes on no dependency on whoever provides the service.
 */

/** A tool a toolbar collects. Several bundles offer these. */
export const EDITOR_TOOL = 'editor.tool'

/** One open editor, registered by the factory per instance */
export const EDITOR_INSTANCE = 'editor.instance'

/** The undo stack — one per consuming module, which is the point of it */
export const UNDO_STACK = 'undo.stack'

/** The condition the workspace registers once it has loaded */
export const WORKSPACE_READY = 'workspace.ready'

/** Where the example reports what happened */
export const JOURNAL = 'demo.journal'

export interface Tool {
  readonly label: string
  readonly kind: string
}

export interface UndoStack {
  push(what: string): void
  readonly entries: readonly string[]
  /** Called by the framework when the holding module is deactivated */
  dispose(): void
}

export interface OpenEditor {
  readonly file: string
  readonly tools: readonly Tool[]
}

export interface Journal {
  note(line: string): void
}

/** The toolbar that keeps its array — `fieldOption: 'update'` */
export const UPDATING_TOOLBAR = 'demo.toolbar.update'

/** The same with `replace`, for the comparison */
export const REPLACING_TOOLBAR = 'demo.toolbar.replace'

/**
 * How the page drives the bundles: through the registry, like anything else.
 *
 * A host reaching into a module's exports would be reaching past the very seam
 * the service layer exists to provide.
 */
export const WORKSPACE_CONTROL = 'demo.workspace'

/** One per tool bundle, told apart by its `bundle` property */
export const TOOLSET_CONTROL = 'demo.toolset'

export interface WorkspaceControl {
  load(): void
  unload(): void
  isLoaded(): boolean
}

export interface ToolsetControl {
  restore(): void
  withdraw(): void
  isOffering(): boolean
}
