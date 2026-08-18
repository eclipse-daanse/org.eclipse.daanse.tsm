/**
 * Draws the three layers as SVG: bundles at the top, their components below, the
 * services they meet at in the third row.
 *
 * Hand-rolled rather than a library, because the layout is a fixed three-row grid
 * and the point is what the loader reports, not the drawing.
 */

import type { ComponentInfo, ModuleState, ServiceReference } from '@eclipse-daanse/tsm'

export interface BundleNode {
  id: string
  state: ModuleState | 'not loaded'
  disabled: boolean
  waitingFor: string[]
  components: ComponentInfo[]
}

export interface ServiceNode {
  id: string
  references: ServiceReference[]
  /** Modules that declared a requirement on it, with how they asked */
  consumers: Array<{ moduleId: string; optional: boolean }>
}

export interface GraphModel {
  bundles: BundleNode[]
  services: ServiceNode[]
}

const BOX = {
  width: 156,
  gap: 24,
  bundleHeight: 44,
  componentHeight: 38,
  componentGap: 8,
  serviceHeight: 38
}
const ROW = { bundles: 46, components: 170 }
const PADDING = 16

const svgNs = 'http://www.w3.org/2000/svg'

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(svgNs, name)
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value))
  }
  return node
}

function text(x: number, y: number, content: string, className: string): SVGTextElement {
  const node = el('text', { x, y, class: className })
  node.textContent = content
  return node
}

/** A curve from one box's bottom edge to another box's top edge */
function link(from: { x: number; y: number }, to: { x: number; y: number }, className: string) {
  const midpoint = (from.y + to.y) / 2
  return el('path', {
    class: className,
    d: `M ${from.x} ${from.y} C ${from.x} ${midpoint}, ${to.x} ${midpoint}, ${to.x} ${to.y}`
  })
}

export function draw(host: HTMLElement, model: GraphModel): void {
  const columns = Math.max(model.bundles.length, model.services.length, 1)
  const width = PADDING * 2 + columns * BOX.width + (columns - 1) * BOX.gap

  // Components are stacked, not squeezed side by side: a class name needs the
  // full column width to stay readable
  const deepest = Math.max(1, ...model.bundles.map(bundle => bundle.components.length))
  const componentsHeight = deepest * BOX.componentHeight + (deepest - 1) * BOX.componentGap
  const servicesRow = ROW.components + componentsHeight + 62
  const height = servicesRow + BOX.serviceHeight + 24

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label': 'Bundles, their components and the services between them'
  })

  const centres = new Map<string, { x: number; top: number; bottom: number }>()

  function place(index: number, count: number): number {
    // Centre a row of `count` boxes in the available width
    const rowWidth = count * BOX.width + (count - 1) * BOX.gap
    const start = (width - rowWidth) / 2
    return start + index * (BOX.width + BOX.gap)
  }

  svg.append(text(PADDING, 24, 'Bundles', 'label'))
  svg.append(text(PADDING, ROW.components - 12, 'Components', 'label'))
  svg.append(text(PADDING, servicesRow - 12, 'Services', 'label'))

  // ---- bundles and their components
  model.bundles.forEach((bundle, index) => {
    const x = place(index, model.bundles.length)
    const parked = bundle.state === 'unsatisfied'

    const box = el('rect', {
      x, y: ROW.bundles, width: BOX.width, height: BOX.bundleHeight, rx: 8,
      class: `bundle-box${parked ? ' parked' : ''}${bundle.disabled ? ' off' : ''}`
    })
    svg.append(box)
    svg.append(text(x + 10, ROW.bundles + 19, bundle.id, 'box-title'))
    svg.append(text(
      x + 10,
      ROW.bundles + 34,
      bundle.disabled ? 'disabled' : parked ? `waits for ${bundle.waitingFor.join(', ')}` : bundle.state,
      'box-note'
    ))

    // The bundle's components, stacked in its column so each name has room
    bundle.components.forEach((componentInfo, componentIndex) => {
      const componentY = ROW.components + componentIndex * (BOX.componentHeight + BOX.componentGap)

      svg.append(el('rect', {
        x, y: componentY, width: BOX.width, height: BOX.componentHeight, rx: 6,
        class: `component-box${componentInfo.immediate ? '' : ' delayed'}`
      }))
      svg.append(text(x + 10, componentY + 16, componentInfo.className, 'box-title'))
      svg.append(text(
        x + 10,
        componentY + 30,
        componentInfo.services.length === 0
          ? `${componentInfo.immediate ? 'immediate' : 'delayed'} · no service`
          : componentInfo.immediate ? 'immediate' : 'delayed',
        'box-note'
      ))

      centres.set(`component:${bundle.id}:${componentInfo.className}`, {
        x: x + BOX.width / 2,
        top: componentY,
        bottom: componentY + BOX.componentHeight
      })

      svg.append(link(
        { x: x + BOX.width / 2, y: ROW.bundles + BOX.bundleHeight },
        { x: x + BOX.width / 2, y: componentY },
        'edge-provides'
      ))
    })

    centres.set(`bundle:${bundle.id}`, {
      x: x + BOX.width / 2,
      top: ROW.bundles,
      bottom: ROW.bundles + BOX.bundleHeight
    })
  })

  // ---- services
  model.services.forEach((service, index) => {
    const x = place(index, model.services.length)
    const missing = service.references.length === 0

    svg.append(el('rect', {
      x, y: servicesRow, width: BOX.width, height: BOX.serviceHeight, rx: 6,
      class: `service-box${missing ? ' missing' : ''}`
    }))
    svg.append(text(x + 10, servicesRow + 17, service.id, 'box-title'))
    svg.append(text(
      x + 10,
      servicesRow + 31,
      missing
        ? 'nobody provides this'
        : service.references.length === 1
          ? `from ${service.references[0].providedBy}`
          : `${service.references.length} providers`,
      'box-note'
    ))

    centres.set(`service:${service.id}`, {
      x: x + BOX.width / 2,
      top: servicesRow,
      bottom: servicesRow + BOX.serviceHeight
    })
  })

  // ---- component -> service (provides), and bundle -> service (requires)
  for (const bundle of model.bundles) {
    for (const componentInfo of bundle.components) {
      const from = centres.get(`component:${bundle.id}:${componentInfo.className}`)
      if (!from) continue

      for (const serviceId of componentInfo.services) {
        const to = centres.get(`service:${serviceId}`)
        if (!to) continue

        const service = model.services.find(entry => entry.id === serviceId)
        const visible = service?.references[0]?.providedBy === bundle.id
        svg.append(link(
          { x: from.x, y: from.bottom },
          { x: to.x, y: to.top },
          `edge-provides${visible ? '' : ' shadowed'}`
        ))
      }
    }
  }

  for (const service of model.services) {
    const to = centres.get(`service:${service.id}`)
    if (!to) continue

    for (const consumer of service.consumers) {
      const from = centres.get(`bundle:${consumer.moduleId}`)
      if (!from) continue

      // Requirements run from the bundle down the side to the service
      svg.append(link(
        { x: from.x + 12, y: from.bottom },
        { x: to.x + 12, y: to.top },
        `edge-requires${consumer.optional ? ' optional' : ''}`
      ))
    }
  }

  host.replaceChildren(svg)
}
