/**
 * Filtering listeners and MODIFIED_ENDMATCH (Core 5.6.1).
 *
 * The point of filtering *here* rather than inside the callback: a listener that
 * tests properties itself never learns that a service it accepted has stopped
 * qualifying.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DefaultServiceRegistry } from '../ServiceRegistry.js'
import { ScopedServiceRegistry } from '../ScopedServiceRegistry.js'
import type { ServiceRegistryEvent } from '../types.js'

describe('filtering listeners', () => {
  let registry: DefaultServiceRegistry
  let seen: ServiceRegistryEvent[]

  const listener = {
    onServiceEvent: (event: ServiceRegistryEvent) => { seen.push(event) }
  }

  beforeEach(() => {
    registry = new DefaultServiceRegistry()
    seen = []
  })

  describe('narrowing what a listener hears', () => {
    it('delivers a registration that matches', () => {
      registry.addListener(listener, { filter: '(kind=chart)' })
      registry.register('a', {}, { properties: { kind: 'chart' } })

      expect(seen).toHaveLength(1)
      expect(seen[0].type).toBe('registered')
      expect(seen[0].serviceId).toBe('a')
    })

    it('withholds a registration that does not match', () => {
      registry.addListener(listener, { filter: '(kind=chart)' })
      registry.register('a', {}, { properties: { kind: 'table' } })

      expect(seen).toHaveLength(0)
    })

    it('withholds a registration with no properties at all', () => {
      registry.addListener(listener, { filter: '(kind=chart)' })
      registry.register('a', {})

      expect(seen).toHaveLength(0)
    })

    it('leaves a listener without a filter hearing everything', () => {
      registry.addListener(listener)
      registry.register('a', {}, { properties: { kind: 'table' } })
      registry.register('b', {})

      expect(seen.map(event => event.serviceId)).toEqual(['a', 'b'])
    })

    it('matches on the properties the registry adds itself', () => {
      registry.addListener(listener, { filter: '(service.ranking>=10)' })
      registry.register('low', {}, { ranking: 1 })
      registry.register('high', {}, { ranking: 20 })

      expect(seen.map(event => event.serviceId)).toEqual(['high'])
    })

    it('rejects an invalid filter instead of matching nothing', () => {
      expect(() => registry.addListener(listener, { filter: '(kind=' }))
        .toThrow()
    })

    it('delivers a withdrawal that matches', () => {
      registry.register('a', {}, { properties: { kind: 'chart' } })
      registry.addListener(listener, { filter: '(kind=chart)' })
      registry.unregister('a')

      expect(seen.map(event => event.type)).toEqual(['unregistered'])
    })
  })

  describe('the end of a match', () => {
    it('reports a property change that ends it', () => {
      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      registry.addListener(listener, { filter: '(kind=chart)' })

      registration.setProperties({ kind: 'table' })

      expect(seen).toHaveLength(1)
      expect(seen[0].type).toBe('modified-endmatch')
      expect(seen[0].serviceId).toBe('a')
    })

    it('carries the properties that ended it, not the ones that matched', () => {
      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      registry.addListener(listener, { filter: '(kind=chart)' })

      registration.setProperties({ kind: 'table' })

      expect(seen[0].properties?.kind).toBe('table')
    })

    it('reports an ordinary update while the match holds', () => {
      const registration = registry.register('a', {}, { properties: { kind: 'chart', v: 1 } })
      registry.addListener(listener, { filter: '(kind=chart)' })

      registration.setProperties({ kind: 'chart', v: 2 })

      expect(seen.map(event => event.type)).toEqual(['updated'])
    })

    it('says nothing when the service never matched', () => {
      const registration = registry.register('a', {}, { properties: { kind: 'table' } })
      registry.addListener(listener, { filter: '(kind=chart)' })

      registration.setProperties({ kind: 'gauge' })

      expect(seen).toHaveLength(0)
    })

    it('reports a match that begins as an ordinary update', () => {
      // Beginning to match is not a registration: the service was there all
      // along. OSGi delivers MODIFIED here too
      const registration = registry.register('a', {}, { properties: { kind: 'table' } })
      registry.addListener(listener, { filter: '(kind=chart)' })

      registration.setProperties({ kind: 'chart' })

      expect(seen.map(event => event.type)).toEqual(['updated'])
    })

    it('never reaches a listener without a filter', () => {
      // Nothing to end: without a filter everything matches, and the type would
      // be one such a listener has no way to interpret
      registry.addListener(listener)
      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      registration.setProperties({ kind: 'table' })

      expect(seen.map(event => event.type)).toEqual(['registered', 'updated'])
    })

    it('reaches only the listeners whose match ended', () => {
      const chartSeen: string[] = []
      const tableSeen: string[] = []
      registry.addListener(
        { onServiceEvent: event => chartSeen.push(event.type) },
        { filter: '(kind=chart)' }
      )
      registry.addListener(
        { onServiceEvent: event => tableSeen.push(event.type) },
        { filter: '(kind=table)' }
      )

      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      registration.setProperties({ kind: 'table' })

      expect(chartSeen).toEqual(['registered', 'modified-endmatch'])
      expect(tableSeen).toEqual(['updated'])
    })

    it('does not reach a listener that was removed', () => {
      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      registry.addListener(listener, { filter: '(kind=chart)' })
      registry.removeListener(listener)

      registration.setProperties({ kind: 'table' })
      expect(seen).toHaveLength(0)
    })

    it('survives a listener that throws', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      registry.addListener(
        { onServiceEvent: () => { throw new Error('no') } },
        { filter: '(kind=chart)' }
      )
      registry.addListener(listener, { filter: '(kind=chart)' })

      const registration = registry.register('a', {}, { properties: { kind: 'chart' } })
      expect(() => registration.setProperties({ kind: 'table' })).not.toThrow()

      expect(seen.map(event => event.type)).toEqual(['registered', 'modified-endmatch'])
      error.mockRestore()
    })
  })

  describe('through a module facade', () => {
    it('passes the filter on', () => {
      const scope = new ScopedServiceRegistry('module-a', registry)
      scope.addListener(listener, { filter: '(kind=chart)' })

      registry.register('a', {}, { properties: { kind: 'table' } })
      registry.register('b', {}, { properties: { kind: 'chart' } })

      expect(seen.map(event => event.serviceId)).toEqual(['b'])
    })

    it('drops the filter with the listener when the module goes', () => {
      const scope = new ScopedServiceRegistry('module-a', registry)
      scope.addListener(listener, { filter: '(kind=chart)' })
      scope.releaseAll()

      registry.register('b', {}, { properties: { kind: 'chart' } })
      expect(seen).toHaveLength(0)
    })
  })
})
