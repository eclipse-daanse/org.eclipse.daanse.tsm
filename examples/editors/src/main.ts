/**
 * TSM: what a component can be, beyond one instance per bundle.
 *
 * Four things that all attach to the same thing — an editor — because they were
 * built to work together, not to be demonstrated one at a time:
 *
 * - a **condition** decides when anything may start at all
 * - a **factory component** gives one editor per open file
 * - a **collection reference** gathers tools across bundles, and the field option
 *   decides whether a view bound to the array keeps seeing them
 * - a **module-scoped service** gives every bundle its own undo stack
 *
 * Everything on screen is read from the loader and the registry, so what you see
 * is the state of the system rather than a description of it.
 */

import 'reflect-metadata'
import {
  COMPONENT_FACTORY_SERVICE_ID,
  CONDITION_SERVICE_ID,
  CONDITION_ID,
  ModuleLoader,
  componentFactoryFilter,
  type ComponentFactory,
  type ComponentFactoryInstance
} from '@eclipse-daanse/tsm'
import { installDevtools } from '@eclipse-daanse/tsm/devtools'
import type { ModuleScopedServiceRegistry, ServiceRegistry } from '@eclipse-daanse/tsm'
import {
  JOURNAL,
  REPLACING_TOOLBAR,
  TOOLSET_CONTROL,
  UNDO_STACK,
  UPDATING_TOOLBAR,
  WORKSPACE_CONTROL,
  type Journal,
  type Tool,
  type ToolsetControl,
  type UndoStack,
  type WorkspaceControl
} from './contracts.js'
import { bundles } from './manifests.js'

const loader = new ModuleLoader()
installDevtools({ loader, name: 'tsm' })

/**
 * Reading as a particular module would, when the registry can do it.
 *
 * `getServiceRegistry()` hands out the plain `ServiceRegistry`, because the
 * application may have supplied its own — per-consumer reads are an optional
 * capability, and this is how the framework's own module facade tests for it.
 */
function asModule(moduleId: string): Pick<ServiceRegistry, 'get'> {
  const registry = loader.getServiceRegistry() as Partial<ModuleScopedServiceRegistry>
  if (typeof registry.getFor !== 'function') return loader.getServiceRegistry()

  const getFor = registry.getFor.bind(registry)
  return { get: <T>(id: string) => getFor<T>(moduleId, id) }
}

// ---------------------------------------------------------------- the journal

const lines: string[] = []

/**
 * A service, not a function the modules import.
 *
 * The bundles report through the registry like anything else, so nothing in them
 * knows about this page.
 */
loader.getServiceRegistry().register<Journal>(JOURNAL, {
  note(line: string) {
    lines.unshift(line)
    if (lines.length > 40) lines.pop()
    renderJournal()
  }
}, { providedBy: 'host' })

// ------------------------------------------------------- what the host holds

/**
 * The arrays the host took from the two toolbars when they started.
 *
 * Taken *once*, on purpose: that is what a view bound to a collection does, and
 * the only way the field option becomes visible instead of theoretical.
 */
let heldByUpdate: readonly Tool[] | undefined
let heldByReplace: readonly Tool[] | undefined

/**
 * The editors, read from the factory rather than kept here.
 *
 * The factory is the truth: it can lose its instances without this page being
 * asked — when the condition stops holding — and a list of our own would then
 * show editors that are gone.
 */
function openEditors(): readonly ComponentFactoryInstance[] {
  return theFactory()?.instances ?? []
}

// ------------------------------------------------------------------ rendering

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T

function renderJournal(): void {
  $('journal').innerHTML = lines
    .map(line => `<li>${escape_(line)}</li>`)
    .join('')
}

function escape_(text: string): string {
  const node = document.createElement('span')
  node.textContent = text
  return node.innerHTML
}

/** The bundles are driven through services, so this is how the page reaches them */
function workspaceControl(): WorkspaceControl | undefined {
  return loader.getServiceRegistry().get<WorkspaceControl>(WORKSPACE_CONTROL)
}

function toolsetControl(bundle: string): ToolsetControl | undefined {
  return loader.getServiceRegistry()
    .getMatching<ToolsetControl>(TOOLSET_CONTROL, `(bundle=${bundle})`)
}

function renderCondition(): void {
  const loaded = workspaceControl()?.isLoaded() === true

  $('workspace-state').innerHTML = loaded
    ? '<span class="ok">workspace.ready holds</span>'
    : '<span class="warn">workspace.ready does not hold</span>'
  $('workspace-load').textContent = loaded ? 'Close workspace' : 'Load workspace'

  // Every condition in the registry, so what holds is read rather than assumed
  const held = loader.getServiceRegistry()
    .getServiceReferences(CONDITION_SERVICE_ID)
    .map(reference => String(reference.properties[CONDITION_ID]))
  $('conditions').innerHTML = held
    .map(id => `<li><code>${escape_(id)}</code></li>`)
    .join('')
}

function theFactory(): ComponentFactory | undefined {
  return loader.getServiceRegistry().getMatching<ComponentFactory>(
    COMPONENT_FACTORY_SERVICE_ID, componentFactoryFilter('editor')
  )
}

