import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ModuleLoader } from '../ModuleLoader'
import { UI_SERVICE, type DemoUi } from '../../examples/whiteboard/src/contracts'
import { lateWidget, manifests } from '../../examples/whiteboard/src/manifests'
import * as chartWidget from '../../examples/whiteboard/modules/chart-widget'
import * as greeter from '../../examples/whiteboard/modules/greeter'
import * as greetingBasic from '../../examples/whiteboard/modules/greeting-basic'
import * as greetingPremium from '../../examples/whiteboard/modules/greeting-premium'
import * as lateWidgetModule from '../../examples/whiteboard/modules/late-widget'
import * as neverSatisfied from '../../examples/whiteboard/modules/never-satisfied'
import * as palette from '../../examples/whiteboard/modules/palette'
import * as tableWidget from '../../examples/whiteboard/modules/table-widget'

/**
 * Runs the whiteboard example without a browser: the real module code is put
 * where loadEntry() looks, so the wiring the example demonstrates is checked
 * rather than described.
 */
interface GlobalWithWindow { window?: Record<string, unknown> }
const globalRef = globalThis as GlobalWithWindow

describe('examples/whiteboard', () => {
  let savedWindow: Record<string, unknown> | undefined
  let shownPalette: Array<{ label: string; kind: string; providedBy: string }>
  let shownGreeting: string

  function setup(): ModuleLoader {
    const loader = new ModuleLoader()

    // The same modules the dev server would import, minus the network
    globalRef.window = {
      palette,
      greeter,
      'never-satisfied': neverSatisfied,
      'chart-widget': chartWidget,
      'table-widget': tableWidget,
      'greeting-basic': greetingBasic,
      'greeting-premium': greetingPremium,
      'late-widget': lateWidgetModule
    }

    const ui: DemoUi = {
      setPalette(widgets) { shownPalette = widgets },
      setGreeting(text) { shownGreeting = text }
    }
    loader.getServiceRegistry().register(UI_SERVICE, ui, { providedBy: 'host' })
    loader.register(manifests)

    return loader
  }

  beforeEach(() => {
    savedWindow = globalRef.window
    shownPalette = []
    shownGreeting = ''
  })

  afterEach(() => {
    globalRef.window = savedWindow
  })

  it('should activate every module whose services exist', async () => {
    const loader = setup()

    await loader.loadAll()

    for (const id of [
      'palette', 'greeter', 'chart-widget', 'table-widget', 'greeting-basic', 'greeting-premium'
    ]) {
      expect(loader.getModule(id)?.state, id).toBe('active')
    }
  })

  it('should park the module nobody can satisfy', async () => {
    const loader = setup()

    await loader.loadAll()

    expect(loader.getUnsatisfiedModules()).toEqual([
      { moduleId: 'never-satisfied', waitingFor: ['demo.nobody-provides-this'] }
    ])
  })

  it('should collect the widgets although consumers were registered first', async () => {
    const loader = setup()

    await loader.loadAll()

    expect(shownPalette.map(widget => widget.kind).sort()).toEqual(['chart', 'table'])
    expect(shownPalette.map(widget => widget.providedBy).sort())
      .toEqual(['chart-widget', 'table-widget'])
  })

  it('should show the higher ranked greeting', async () => {
    const loader = setup()

    await loader.loadAll()

    expect(shownGreeting).toContain('premium')
  })

  it('should grow the palette when a widget arrives at runtime', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.loadModule(lateWidget, { awaitCascade: true })

    expect(shownPalette.map(widget => widget.kind).sort()).toEqual(['chart', 'map', 'table'])
  })

  it('should shrink the palette when a widget is unloaded', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.unloadModule('table-widget')

    expect(shownPalette.map(widget => widget.kind)).toEqual(['chart'])
  })

  it('should fall back to the basic greeting when premium is disabled', async () => {
    const loader = setup()
    await loader.loadAll()

    await loader.disableModule('greeting-premium')

    // greeter declares policyOption: 'greedy', so it is rebuilt on the stand-in
    expect(shownGreeting).toContain('basic')
    expect(loader.getModule('greeter')?.state).toBe('active')
  })

  it('should return to premium when it is enabled again', async () => {
    const loader = setup()
    await loader.loadAll()
    await loader.disableModule('greeting-premium')

    await loader.enableModule('greeting-premium')

    expect(shownGreeting).toContain('premium')
  })

  it('should keep the manifests truthful about what they provide', async () => {
    const loader = setup()

    await loader.loadAll()

    expect(loader.getDeclarationMismatches()).toEqual([])
  })
})
