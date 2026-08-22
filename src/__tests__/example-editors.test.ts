import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import type { ModuleLoader } from '../ModuleLoader'
import { containers, resetContainers, testLoader } from './helpers/moduleContainers'
import { COMPONENT_FACTORY_SERVICE_ID, componentFactoryFilter } from '../componentFactory'
import { bundles } from '../../examples/editors/src/manifests'
import {
  EDITOR_TOOL,
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
} from '../../examples/editors/src/contracts'
import * as workspace from '../../examples/editors/modules/workspace'
import * as history from '../../examples/editors/modules/history'
import * as textTools from '../../examples/editors/modules/text-tools'
import * as drawTools from '../../examples/editors/modules/draw-tools'
import * as editors from '../../examples/editors/modules/editors'
import type { ComponentFactory, ModuleScopedServiceRegistry } from '../types'

/**
 * The editors example, asserted rather than clicked.
 *
 * Two of these expectations exist because building the example found defects the
 * unit tests had not: `construct()` losing the consumer, and an outranked
 * registration going without an event.
 */

describe('examples/editors', () => {
  let loader: ModuleLoader
  let reported: string[]

  beforeEach(async () => {
    resetContainers()
    Object.assign(containers, {
      workspace, history, 'text-tools': textTools, 'draw-tools': drawTools, editors
    })

    reported = []
    loader = testLoader()
    loader.getServiceRegistry().register<Journal>(JOURNAL, {
      note: (line: string) => { reported.push(line) }
    }, { providedBy: 'host' })

    loader.register(bundles)
    await loader.loadAll()
    await loader.settle()
  })

  const control = (): WorkspaceControl =>
    loader.getServiceRegistry().getRequired<WorkspaceControl>(WORKSPACE_CONTROL)

  const toolset = (bundle: string): ToolsetControl =>
    loader.getServiceRegistry()
      .getMatching<ToolsetControl>(TOOLSET_CONTROL, `(bundle=${bundle})`)!

  const factory = (): ComponentFactory | undefined =>
    loader.getServiceRegistry().getMatching<ComponentFactory>(
      COMPONENT_FACTORY_SERVICE_ID, componentFactoryFilter('editor')
    )

  const stackOf = (moduleId: string): UndoStack | undefined => {
    const registry = loader.getServiceRegistry() as ModuleScopedServiceRegistry
    return registry.getFor<UndoStack>(moduleId, UNDO_STACK)
  }

  describe('the condition', () => {
    it('keeps everything that names it waiting', () => {
      expect(factory()).toBeUndefined()
      expect(loader.getServiceRegistry().has(UPDATING_TOOLBAR)).toBe(false)
    })

    it('leaves the bundles active while the components wait', () => {
      for (const bundle of bundles) {
        expect(loader.getModule(bundle.id)?.state).toBe('active')
      }
    })

    it('starts them when it holds', async () => {
      control().load()
      await loader.settle()

      expect(factory()).toBeDefined()
      expect(loader.getServiceRegistry().has(UPDATING_TOOLBAR)).toBe(true)
    })

    it('stops them again when it goes', async () => {
      control().load()
      await loader.settle()
      control().unload()
      await loader.settle()

      expect(factory()).toBeUndefined()
    })
  })

  describe('the factory', () => {
    beforeEach(async () => {
      control().load()
      await loader.settle()
    })

    it('builds one editor per call', async () => {
      await factory()!.newInstance({ file: 'a.md' })
      await factory()!.newInstance({ file: 'b.md' })

      expect(factory()!.instances).toHaveLength(2)
      expect(reported).toContain('editor: opened a.md')
    })

    it('registers each instance with the properties it was given', async () => {
      await factory()!.newInstance({ file: 'a.md' })
      await factory()!.newInstance({ file: 'b.md' })

      expect(loader.getServiceRegistry().countProviders('editor.instance', '(file=a.md)'))
        .toBe(1)
    })

    it('takes its instances with it when the condition goes', async () => {
      await factory()!.newInstance({ file: 'a.md' })
      control().unload()
      await loader.settle()

      expect(reported).toContain('editor: closed a.md')
      expect(loader.getServiceRegistry().has('editor.instance')).toBe(false)
    })

    it('does not bring them back when it holds again', async () => {
      await factory()!.newInstance({ file: 'a.md' })
      control().unload()
      await loader.settle()
      control().load()
      await loader.settle()

      expect(factory()!.instances).toHaveLength(0)
    })
  })

  describe('the collections', () => {
    beforeEach(async () => {
      control().load()
      await loader.settle()
    })

    const held = (id: string): readonly Tool[] =>
      loader.getServiceRegistry().get<{ tools: readonly Tool[] }>(id)!.tools

    it('collects the tools of both bundles', () => {
      // Two per bundle, which only works because each registration says which
      // one it is — without `instanceKey` the second would replace the first
      expect(loader.getServiceRegistry().countProviders(EDITOR_TOOL)).toBe(4)
      expect(held(UPDATING_TOOLBAR)).toHaveLength(4)
    })

    it('keeps the array with update, so a held reference stays current', async () => {
      const taken = held(UPDATING_TOOLBAR)

      toolset('text-tools').withdraw()
      await loader.settle()

      expect(held(UPDATING_TOOLBAR)).toBe(taken)
      expect(taken).toHaveLength(2)
    })

    it('replaces the array by default, so a held reference goes stale', async () => {
      const taken = held(REPLACING_TOOLBAR)

      toolset('text-tools').withdraw()
      await loader.settle()

      // Not a defect — it is what `replace` means, and the reason `update` exists
      expect(held(REPLACING_TOOLBAR)).not.toBe(taken)
      expect(taken).toHaveLength(4)
      expect(held(REPLACING_TOOLBAR)).toHaveLength(2)
    })

    it('hears about a withdrawal that leaves the id answering', async () => {
      // The defect this example found: only two of four providers go, so `get()`
      // still answers and it used to look like no change at all
      toolset('text-tools').withdraw()
      await loader.settle()

      expect(loader.getServiceRegistry().has(EDITOR_TOOL)).toBe(true)
      expect(held(UPDATING_TOOLBAR)).toHaveLength(2)
    })

    it('grows again when the tools come back', async () => {
      toolset('text-tools').withdraw()
      await loader.settle()
      toolset('text-tools').restore()
      await loader.settle()

      expect(held(UPDATING_TOOLBAR)).toHaveLength(4)
    })
  })

  describe('the undo stacks', () => {
    it('gives each bundle its own', () => {
      const text = stackOf('text-tools')
      const draw = stackOf('draw-tools')

      expect(text).not.toBe(draw)
      expect(text?.entries).toEqual(['text-tools started'])
      expect(draw?.entries).toEqual(['draw-tools started'])
    })

    it('gives an editor the stack of its own bundle', async () => {
      control().load()
      await loader.settle()
      await factory()!.newInstance({ file: 'a.md' })

      // Not the page's stack, and not the tool bundles': the one belonging to the
      // bundle whose code runs. This is what `construct()` used to get wrong
      expect(stackOf('editors')?.entries).toContain('opened a.md')
      expect(stackOf('text-tools')?.entries).not.toContain('opened a.md')
    })

    it('disposes what a module held when it is unloaded', async () => {
      await loader.unloadModule('text-tools')

      expect(reported.some(line => line.includes('disposed undo stack'))).toBe(true)
    })
  })
})
