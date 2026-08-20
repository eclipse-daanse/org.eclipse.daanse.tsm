/**
 * `module` service scope — OSGi's `bundle` scope (Core 5.3).
 *
 * One instance per consuming module: the scope for a service that keeps state
 * about whoever uses it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DefaultServiceRegistry } from '../ServiceRegistry.js'
import { ScopedServiceRegistry } from '../ScopedServiceRegistry.js'
import { injectable, inject, perModule } from '../decorators.js'

describe('module scope', () => {
  let registry: DefaultServiceRegistry

  beforeEach(() => {
    registry = new DefaultServiceRegistry()
  })

  const forModule = (id: string): ScopedServiceRegistry =>
    new ScopedServiceRegistry(id, registry)

  describe('one instance per consuming module', () => {
    it('gives two modules two different instances', () => {
      let built = 0
      registry.bind('cache', () => ({ n: ++built }), { scope: 'module' })

      const a = forModule('module-a').get<{ n: number }>('cache')
      const b = forModule('module-b').get<{ n: number }>('cache')

      expect(a).not.toBe(b)
      expect(built).toBe(2)
    })

    it('gives one module the same instance every time', () => {
      let built = 0
      registry.bind('cache', () => ({ n: ++built }), { scope: 'module' })

      const scope = forModule('module-a')
      expect(scope.get('cache')).toBe(scope.get('cache'))
      expect(built).toBe(1)
    })

    it('keeps a separate instance from a second facade for the same module', () => {
      registry.bind('cache', () => ({}), { scope: 'module' })

      // The identity is the module, not the facade object: a module that gets a
      // fresh context on reload must not get a second instance behind its back
      const first = forModule('module-a').get('cache')
      const second = forModule('module-a').get('cache')
      expect(first).toBe(second)
    })
  })

  describe('degrading without a consumer', () => {
    it('behaves as a singleton when asked directly', () => {
      let built = 0
      registry.bind('cache', () => ({ n: ++built }), { scope: 'module' })

      // Nobody to hold it for. Answering with one shared instance is the safe
      // direction: a new object per call would be `transient`, which is a
      // different contract than the one declared
      expect(registry.get('cache')).toBe(registry.get('cache'))
      expect(built).toBe(1)
    })

    it('does not let the direct instance leak into a module', () => {
      registry.bind('cache', () => ({}), { scope: 'module' })

      const shared = registry.get('cache')
      const mine = forModule('module-a').get('cache')
      expect(mine).not.toBe(shared)
    })
  })

  describe('the teardown', () => {
    it('drops what a module held when it is released', () => {
      let built = 0
      registry.bind('cache', () => ({ n: ++built }), { scope: 'module' })

      const scope = forModule('module-a')
      const before = scope.get('cache')
      scope.releaseAll()
      const after = scope.get('cache')

      expect(after).not.toBe(before)
      expect(built).toBe(2)
    })

    it('calls dispose() on what it drops', () => {
      const dispose = vi.fn()
      registry.bind('cache', () => ({ dispose }), { scope: 'module' })

      const scope = forModule('module-a')
      scope.get('cache')
      scope.releaseAll()

      expect(dispose).toHaveBeenCalledOnce()
    })

    it('does not call dispose() for a module that never asked', () => {
      const dispose = vi.fn()
      registry.bind('cache', () => ({ dispose }), { scope: 'module' })

      forModule('module-a').get('cache')
      forModule('module-b').releaseAll()

      expect(dispose).not.toHaveBeenCalled()
    })

    it('survives a dispose() that throws', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      registry.bind('cache', () => ({
        dispose: () => { throw new Error('no') }
      }), { scope: 'module' })

      const scope = forModule('module-a')
      scope.get('cache')
      expect(() => scope.releaseAll()).not.toThrow()
      expect(error).toHaveBeenCalled()
      error.mockRestore()
    })

    it('leaves other modules holding theirs', () => {
      registry.bind('cache', () => ({}), { scope: 'module' })

      const a = forModule('module-a')
      const b = forModule('module-b')
      const held = b.get('cache')
      a.releaseAll()

      expect(b.get('cache')).toBe(held)
    })
  })

  describe('dependencies of a scoped service', () => {
    it('resolves them for the providing module, not the asking one', () => {
      // Whose code runs decides whose instance it gets. Otherwise `module` scope
      // would leak down the chain: a singleton resolved by two modules would end
      // up with two different dependencies underneath it
      let built = 0
      registry.bind('deep', () => ({ n: ++built }), { scope: 'module' })

      @injectable()
      class Middle {
        constructor(@inject('deep') readonly deep: { n: number }) {}
      }
      registry.bindClass('middle', Middle, { providedBy: 'owner' })

      const one = forModule('module-a').get<Middle>('middle')
      const two = forModule('module-b').get<Middle>('middle')

      // One singleton `middle`, so one `deep` underneath it — the owner's
      expect(one).toBe(two)
      expect(built).toBe(1)
    })

    it('gives a module-scoped service its own dependency chain', () => {
      let built = 0
      registry.bind('deep', () => ({ n: ++built }), { scope: 'module' })

      @injectable()
      class Middle {
        constructor(@inject('deep') readonly deep: { n: number }) {}
      }
      // Provided by nobody: the consumer is what is left to resolve on behalf of
      registry.bindClass('middle', Middle, { scope: 'module' })

      const one = forModule('module-a').get<Middle>('middle')
      const two = forModule('module-b').get<Middle>('middle')

      expect(one).not.toBe(two)
      expect(one!.deep).not.toBe(two!.deep)
      expect(built).toBe(2)
    })
  })

  describe('the decorator', () => {
    it('declares the scope on the class', () => {
      @perModule()
      @injectable()
      class Session {}

      registry.bindClass('session', Session)
      expect(registry.getBindingInfo('session')?.scope).toBe('module')

      const a = forModule('module-a').get('session')
      const b = forModule('module-b').get('session')
      expect(a).not.toBe(b)
    })

    it('is overridden by the scope passed at the call site', () => {
      @perModule()
      @injectable()
      class Session {}

      registry.bindClass('session', Session, { scope: 'singleton' })
      expect(forModule('module-a').get('session')).toBe(forModule('module-b').get('session'))
    })
  })

  describe('references', () => {
    it('resolves a reference for the module that asked', () => {
      registry.bind('cache', () => ({}), { scope: 'module' })
      const [reference] = registry.getServiceReferences('cache')

      const a = forModule('module-a').resolveReference(reference)
      const b = forModule('module-b').resolveReference(reference)
      expect(a).not.toBe(b)
    })

    it('reports the scope on the reference', () => {
      registry.bind('cache', () => ({}), { scope: 'module' })
      expect(registry.getServiceReferences('cache')[0].scope).toBe('module')
    })
  })

  describe('reached through a component', () => {
    it('gives each module its own instance', async () => {
      // The path that matters most, and the one that was wrong: a component with
      // no service of its own is built through `construct`, which had no
      // consumer to build for
      const { ModuleLoader } = await import('../ModuleLoader.js')
      const { component, activate } = await import('../decorators.js')

      const loader = new ModuleLoader()
      let built = 0
      loader.getServiceRegistry().bind('undo', () => ({ n: ++built }), { scope: 'module' })

      const seen: unknown[] = []

      @component({ immediate: true })
      class Left {
        constructor(@inject('undo') readonly undo: unknown) { seen.push(undo) }
        @activate() start(): void {}
      }
      @component({ immediate: true })
      class Right {
        constructor(@inject('undo') readonly undo: unknown) { seen.push(undo) }
        @activate() start(): void {}
      }

      await loader.loadModule(
        { id: 'one', version: '1.0.0', entry: 'one.js', provides: [] },
        { container: { Left } }
      )
      await loader.loadModule(
        { id: 'two', version: '1.0.0', entry: 'two.js', provides: [] },
        { container: { Right } }
      )

      expect(seen[0]).not.toBe(seen[1])
      expect(built).toBe(2)
    })

    it('shares one instance between two components of a module', async () => {
      const { ModuleLoader } = await import('../ModuleLoader.js')
      const { component, activate } = await import('../decorators.js')

      const loader = new ModuleLoader()
      let built = 0
      loader.getServiceRegistry().bind('undo', () => ({ n: ++built }), { scope: 'module' })
      const seen: unknown[] = []

      @component({ immediate: true })
      class Left {
        constructor(@inject('undo') readonly undo: unknown) { seen.push(undo) }
        @activate() start(): void {}
      }
      @component({ immediate: true })
      class Right {
        constructor(@inject('undo') readonly undo: unknown) { seen.push(undo) }
        @activate() start(): void {}
      }

      await loader.loadModule(
        { id: 'one', version: '1.0.0', entry: 'one.js', provides: [] },
        { container: { Left, Right } }
      )

      expect(seen[0]).toBe(seen[1])
      expect(built).toBe(1)
    })
  })
})
