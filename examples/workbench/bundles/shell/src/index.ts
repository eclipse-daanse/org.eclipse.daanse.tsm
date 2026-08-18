import type { ModuleContext, ServiceReference } from '@eclipse-daanse/tsm'
import {
  UI_COMPONENT,
  WORKBENCH_ROOT,
  type RegionName,
  type UiComponent,
  type WorkbenchRoot
} from '../../contracts.js'

/**
 * Mounts every contributed component into its region and keeps that in step
 * while components come and go.
 *
 * Declared as `0..n` with `policy: 'dynamic'`, so the shell keeps running — it
 * is told about a change and reconciles, rather than being torn down.
 */

const REGIONS: RegionName[] = ['toolbar', 'sidebar', 'main']

/** What is currently on screen, keyed by the registration it came from */
const mounted = new Map<string, { host: HTMLElement; component: UiComponent }>()

export function activate(context: ModuleContext): void {
  sync(context)
}

export function deactivate(): void {
  for (const [key, entry] of mounted) {
    entry.component.unmount?.()
    entry.host.remove()
    mounted.delete(key)
  }
}

export function onServiceBound(context: ModuleContext, serviceId: string): void {
  if (serviceId === UI_COMPONENT) sync(context)
}

export function onServiceUnbound(context: ModuleContext, serviceId: string): void {
  if (serviceId === UI_COMPONENT) sync(context)
}

/**
 * Bring the DOM in line with the registrations.
 *
 * The hook says that the set changed, not which entry, so the shell diffs by
 * registration key — the same bookkeeping a keyed list in any UI framework does.
 */
function sync(context: ModuleContext): void {
  const root = context.services.get<WorkbenchRoot>(WORKBENCH_ROOT)
  if (!root) return

  const present = new Set<string>()

  for (const region of REGIONS) {
    const references = context.services
      .getServiceReferences(UI_COMPONENT, `(region=${region})`)
      .sort(byOrder)
    const visible = pickVisible(references)

    for (const reference of visible) {
      present.add(reference.key)
      if (mounted.has(reference.key)) continue

      const component = context.services.resolveReference<UiComponent>(reference)
      if (!component) continue

      const host = document.createElement('section')
      host.className = 'view'
      host.dataset.provider = reference.providedBy ?? 'unknown'

      const title = document.createElement('h3')
      title.textContent = component.title
      const body = document.createElement('div')
      host.append(title, body)
      root.region(region).append(host)

      component.mount(body)
      mounted.set(reference.key, { host, component })
      root.log(`mounted ${component.title} (${reference.providedBy}) in ${region}`)
    }

    // Re-append in declared order: a view that arrives later would otherwise sit
    // at the end regardless of its `order`. append() moves existing nodes.
    const ordered = visible
      .map(reference => mounted.get(reference.key)?.host)
      .filter((host): host is HTMLElement => host !== undefined)
    root.region(region).append(...ordered)
  }

  // Whatever is no longer registered has to be taken down and cleaned up
  for (const [key, entry] of mounted) {
    if (present.has(key)) continue

    entry.component.unmount?.()
    entry.host.remove()
    mounted.delete(key)
    root.log(`unmounted ${entry.component.title}`)
  }
}

function byOrder(left: ServiceReference, right: ServiceReference): number {
  return Number(left.properties.order ?? 0) - Number(right.properties.order ?? 0)
}

/**
 * Drop the components that lost their slot.
 *
 * A region collects everything — that is what `0..n` means. A slot is the other
 * case: several modules offer the same place, and only the highest ranked one is
 * shown, so disabling it brings the runner-up on screen.
 */
function pickVisible(references: ServiceReference[]): ServiceReference[] {
  const bestPerSlot = new Map<string, ServiceReference>()

  for (const reference of references) {
    const slot = reference.properties.slot
    if (typeof slot !== 'string') continue

    const incumbent = bestPerSlot.get(slot)
    if (!incumbent || reference.ranking > incumbent.ranking) {
      bestPerSlot.set(slot, reference)
    }
  }

  return references.filter(reference => {
    const slot = reference.properties.slot
    if (typeof slot !== 'string') return true
    return bestPerSlot.get(slot) === reference
  })
}
