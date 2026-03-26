import { describe, it, expect } from 'vitest'
import { DependencyResolver } from '../DependencyResolver'
import type { ModuleManifest, Dependency } from '../types'

function createManifest(
  id: string,
  dependencies: Dependency[] = [],
  options: { priority?: number; version?: string } = {}
): ModuleManifest {
  return {
    id,
    name: id,
    version: options.version ?? '1.0.0',
    entry: `/${id}/remoteEntry.js`,
    exports: {},
    dependencies,
    priority: options.priority
  }
}

describe('DependencyResolver', () => {
  describe('resolve', () => {
    it('should return empty result for no modules', () => {
      const resolver = new DependencyResolver()
      const result = resolver.resolve([])

      expect(result.loadOrder).toEqual([])
      expect(result.circular).toEqual([])
      expect(result.missing).toEqual([])
      expect(result.versionConflicts).toEqual([])
    })

    it('should return single module with no dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA')

      const result = resolver.resolve([moduleA])

      expect(result.loadOrder).toHaveLength(1)
      expect(result.loadOrder[0].id).toBe('moduleA')
    })

    it('should order dependencies before dependents', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB')

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.loadOrder).toHaveLength(2)
      expect(result.loadOrder[0].id).toBe('moduleB')
      expect(result.loadOrder[1].id).toBe('moduleA')
    })

    it('should handle deep dependency chains', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB', ['moduleC'])
      const moduleC = createManifest('moduleC', ['moduleD'])
      const moduleD = createManifest('moduleD')

      const result = resolver.resolve([moduleA, moduleB, moduleC, moduleD])

      expect(result.loadOrder).toHaveLength(4)
      expect(result.loadOrder[0].id).toBe('moduleD')
      expect(result.loadOrder[1].id).toBe('moduleC')
      expect(result.loadOrder[2].id).toBe('moduleB')
      expect(result.loadOrder[3].id).toBe('moduleA')
    })

    it('should respect priority for modules at same level', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [], { priority: 10 })
      const moduleB = createManifest('moduleB', [], { priority: 20 })
      const moduleC = createManifest('moduleC', [], { priority: 5 })

      const result = resolver.resolve([moduleA, moduleB, moduleC])

      expect(result.loadOrder[0].id).toBe('moduleB')
      expect(result.loadOrder[1].id).toBe('moduleA')
      expect(result.loadOrder[2].id).toBe('moduleC')
    })

    it('should detect missing dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB', 'moduleC'])
      const moduleB = createManifest('moduleB')

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.missing).toHaveLength(1)
      expect(result.missing[0]).toEqual({
        moduleId: 'moduleA',
        missingDep: 'moduleC'
      })
    })

    it('should detect circular dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB', ['moduleA'])

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.circular.length).toBeGreaterThan(0)
    })

    it('should detect complex circular dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB', ['moduleC'])
      const moduleC = createManifest('moduleC', ['moduleA'])

      const result = resolver.resolve([moduleA, moduleB, moduleC])

      expect(result.circular.length).toBeGreaterThan(0)
    })

    it('should use fallback sort when cycles exist', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'], { priority: 10 })
      const moduleB = createManifest('moduleB', ['moduleA'], { priority: 20 })

      const result = resolver.resolve([moduleA, moduleB])

      // Should still return a load order
      expect(result.loadOrder).toHaveLength(2)
      // Higher priority should be first in fallback
      expect(result.loadOrder[0].id).toBe('moduleB')
    })

    it('should populate resolvedVersions map', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [], { version: '2.0.0' })
      const moduleB = createManifest('moduleB', [], { version: '1.5.0' })

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.resolvedVersions.get('moduleA')).toBe('2.0.0')
      expect(result.resolvedVersions.get('moduleB')).toBe('1.5.0')
    })
  })

  describe('version resolution', () => {
    it('should accept dependencies with version ranges', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '^1.0.0' }
      ])
      const moduleB = createManifest('moduleB', [], { version: '1.2.3' })

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.loadOrder).toHaveLength(2)
      expect(result.versionConflicts).toHaveLength(0)
    })

    it('should detect version conflicts', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleC', versionRange: '^2.0.0' }
      ])
      const moduleC = createManifest('moduleC', [], { version: '1.0.0' })

      const result = resolver.resolve([moduleA, moduleC])

      expect(result.versionConflicts).toHaveLength(1)
      expect(result.versionConflicts[0].moduleId).toBe('moduleC')
      expect(result.versionConflicts[0].availableVersion).toBe('1.0.0')
    })

    it('should select highest version when multiple versions exist', () => {
      const resolver = new DependencyResolver()
      const moduleAv1 = createManifest('moduleA', [], { version: '1.0.0' })
      const moduleAv2 = createManifest('moduleA', [], { version: '2.0.0' })
      const moduleAv15 = createManifest('moduleA', [], { version: '1.5.0' })

      const result = resolver.resolve([moduleAv1, moduleAv2, moduleAv15])

      expect(result.loadOrder).toHaveLength(1)
      expect(result.loadOrder[0].version).toBe('2.0.0')
      expect(result.resolvedVersions.get('moduleA')).toBe('2.0.0')
    })

    it('should handle mixed string and object dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        'moduleB',
        { id: 'moduleC', versionRange: '>=1.0.0' }
      ])
      const moduleB = createManifest('moduleB')
      const moduleC = createManifest('moduleC', [], { version: '1.5.0' })

      const result = resolver.resolve([moduleA, moduleB, moduleC])

      expect(result.loadOrder).toHaveLength(3)
      expect(result.versionConflicts).toHaveLength(0)
    })

    it('should support tilde version ranges', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '~1.2.0' }
      ])
      const moduleB = createManifest('moduleB', [], { version: '1.2.5' })

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.versionConflicts).toHaveLength(0)
    })

    it('should reject incompatible tilde ranges', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '~1.2.0' }
      ])
      const moduleB = createManifest('moduleB', [], { version: '1.3.0' })

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.versionConflicts).toHaveLength(1)
    })

    it('should support complex version ranges', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '>=1.0.0 <2.0.0' }
      ])
      const moduleB = createManifest('moduleB', [], { version: '1.9.9' })

      const result = resolver.resolve([moduleA, moduleB])

      expect(result.versionConflicts).toHaveLength(0)
    })
  })

  describe('findMatchingVersion', () => {
    it('should find highest version without constraint', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('lib', [], { version: '1.0.0' }),
        createManifest('lib', [], { version: '2.0.0' }),
        createManifest('lib', [], { version: '1.5.0' })
      ]

      const match = resolver.findMatchingVersion({ id: 'lib' }, modules)

      expect(match?.version).toBe('2.0.0')
    })

    it('should find highest matching version with constraint', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('lib', [], { version: '1.0.0' }),
        createManifest('lib', [], { version: '2.0.0' }),
        createManifest('lib', [], { version: '1.5.0' })
      ]

      const match = resolver.findMatchingVersion(
        { id: 'lib', versionRange: '^1.0.0' },
        modules
      )

      expect(match?.version).toBe('1.5.0')
    })

    it('should return undefined for no matching version', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('lib', [], { version: '1.0.0' })
      ]

      const match = resolver.findMatchingVersion(
        { id: 'lib', versionRange: '^2.0.0' },
        modules
      )

      expect(match).toBeUndefined()
    })

    it('should return undefined for non-existing module', () => {
      const resolver = new DependencyResolver()
      const modules = [createManifest('other', [], { version: '1.0.0' })]

      const match = resolver.findMatchingVersion({ id: 'lib' }, modules)

      expect(match).toBeUndefined()
    })
  })

  describe('satisfies', () => {
    it('should return true for any version without constraint', () => {
      const resolver = new DependencyResolver()

      expect(resolver.satisfies('1.0.0', { id: 'lib' })).toBe(true)
      expect(resolver.satisfies('999.0.0', { id: 'lib' })).toBe(true)
    })

    it('should check caret range correctly', () => {
      const resolver = new DependencyResolver()
      const spec = { id: 'lib', versionRange: '^1.2.3' }

      expect(resolver.satisfies('1.2.3', spec)).toBe(true)
      expect(resolver.satisfies('1.9.9', spec)).toBe(true)
      expect(resolver.satisfies('2.0.0', spec)).toBe(false)
      expect(resolver.satisfies('1.2.2', spec)).toBe(false)
    })

    it('should check tilde range correctly', () => {
      const resolver = new DependencyResolver()
      const spec = { id: 'lib', versionRange: '~1.2.3' }

      expect(resolver.satisfies('1.2.3', spec)).toBe(true)
      expect(resolver.satisfies('1.2.9', spec)).toBe(true)
      expect(resolver.satisfies('1.3.0', spec)).toBe(false)
    })
  })

  describe('findCompatibleVersion', () => {
    it('should find version satisfying all constraints', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('lib', [], { version: '1.0.0' }),
        createManifest('lib', [], { version: '1.5.0' }),
        createManifest('lib', [], { version: '2.0.0' })
      ]

      const version = resolver.findCompatibleVersion(
        'lib',
        ['^1.0.0', '>=1.4.0'],
        modules
      )

      expect(version).toBe('1.5.0')
    })

    it('should return undefined for incompatible constraints', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('lib', [], { version: '1.0.0' }),
        createManifest('lib', [], { version: '2.0.0' })
      ]

      const version = resolver.findCompatibleVersion(
        'lib',
        ['^1.0.0', '^2.0.0'],
        modules
      )

      expect(version).toBeUndefined()
    })
  })

  describe('validateVersionConstraints', () => {
    it('should return empty array when all constraints satisfied', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('app', [{ id: 'lib', versionRange: '^1.0.0' }]),
        createManifest('lib', [], { version: '1.5.0' })
      ]

      const conflicts = resolver.validateVersionConstraints(modules)

      expect(conflicts).toHaveLength(0)
    })

    it('should detect conflicting requirements from multiple modules', () => {
      const resolver = new DependencyResolver()
      const modules = [
        createManifest('app1', [{ id: 'lib', versionRange: '^1.0.0' }]),
        createManifest('app2', [{ id: 'lib', versionRange: '^2.0.0' }]),
        createManifest('lib', [], { version: '1.5.0' })
      ]

      const conflicts = resolver.validateVersionConstraints(modules)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].moduleId).toBe('lib')
      expect(conflicts[0].requirements).toHaveLength(2)
    })
  })

  describe('getTransitiveDependencies', () => {
    it('should return empty array for no dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA')

      const deps = resolver.getTransitiveDependencies('moduleA', [moduleA])

      expect(deps).toEqual([])
    })

    it('should return direct dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB')

      const deps = resolver.getTransitiveDependencies('moduleA', [moduleA, moduleB])

      expect(deps).toContain('moduleB')
    })

    it('should return transitive dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB', ['moduleC'])
      const moduleC = createManifest('moduleC')

      const deps = resolver.getTransitiveDependencies('moduleA', [moduleA, moduleB, moduleC])

      expect(deps).toContain('moduleB')
      expect(deps).toContain('moduleC')
    })

    it('should handle shared dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB', 'moduleC'])
      const moduleB = createManifest('moduleB', ['moduleD'])
      const moduleC = createManifest('moduleC', ['moduleD'])
      const moduleD = createManifest('moduleD')

      const deps = resolver.getTransitiveDependencies('moduleA', [moduleA, moduleB, moduleC, moduleD])

      expect(deps).toContain('moduleB')
      expect(deps).toContain('moduleC')
      expect(deps).toContain('moduleD')
      // moduleD should only appear once
      expect(deps.filter(d => d === 'moduleD')).toHaveLength(1)
    })

    it('should work with versioned dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '^1.0.0' }
      ])
      const moduleB = createManifest('moduleB', ['moduleC'], { version: '1.5.0' })
      const moduleC = createManifest('moduleC')

      const deps = resolver.getTransitiveDependencies('moduleA', [moduleA, moduleB, moduleC])

      expect(deps).toContain('moduleB')
      expect(deps).toContain('moduleC')
    })
  })

  describe('getDependents', () => {
    it('should return empty array for no dependents', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA')

      const dependents = resolver.getDependents('moduleA', [moduleA])

      expect(dependents).toEqual([])
    })

    it('should return modules that depend on the given module', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', ['moduleB'])
      const moduleB = createManifest('moduleB')
      const moduleC = createManifest('moduleC', ['moduleB'])

      const dependents = resolver.getDependents('moduleB', [moduleA, moduleB, moduleC])

      expect(dependents).toContain('moduleA')
      expect(dependents).toContain('moduleC')
      expect(dependents).toHaveLength(2)
    })

    it('should work with versioned dependencies', () => {
      const resolver = new DependencyResolver()
      const moduleA = createManifest('moduleA', [
        { id: 'moduleB', versionRange: '^1.0.0' }
      ])
      const moduleB = createManifest('moduleB', [], { version: '1.5.0' })

      const dependents = resolver.getDependents('moduleB', [moduleA, moduleB])

      expect(dependents).toContain('moduleA')
    })
  })
})