// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import {
  WORKBENCH_ROOT,
  type RegionName,
  type WorkbenchRoot
} from '../../examples/workbench/src/contracts'
import { clock, shell, startupViews } from '../../examples/workbench/src/manifests'
import * as clockModule from '../../examples/workbench/modules/clock'
import * as notes from '../../examples/workbench/modules/notes'
import * as outline from '../../examples/workbench/modules/outline'
import * as outlinePro from '../../examples/workbench/modules/outline-pro'
import * as searchBox from '../../examples/workbench/modules/search-box'
import * as shellModule from '../../examples/workbench/modules/shell'

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
      'search-box': searchBox
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
    expect(titles('main')).toEqual(['Notes'])
  })

  it('should show only the highest ranked contribution for a slot', async () => {
    const loader = setup()

    await loader.loadAll()

    // Both outlines are registered; they share a slot, so one is shown
    expect(loader.getServiceRegistry().countProviders('ui.component')).toBe(4)
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

    // clock declares order 1, notes order 2 — appending would put it last
    expect(titles('main')).toEqual(['Clock', 'Notes'])
  })

  it('should take a view down again when its module is unloaded', async () => {
    const loader = setup()
    await loader.loadAll()
    await loader.loadModule(clock, { awaitCascade: true })

    await loader.unloadModule('clock')

    expect(titles('main')).toEqual(['Notes'])
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

  it('should keep the shell running while views come and go', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(clock, { awaitCascade: true })
    await loader.unloadModule('clock')
    await loader.disableModule('notes')

    expect(loader.getModule('shell')?.state).toBe('active')
    expect(titles('main')).toEqual([])
  })
})