function renderFactory(): void {
  const factory = theFactory()

  $('factory-state').innerHTML = factory
    ? `<span class="ok">factory 'editor' registered</span> · ` +
      `${factory.instances.length} instance(s)`
    : '<span class="warn">no factory — the component is not satisfied</span>'
  $('open-editor').toggleAttribute('disabled', factory === undefined)

  const open = openEditors()
  $('editors').innerHTML = open.length === 0
    ? '<li class="muted">nothing open</li>'
    : open.map((handle, at) => {
        const file = String(handle.properties.file)
        return `<li><code>${escape_(file)}</code>` +
          `<button data-close="${at}" class="link">close</button></li>`
      }).join('')

  const buttons = Array.from(
    $('editors').querySelectorAll<HTMLButtonElement>('[data-close]')
  )
  for (const button of buttons) {
    button.addEventListener('click', () => {
      void closeEditor(Number(button.dataset.close))
    })
  }
}

function renderToolbars(): void {
  const registry = loader.getServiceRegistry()
  const offered = registry.countProviders('editor.tool')

  const updating = registry.get<{ tools: readonly Tool[] }>(UPDATING_TOOLBAR)
  const replacing = registry.get<{ tools: readonly Tool[] }>(REPLACING_TOOLBAR)

  // Take the arrays the first time each toolbar exists, then keep them
  heldByUpdate ??= updating?.tools
  heldByReplace ??= replacing?.tools

  $('tools-offered').textContent = String(offered)

  const list = (tools: readonly Tool[] | undefined): string =>
    tools === undefined
      ? '<li class="muted">not started</li>'
      : tools.length === 0
        ? '<li class="muted">empty</li>'
        : tools.map(tool =>
            `<li><code>${escape_(tool.label)}</code> <span class="muted">${escape_(tool.kind)}</span></li>`
          ).join('')

  $('tools-update').innerHTML = list(heldByUpdate)
  $('tools-replace').innerHTML = list(heldByReplace)

  // The component's own field, for comparison with what the host holds
  $('tools-replace-live').textContent = replacing
    ? String(replacing.tools.length)
    : '–'

  const stale = heldByReplace !== undefined && replacing !== undefined &&
    heldByReplace !== replacing.tools
  $('replace-note').innerHTML = stale
    ? '<span class="warn">what the host holds is no longer the component\'s array</span>'
    : '<span class="muted">still the same array</span>'
}

function renderStacks(): void {
  // One row per module that could hold a stack, asking as that module would
  const rows = ['text-tools', 'draw-tools', 'editors'].map(moduleId => {
    const stack = asModule(moduleId).get<UndoStack>(UNDO_STACK)
    const entries = stack?.entries ?? []
    return `<tr><td><code>${escape_(moduleId)}</code></td>` +
      `<td>${entries.length}</td>` +
      `<td class="muted">${escape_(entries.join(', ') || '—')}</td></tr>`
  }).join('')

  $('stacks').innerHTML = rows
}

function renderComponents(): void {
  $('components').innerHTML = loader.getComponents().map(declaration => {
    const traits = [
      declaration.factory ? `factory '${declaration.factory.name}'` : undefined,
      declaration.satisfyingCondition ? 'waits for a condition' : undefined,
      ...declaration.collections.map(c => `collects ${c.serviceId} · ${c.fieldOption}`)
    ].filter(Boolean).join(' · ')

    const state = declaration.configurations[0]?.state ?? 'unknown'
    const ok = !state.startsWith('unsatisfied')

    return `<li><code>${escape_(declaration.className)}</code> ` +
      `<span class="muted">${escape_(declaration.moduleId)}</span> ` +
      `<span class="${ok ? 'ok' : 'warn'}">${escape_(state)}</span>` +
      (traits ? `<br /><span class="muted">${escape_(traits)}</span>` : '') +
      `</li>`
  }).join('')
}

function render(): void {
  renderCondition()
  renderFactory()
  renderToolbars()
  renderStacks()
  renderComponents()
}

// -------------------------------------------------------------------- actions

async function toggleWorkspace(): Promise<void> {
  const workspace = workspaceControl()
  if (!workspace) return

  if (workspace.isLoaded()) workspace.unload()
  else workspace.load()

  // The loader reacts to registry events on a queue, so wait for it to settle
  // before reading the state — this is the one place where asynchronous module
  // loading shows through
  await loader.settle()
  render()
}

async function openEditor(): Promise<void> {
  const factory = theFactory()
  if (!factory) return

  const file = ($('file-name') as HTMLInputElement).value.trim() || 'untitled.txt'
  await factory.newInstance({ file })
  await loader.settle()
  render()
}

async function closeEditor(at: number): Promise<void> {
  await openEditors()[at]?.dispose()
  await loader.settle()
  render()
}

async function toggleTools(moduleId: string): Promise<void> {
  const tools = toolsetControl(moduleId)
  if (!tools) return

  if (tools.isOffering()) tools.withdraw()
  else tools.restore()

  await loader.settle()
  render()
}

// ----------------------------------------------------------------------- boot

loader.register(bundles)
await loader.loadAll()
await loader.settle()

$('workspace-load').addEventListener('click', () => void toggleWorkspace())
$('open-editor').addEventListener('click', () => void openEditor())
$('toggle-text').addEventListener('click', () => void toggleTools('text-tools'))
$('toggle-draw').addEventListener('click', () => void toggleTools('draw-tools'))

render()
