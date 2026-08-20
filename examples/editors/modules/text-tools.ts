/**
 * Two tools, so the toolbar has something to collect — and so the collection
 * spans more than one bundle.
 *
 * The `dispose`/`restore` exports let the host withdraw them at runtime, which is
 * what makes the field option visible: with `replace` the view keeps the array it
 * was handed and never sees a thing.
 */

import type { ModuleContext, ServiceRegistration } from '@eclipse-daanse/tsm'
import {
  EDITOR_TOOL,
  JOURNAL,
  TOOLSET_CONTROL,
  UNDO_STACK,
  type Journal,
  type ToolsetControl,
  type UndoStack
} from '../src/contracts.js'

const registrations: ServiceRegistration[] = []
let host: ModuleContext | undefined

const tools = [
  { label: 'Bold', kind: 'text' },
  { label: 'Find', kind: 'text' }
]

export function activate(context: ModuleContext): void {
  // A start is a start: whatever this file still holds from a previous run refers
  // to a registry that is gone, and keeping it would make `restore()` believe it
  // had already registered
  registrations.length = 0
  host = context

  // Told apart from the other tool bundle by a property, which is what a target
  // filter is for
  const control: ToolsetControl = { restore, withdraw, isOffering }
  context.services.register(TOOLSET_CONTROL, control, { properties: { bundle: 'text-tools' } })

  restore()

  // The undo stack this bundle gets is its own, though the service id is shared
  const undo = context.services.get<UndoStack>(UNDO_STACK)
  undo?.push('text-tools started')
  context.services.get<Journal>(JOURNAL)?.note(
    `text-tools: undo stack has ${undo?.entries.length ?? 0} entry`
  )
}

function restore(): void {
  if (!host || registrations.length > 0) return

  for (const tool of tools) {
    // `instanceKey`, because both tools go under one id from one bundle: without
    // it the second registration would replace the first
    registrations.push(host.services.register(EDITOR_TOOL, tool, {
      properties: tool,
      instanceKey: tool.label
    }))
  }
  host.services.get<Journal>(JOURNAL)?.note('text-tools: 2 tools registered')
}

function withdraw(): void {
  if (registrations.length === 0) return

  for (const registration of registrations.splice(0)) registration.unregister()
  host?.services.get<Journal>(JOURNAL)?.note('text-tools: tools withdrawn')
}

function isOffering(): boolean {
  return registrations.length > 0
}

/**
 * The framework withdraws this bundle's registrations itself; what it cannot know
 * about is the state this file keeps beside them.
 */
export function deactivate(): void {
  registrations.length = 0
  host = undefined
}
