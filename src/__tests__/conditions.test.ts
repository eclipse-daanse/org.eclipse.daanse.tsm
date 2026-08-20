/**
 * Satisfying conditions (Declarative Services 112.3.13).
 *
 * A component that waits for a statement rather than for a service: the way to
 * say "not before" without inventing something to depend on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleLoader } from '../ModuleLoader.js'
import { component, activate, deactivate } from '../decorators.js'
import {
  CONDITION_SERVICE_ID,
  CONDITION_ID,
  TRUE_CONDITION,
  TRUE_CONDITION_FILTER,
  conditionProperties,
  conditionFilter
} from '../conditions.js'
import type { ModuleManifest } from '../types.js'

const manifest = (id: string): ModuleManifest => ({
  id, version: '1.0.0', entry: `${id}.js`, provides: []
})

describe('conditions', () => {
  let loader: ModuleLoader

  beforeEach(() => {
    loader = new ModuleLoader()
  })

  describe('the baseline', () => {
    it('registers the condition that always holds', () => {
      expect(loader.getServiceRegistry().countProviders(
        CONDITION_SERVICE_ID, TRUE_CONDITION_FILTER
      )).toBe(1)
    })

    it('is there before any module asks for it', () => {
      // A component naming it must not depend on whether another component
      // asked first
      const fresh = new ModuleLoader()
      expect(fresh.getServiceRegistry().has(CONDITION_SERVICE_ID)).toBe(true)
    })
  })

  describe('helpers', () => {
    it('builds the properties of a condition', () => {
      expect(conditionProperties('data.loaded')).toEqual({ [CONDITION_ID]: 'data.loaded' })
    })

    it('keeps extra properties alongside', () => {
      expect(conditionProperties('data.loaded', { source: 'api' }))
        .toEqual({ [CONDITION_ID]: 'data.loaded', source: 'api' })
    })

    it('builds the filter for one condition', () => {
      expect(conditionFilter('data.loaded')).toBe('(condition.id=data.loaded)')
    })
  })

  describe('a component that names a condition', () => {
    it('waits while nothing matches', async () => {
      const started = vi.fn()

      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).not.toHaveBeenCalled()
    })

    it('starts when the condition arrives', async () => {
      const started = vi.fn()

      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      loader.getServiceRegistry().register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
        properties: conditionProperties('data.loaded')
      })
      await loader.settle()

      expect(started).toHaveBeenCalledOnce()
    })

    it('starts at once when the condition is already there', async () => {
      loader.getServiceRegistry().register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
        properties: conditionProperties('data.loaded')
      })

      const started = vi.fn()
      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).toHaveBeenCalledOnce()
    })

    it('stops when the condition goes away', async () => {
      const stopped = vi.fn()
      const registration = loader.getServiceRegistry().register(
        CONDITION_SERVICE_ID, TRUE_CONDITION, { properties: conditionProperties('data.loaded') }
      )

      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void {}
        @deactivate() stop(): void { stopped() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      registration.unregister()
      await loader.settle()

      expect(stopped).toHaveBeenCalledOnce()
    })

    it('is not satisfied by a different condition', async () => {
      loader.getServiceRegistry().register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
        properties: conditionProperties('something.else')
      })

      const started = vi.fn()
      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).not.toHaveBeenCalled()
    })

    it('can name the baseline condition', async () => {
      const started = vi.fn()
      @component({ satisfyingCondition: TRUE_CONDITION_FILTER })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).toHaveBeenCalledOnce()
    })

    it('runs without a condition when none is named', async () => {
      const started = vi.fn()
      @component()
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).toHaveBeenCalledOnce()
    })

    it('reports what it waits for', async () => {
      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void {}
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      const [info] = loader.getComponents('report')
      expect(info.configurations[0].state).toBe('unsatisfied-reference')
      expect(info.configurations[0].waitingFor).toContain('condition (condition.id=data.loaded)')
    })

    it('treats an unparseable condition as unsatisfied', async () => {
      // Starting as though it had no condition would be the wrong direction, and
      // throwing would take the module's start with it
      const started = vi.fn()
      @component({ satisfyingCondition: '(condition.id=' })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).not.toHaveBeenCalled()
    })

    it('leaves the module running while the component waits', async () => {
      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void {}
      }

      const loaded = await loader.loadModule(manifest('report'), { container: { Report } })
      expect(loaded.state).toBe('active')
    })
  })

  describe('a condition provided by a module', () => {
    it('satisfies a component in another module', async () => {
      const started = vi.fn()

      @component({ service: [CONDITION_SERVICE_ID], properties: conditionProperties('data.loaded') })
      class DataLoaded {}

      @component({ satisfyingCondition: conditionFilter('data.loaded') })
      class Report {
        @activate() start(): void { started() }
      }

      await loader.loadModule(manifest('report'), { container: { Report } })
      expect(started).not.toHaveBeenCalled()

      await loader.loadModule(manifest('data'), { container: { DataLoaded } })
      await loader.settle()

      expect(started).toHaveBeenCalledOnce()
    })
  })
})
