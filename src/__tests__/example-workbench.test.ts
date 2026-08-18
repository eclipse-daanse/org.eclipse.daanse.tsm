// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import {
  WORKBENCH_ROOT,
  type RegionName,
  type WorkbenchRoot
} from '../../examples/workbench/bundles/contracts'
import type { ModuleManifest } from '../types'
import clockManifest from '../../examples/workbench/bundles/clock/manifest.json'
import metricsManifest from '../../examples/workbench/bundles/metrics/manifest.json'
import notesManifest from '../../examples/workbench/bundles/notes/manifest.json'
import outlineManifest from '../../examples/workbench/bundles/outline/manifest.json'
import outlineProManifest from '../../examples/workbench/bundles/outline-pro/manifest.json'
import searchBoxManifest from '../../examples/workbench/bundles/search-box/manifest.json'
import shellManifest from '../../examples/workbench/bundles/shell/manifest.json'
import * as clockModule from '../../examples/workbench/bundles/clock/src/index'
import * as metrics from '../../examples/workbench/bundles/metrics/src/index'
import * as notes from '../../examples/workbench/bundles/notes/src/index'
import * as outline from '../../examples/workbench/bundles/outline/src/index'
import * as outlinePro from '../../examples/workbench/bundles/outline-pro/src/index'
import * as searchBox from '../../examples/workbench/bundles/search-box/src/index'
import * as shellModule from '../../examples/workbench/bundles/shell/src/index'

/**
 * The bundles' own manifests, as the registry would fetch them. They declare no
 * `provides` — the `@component()` declarations do, and the loader reads those.
 */
const shell = shellManifest as ModuleManifest
const clock = clockManifest as ModuleManifest
const startupViews = [
  searchBoxManifest, outlineManifest, outlineProManifest, notesManifest, metricsManifest
] as ModuleManifest[]
const outlineManifestTyped = outlineManifest as ModuleManifest
const metricsManifestTyped = metricsManifest as ModuleManifest

/**
 * Runs the workbench example against a jsdom document, so mounting and — more
 * importantly — unmounting is checked rather than described.
 */
