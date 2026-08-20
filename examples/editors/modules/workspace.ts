/**
 * The bundle that decides when the others may start.
 *
 * A condition is a service with no behaviour — only the statement that something
 * is the case. Nothing here knows who waits for it, and nothing that waits knows
 * who decides. That is the whole point over a marker service somebody depends on
 * by name.
 */

import type { ModuleContext, ServiceRegistration } from '@eclipse-daanse/tsm'
import { CONDITION_SERVICE_ID, TRUE_CONDITION, conditionProperties } from '@eclipse-daanse/tsm'
import {
  JOURNAL,
  WORKSPACE_CONTROL,
  WORKSPACE_READY,
  type Journal,
  type WorkspaceControl
} from '../src/contracts.js'

let registration: ServiceRegistration | undefined
let host: ModuleContext | undefined

export function activate(context: ModuleContext): void {
  // As in the tool bundles: a handle from a previous run points at a registry
  // that is gone, and would make `load()` think the condition already holds
  registration = undefined
  host = context

  // The page drives this bundle through a service, not through its exports: the
  // service layer is the seam, and reaching past it would make the example show
  // the opposite of what it is about
  const control: WorkspaceControl = { load, unload, isLoaded }
  context.services.register(WORKSPACE_CONTROL, control)

  context.log.info('workspace bundle active — nothing loaded yet')
}

/** Called through {@link WORKSPACE_CONTROL} when the workspace "finished loading" */
function load(): void {
  if (!host || registration) return

  registration = host.services.register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
    properties: conditionProperties(WORKSPACE_READY)
  })
  host.services.get<Journal>(JOURNAL)?.note(`workspace: ${WORKSPACE_READY} now holds`)
}

/** And when it is closed again */
function unload(): void {
  if (!registration) return

  registration.unregister()
  registration = undefined
  host?.services.get<Journal>(JOURNAL)?.note(`workspace: ${WORKSPACE_READY} withdrawn`)
}

function isLoaded(): boolean {
  return registration !== undefined
}

/** What the framework cannot withdraw for this bundle: the state beside it */
export function deactivate(): void {
  registration = undefined
  host = undefined
}