describe('examples/workbench', () => {
  let regions: Record<RegionName, HTMLElement>
  let activity: string[]

  function setup(): ModuleLoader {
    document.body.innerHTML = ''
    regions = {
      toolbar: document.createElement('div'),
      sidebar: document.createElement('div'),
      main: document.createElement('div')
    }
    document.body.append(regions.toolbar, regions.sidebar, regions.main)
    activity = []

    const loader = new ModuleLoader()

    const containers: Record<string, unknown> = {
      shell: shellModule,
      clock: clockModule,
      notes,
      outline,
      'outline-pro': outlinePro,
      'search-box': searchBox,
      metrics
    }
    for (const [id, container] of Object.entries(containers)) {
      (window as unknown as Record<string, unknown>)[id] = container
    }

    const root: WorkbenchRoot = {
      region: name => regions[name],
      log: message => activity.push(message)
    }
    loader.getServiceRegistry().register(WORKBENCH_ROOT, root, { providedBy: 'host' })
    loader.register([shell, ...startupViews])

    return loader
  }

  function titles(region: RegionName): string[] {
    return [...regions[region].querySelectorAll('.view h3')].map(node => node.textContent ?? '')
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should mount each view into the region its manifest names', async () => {
    const loader = setup()

    await loader.loadAll()

    expect(titles('toolbar')).toEqual(['Search'])
    expect(titles('main')).toEqual(['Notes', 'Metrics'])
  })

  it('should show only the highest ranked contribution for a slot', async () => {
    const loader = setup()

    await loader.loadAll()

    // Both outlines are registered; they share a slot, so one is shown
    expect(loader.getServiceRegistry().countProviders('ui.component')).toBe(5)
    expect(titles('sidebar')).toEqual(['Outline Pro'])
  })

  it('should fall back to the other contribution when the ranked one is disabled', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.disableModule('outline-pro')
    expect(titles('sidebar')).toEqual(['Outline'])

    await loader.enableModule('outline-pro')
    expect(titles('sidebar')).toEqual(['Outline Pro'])
  })

  it('should place a view that arrives later according to its order', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(clock, { awaitCascade: true })

    // clock declares order 1 — appending would have put it last
    expect(titles('main')).toEqual(['Clock', 'Notes', 'Metrics'])
  })

  it('should take a view down again when its module is unloaded', async () => {
    const loader = setup()
    await loader.loadAll()
    await loader.loadModule(clock, { awaitCascade: true })

    await loader.unloadModule('clock')

    expect(titles('main')).toEqual(['Notes', 'Metrics'])
    expect(activity).toContain('unmounted Clock')
  })

  it('should stop the timer of a view that goes away', async () => {
    vi.useFakeTimers()
    const loader = setup()
    await loader.loadAll()
    await loader.loadModule(clock, { awaitCascade: true })

    const counter = regions.main.querySelector('small')
    expect(counter).not.toBeNull()
    vi.advanceTimersByTime(2000)
    const whileMounted = counter?.textContent
    expect(whileMounted).toContain('3 ticks')

    await loader.unloadModule('clock')

    // The element is detached; if unmount() had not cleared the interval, the
    // timer would keep writing into it
    vi.advanceTimersByTime(5000)
    expect(counter?.textContent).toBe(whileMounted)
  })

  it('should clear every view when the shell itself is unloaded', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.unloadModule('shell')

    expect(titles('toolbar')).toEqual([])
    expect(titles('sidebar')).toEqual([])
    expect(titles('main')).toEqual([])
  })

  it('should construct a decorated class and inject its dependencies', async () => {
    const loader = setup()

    await loader.loadAll()

    // MetricsView got the metrics service, which got the host's root service
    const view = [...regions.main.querySelectorAll('.view')]
      .find(node => node.querySelector('h3')?.textContent === 'Metrics')
    expect(view).toBeDefined()
    expect(view?.querySelector('output')?.textContent).toBe('1')
    expect(activity.some(entry => entry.startsWith('metrics:'))).toBe(true)
  })

  it('should place a component by the properties its declaration carries', async () => {
    const loader = setup()

    await loader.loadAll()

    // The alias under ui.component carries the manifest's region and order
    const [reference] = loader.getServiceRegistry()
      .getServiceReferences('ui.component', '(&(region=main)(order=3))')
    expect(reference?.providedBy).toBe('metrics')
    expect(titles('main')).toEqual(['Notes', 'Metrics'])
  })

  it('should leave a component without an activate method unbuilt', async () => {
    const loader = setup()

    // Only the outline, and no shell to resolve it
    await loader.loadModule(outlineManifestTyped)

    const [reference] = loader.getServiceRegistry().getServiceReferences('ui.component')
    expect(reference.providedBy).toBe('outline')
    expect(reference.instantiated).toBe(false)

    // Built on first resolution — a delayed component
    loader.getServiceRegistry().resolveReference(reference)
    expect(loader.getServiceRegistry().getServiceReferences('ui.component')[0].instantiated)
      .toBe(true)
  })

  it('should build a component with an activate method right away', async () => {
    const loader = setup()

    await loader.loadModule(metricsManifestTyped)

    // MetricsView declares @activate, so it and what it injects exist already
    const [view] = loader.getServiceRegistry().getServiceReferences('ui.component')
    expect(view.instantiated).toBe(true)
    expect(loader.getServiceRegistry().getServiceReferences('workbench.metrics')[0].instantiated)
      .toBe(true)
  })

  it('should mount the clock without the optional metrics service', async () => {
    const loader = setup()
    // Everything but metrics, so the optional injection finds nothing
    loader.register([shell, ...startupViews.filter(manifest => manifest.id !== 'metrics')])
    await loader.disableModule('metrics')
    await loader.loadAll()

    await loader.loadModule(clock, { awaitCascade: true })

    expect(titles('main')).toContain('Clock')
    expect(activity.some(entry => entry.startsWith('metrics:'))).toBe(false)
  })

  it('should keep the shell running while views come and go', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(clock, { awaitCascade: true })
    await loader.unloadModule('clock')
    await loader.disableModule('notes')
    await loader.disableModule('metrics')

    expect(loader.getModule('shell')?.state).toBe('active')
    expect(titles('main')).toEqual([])
  })
})
