import { describe, it, expect } from 'vitest'
import {
  ENVIRONMENT,
  IDENTITY_NAMESPACE,
  LIBRARY_NAMESPACE,
  libraryCapabilities,
  MODULE_TYPE,
  SERVICE_NAMESPACE,
  capabilitiesOf,
  requirementsOf,
  resolveWiring,
  satisfies,
  wiringOf
} from '../capabilities'
import type { Capability, ModuleManifest, Requirement } from '../types'

/**
 * Requirements and capabilities, OSGi Core 3.3.
 *
 * Resolution is static: it works on manifests and says whether a module could run
 * at all. That a promised service is really registered is the runtime question,
 * and `requiresService` asks it — the specification calls a service capability "a
 * promise" at resolve time.
 */
function bundle(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `/modules/${id}.js`,
    exports: {},
    ...extra
  }
}

describe('capabilitiesOf', () => {
  it('should give every module its identity', () => {
    expect(capabilitiesOf(bundle('tiles'))).toEqual([
      {
        namespace: IDENTITY_NAMESPACE,
        attributes: { [IDENTITY_NAMESPACE]: 'tiles', type: MODULE_TYPE, version: '1.0.0' }
      }
    ])
  })

  it('should turn each provided service into a promise', () => {
    const capabilities = capabilitiesOf(bundle('tiles', {
      provides: [{ id: 'demo.tiles', properties: { kind: 'raster' } }]
    }))

    expect(capabilities[1]).toEqual({
      namespace: SERVICE_NAMESPACE,
      // A list, as the specification defines objectClass
      attributes: { objectClass: ['demo.tiles'], kind: 'raster' }
    })
  })

  it('should keep declared capabilities, after the derived ones', () => {
    const own: Capability = { namespace: 'demo.theme', attributes: { name: 'dark' } }

    const capabilities = capabilitiesOf(bundle('theme', { capabilities: [own] }))

    expect(capabilities).toHaveLength(2)
    expect(capabilities[1]).toBe(own)
  })
})

describe('requirementsOf', () => {
  it('should express a dependency as an identity requirement', () => {
    expect(requirementsOf(bundle('map', { dependencies: ['tiles'] }))).toEqual([
      {
        namespace: IDENTITY_NAMESPACE,
        filter: `(${IDENTITY_NAMESPACE}=tiles)`,
        versionRange: undefined,
        resolution: 'mandatory'
      }
    ])
  })

  it('should carry a version range along', () => {
    const [requirement] = requirementsOf(bundle('map', {
      dependencies: [{ id: 'tiles', versionRange: '^2.0.0' }]
    }))

    expect(requirement.versionRange).toBe('^2.0.0')
  })

  it('should mark an optional dependency optional', () => {
    const [requirement] = requirementsOf(bundle('map', { optionalDependencies: ['traffic'] }))

    expect(requirement.resolution).toBe('optional')
  })

  it('should express a required service as a service requirement', () => {
    const [requirement] = requirementsOf(bundle('map', {
      requiresService: [{ id: 'demo.tiles' }]
    }))

    expect(requirement).toMatchObject({
      namespace: SERVICE_NAMESPACE,
      filter: '(objectClass=demo.tiles)',
      resolution: 'mandatory'
    })
  })

  it('should not insist on a service the module can run without', () => {
    const optional = requirementsOf(bundle('map', {
      requiresService: [{ id: 'demo.traffic', optional: true }]
    }))
    const collection = requirementsOf(bundle('map', {
      requiresService: [{ id: 'demo.widgets', cardinality: '0..n' }]
    }))

    // Cardinality 0..n means the module runs with no provider at all, so demanding
    // one at resolve time would be stricter than the runtime is
    expect(optional[0].resolution).toBe('optional')
    expect(collection[0].resolution).toBe('optional')
  })

  it('should express a shared library as a library requirement', () => {
    const [requirement] = requirementsOf(bundle('ui', {
      sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }]
    }))

    expect(requirement).toMatchObject({
      namespace: LIBRARY_NAMESPACE,
      filter: '(library=vue)',
      versionRange: '^3.4.0'
    })
  })

  it('should escape what a filter value may not contain', () => {
    const [requirement] = requirementsOf(bundle('odd', { dependencies: ['a(b)c*'] }))

    expect(requirement.filter).toBe(`(${IDENTITY_NAMESPACE}=a\\(b\\)c\\*)`)
  })
})

describe('satisfies', () => {
  const theme: Capability = {
    namespace: 'demo.theme',
    attributes: { name: 'dark', version: '1.10.0', contrast: 7 }
  }

  it('should need the same namespace', () => {
    expect(satisfies({ namespace: 'demo.other' }, theme)).toBe(false)
    expect(satisfies({ namespace: 'demo.theme' }, theme)).toBe(true)
  })

  it('should match on any capability of the namespace without a filter', () => {
    expect(satisfies({ namespace: 'demo.theme' }, theme)).toBe(true)
  })

  it('should assert the filter against the attributes', () => {
    expect(satisfies({ namespace: 'demo.theme', filter: '(name=dark)' }, theme)).toBe(true)
    expect(satisfies({ namespace: 'demo.theme', filter: '(name=light)' }, theme)).toBe(false)
    expect(satisfies({ namespace: 'demo.theme', filter: '(contrast>=5)' }, theme)).toBe(true)
  })

  it('should match attribute names case sensitively, unlike a service filter', () => {
    // Core 3.3.6: attribute names locate capability attributes "in a case
    // sensitive manner"
    expect(satisfies({ namespace: 'demo.theme', filter: '(NAME=dark)' }, theme)).toBe(false)
  })

  it('should compare a version range as a version, not as text', () => {
    // The whole reason versionRange exists: as text, 1.10.0 sorts below 1.9.0
    expect(satisfies({ namespace: 'demo.theme', versionRange: '>=1.9.0' }, theme)).toBe(true)
    expect(satisfies({ namespace: 'demo.theme', versionRange: '^2.0.0' }, theme)).toBe(false)
  })

  it('should refuse a version range where there is no version', () => {
    const unversioned: Capability = { namespace: 'demo.theme', attributes: { name: 'dark' } }

    expect(satisfies({ namespace: 'demo.theme', versionRange: '^1.0.0' }, unversioned)).toBe(false)
  })

  it('should combine filter and version range', () => {
    const requirement: Requirement = {
      namespace: 'demo.theme',
      filter: '(name=dark)',
      versionRange: '^1.0.0'
    }

    expect(satisfies(requirement, theme)).toBe(true)
    expect(satisfies({ ...requirement, filter: '(name=light)' }, theme)).toBe(false)
  })

  it('should ignore a capability that is not effective at resolve time', () => {
    const later: Capability = {
      namespace: 'demo.theme',
      attributes: { name: 'dark' },
      directives: { effective: 'active' }
    }

    expect(satisfies({ namespace: 'demo.theme' }, later)).toBe(false)
  })

  it('should insist that one capability meets the whole filter', () => {
    // Explicit in the specification: two capabilities each carrying one half do
    // not satisfy (&(a=1)(b=2))
    const half: Capability = { namespace: 'demo.x', attributes: { a: 1 } }

    expect(satisfies({ namespace: 'demo.x', filter: '(&(a=1)(b=2))' }, half)).toBe(false)
  })
})

describe('resolveWiring', () => {
  it('should wire a dependency to the module providing the identity', () => {
    const resolution = resolveWiring([bundle('tiles'), bundle('map', { dependencies: ['tiles'] })])

    expect(resolution.unresolved).toEqual([])
    expect(resolution.wires).toHaveLength(1)
    expect(resolution.wires[0]).toMatchObject({ requirer: 'map', provider: 'tiles' })
  })

  it('should wire a service requirement to the promise', () => {
    const resolution = resolveWiring([
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('map', { requiresService: [{ id: 'demo.tiles' }] })
    ])

    expect(resolution.wires.map(wire => [wire.requirer, wire.provider]))
      .toEqual([['map', 'tiles']])
  })

  it('should refuse to resolve a module whose mandatory requirement is missing', () => {
    const resolution = resolveWiring([bundle('map', { dependencies: ['tiles'] })])

    expect(resolution.resolved).toEqual([])
    expect(resolution.unresolved).toHaveLength(1)
    expect(resolution.unresolved[0]).toMatchObject({ moduleId: 'map', reason: 'no-match' })
  })

  it('should tell an empty namespace from an unmatched filter', () => {
    const resolution = resolveWiring([
      bundle('map', { requirements: [{ namespace: 'demo.theme', filter: '(name=dark)' }] }),
      bundle('other', { capabilities: [{ namespace: 'demo.theme', attributes: { name: 'light' } }] }),
      bundle('lonely', { requirements: [{ namespace: 'demo.nothing' }] })
    ])

    const byModule = new Map(resolution.unresolved.map(entry => [entry.moduleId, entry.reason]))
    expect(byModule.get('map')).toBe('no-match')
    expect(byModule.get('lonely')).toBe('no-capability')
  })

  it('should resolve a module whose only failure was optional', () => {
    const resolution = resolveWiring([bundle('map', { optionalDependencies: ['traffic'] })])

    expect(resolution.resolved).toEqual(['map'])
    expect(resolution.wires).toEqual([])
    expect(resolution.unresolved).toEqual([])
  })

  it('should wire once for a single requirement and to all for multiple', () => {
    const modules = [
      bundle('a', { capabilities: [{ namespace: 'demo.widget', attributes: { zone: 'main' } }] }),
      bundle('b', { capabilities: [{ namespace: 'demo.widget', attributes: { zone: 'main' } }] }),
      bundle('single', { requirements: [{ namespace: 'demo.widget' }] }),
      bundle('many', { requirements: [{ namespace: 'demo.widget', cardinality: 'multiple' }] })
    ]

    const resolution = resolveWiring(modules)

    expect(resolution.wires.filter(wire => wire.requirer === 'single')).toHaveLength(1)
    expect(resolution.wires.filter(wire => wire.requirer === 'many')).toHaveLength(2)
  })

  it('should prefer the highest version among matches', () => {
    const resolution = resolveWiring([
      bundle('old', {
        capabilities: [{ namespace: 'demo.engine', attributes: { version: '1.9.0' } }]
      }),
      bundle('new', {
        capabilities: [{ namespace: 'demo.engine', attributes: { version: '1.10.0' } }]
      }),
      bundle('app', { requirements: [{ namespace: 'demo.engine' }] })
    ])

    // 1.10.0, not 1.9.0 — which is why the comparison is semver and not text
    expect(resolution.wires.find(wire => wire.requirer === 'app')?.provider).toBe('new')
  })

  it('should skip a requirement that is not effective at resolve time', () => {
    const resolution = resolveWiring([
      bundle('app', { requirements: [{ namespace: 'demo.nothing', effective: 'active' }] })
    ])

    expect(resolution.resolved).toEqual(['app'])
    expect(resolution.unresolved).toEqual([])
  })

  it('should let a module satisfy its own requirement', () => {
    const resolution = resolveWiring([
      bundle('self', {
        capabilities: [{ namespace: 'demo.thing', attributes: { name: 'x' } }],
        requirements: [{ namespace: 'demo.thing' }]
      })
    ])

    expect(resolution.wires[0]).toMatchObject({ requirer: 'self', provider: 'self' })
  })
})

describe('what the environment brings', () => {
  it('should leave a shared dependency unresolvable on its own', () => {
    // The requirement is derived from the manifest; the library lives outside the
    // model, so without the environment saying so, nothing offers it
    const resolution = resolveWiring([
      bundle('ui', { sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }] })
    ])

    expect(resolution.unresolved.map(entry => entry.reason)).toEqual(['no-capability'])
  })

  it('should resolve it once the host says what it provides', () => {
    const resolution = resolveWiring(
      [bundle('ui', { sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }] })],
      { offered: libraryCapabilities({ vue: '3.5.13' }) }
    )

    expect(resolution.unresolved).toEqual([])
    expect(resolution.wires[0]).toMatchObject({ requirer: 'ui', provider: ENVIRONMENT })
  })

  it('should hold the version range against what the host has', () => {
    const resolution = resolveWiring(
      [bundle('ui', { sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }] })],
      { offered: libraryCapabilities({ vue: '3.2.0' }) }
    )

    // Present, but too old — the same judgement validateSharedDependencies makes
    // at load time, here before anything is fetched
    expect(resolution.unresolved.map(entry => entry.reason)).toEqual(['no-match'])
  })

  it('should take a registry of libraries as the runtime keeps it', () => {
    const registered = new Map([
      ['vue', { version: '3.5.13', providedBy: 'host' }],
      ['d3', { version: '7.9.0' }]
    ])

    expect(libraryCapabilities(registered)).toEqual([
      { namespace: LIBRARY_NAMESPACE, attributes: { library: 'vue', version: '3.5.13' } },
      { namespace: LIBRARY_NAMESPACE, attributes: { library: 'd3', version: '7.9.0' } }
    ])
  })

  it('should let a library be a module that offers the capability instead', () => {
    // The other way to close the same gap: no host registry, just a manifest
    const resolution = resolveWiring([
      bundle('vue-bundle', {
        capabilities: [{
          namespace: LIBRARY_NAMESPACE,
          attributes: { library: 'vue', version: '3.5.13' }
        }]
      }),
      bundle('ui', { sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }] })
    ])

    expect(resolution.unresolved).toEqual([])
    expect(resolution.wires[0].provider).toBe('vue-bundle')
  })
})

describe('the requirement report', () => {
  it('should pair every requirement with its wires', () => {
    const resolution = resolveWiring([
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('map', { requiresService: [{ id: 'demo.tiles' }] })
    ])

    const report = resolution.requirements.find(entry => entry.moduleId === 'map')!
    expect(report.requirement.namespace).toBe(SERVICE_NAMESPACE)
    expect(report.wires.map(wire => wire.provider)).toEqual(['tiles'])
    expect(report.failure).toBeUndefined()
  })

  it('should carry the same objects the flat lists carry', () => {
    // The reason this exists: derived requirements are fresh objects on every
    // requirementsOf() call, so a consumer cannot match a Wire against one it
    // fetched itself. Within one resolution the identity holds.
    const resolution = resolveWiring([
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('map', { requiresService: [{ id: 'demo.tiles' }] })
    ])

    const report = resolution.requirements.find(entry => entry.wires.length > 0)!
    expect(resolution.wires).toContain(report.wires[0])
    expect(report.wires[0].requirement).toBe(report.requirement)
  })

  it('should mark the failure on the requirement that caused it', () => {
    const resolution = resolveWiring([bundle('map', { dependencies: ['tiles'] })])

    const [report] = resolution.requirements
    expect(report.failure).toBeDefined()
    expect(resolution.unresolved).toContain(report.failure)
  })

  it('should report an unmet optional requirement without a failure', () => {
    const resolution = resolveWiring([bundle('map', { optionalDependencies: ['traffic'] })])

    const [report] = resolution.requirements
    expect(report.wires).toEqual([])
    expect(report.failure).toBeUndefined()
  })

  it('should list every wire of a multiple requirement', () => {
    const resolution = resolveWiring([
      bundle('a', { capabilities: [{ namespace: 'demo.widget' }] }),
      bundle('b', { capabilities: [{ namespace: 'demo.widget' }] }),
      bundle('many', { requirements: [{ namespace: 'demo.widget', cardinality: 'multiple' }] })
    ])

    const report = resolution.requirements.find(entry => entry.moduleId === 'many')!
    expect(report.wires.map(wire => wire.provider).sort()).toEqual(['a', 'b'])
  })

  it('should leave out what the resolver does not consider', () => {
    const resolution = resolveWiring([
      bundle('app', { requirements: [{ namespace: 'demo.later', effective: 'active' }] })
    ])

    expect(resolution.requirements).toEqual([])
  })
})

describe('wiringOf', () => {
  it('should show both directions for one module', () => {
    const resolution = resolveWiring([
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('map', {
        dependencies: ['tiles'],
        requiresService: [{ id: 'demo.tiles' }],
        provides: [{ id: 'demo.map' }]
      }),
      bundle('app', { requiresService: [{ id: 'demo.map' }] })
    ])

    const wiring = wiringOf(resolution, 'map')

    expect(wiring.requires.map(wire => wire.provider)).toEqual(['tiles', 'tiles'])
    expect(wiring.provides.map(wire => wire.requirer)).toEqual(['app'])
  })
})

describe('the loader', () => {
  it('should tell waiting from waiting in vain', async () => {
    const { ModuleLoader } = await import('../ModuleLoader')
    const loader = new ModuleLoader()

    loader.register([
      // Its service is promised by nobody: this module can never run
      bundle('map', { requiresService: [{ id: 'demo.tiles' }] }),
      // This one waits for a promise that exists
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('atlas', { requiresService: [{ id: 'demo.map' }] })
    ])

    const unresolved = loader.getUnresolvedModules()

    expect(unresolved.map(entry => entry.moduleId)).toEqual(['atlas'])
    expect(unresolved[0].reason).toBe('no-match')
    // map is resolvable, so it is merely waiting — which getUnsatisfiedModules says
    expect(loader.getWiring().resolved.sort()).toEqual(['map', 'tiles'])
  })

  it('should report what a module is wired to in both directions', async () => {
    const { ModuleLoader } = await import('../ModuleLoader')
    const loader = new ModuleLoader()
    loader.register([
      bundle('tiles', { provides: [{ id: 'demo.tiles' }] }),
      bundle('map', { dependencies: ['tiles'], provides: [{ id: 'demo.map' }] }),
      bundle('atlas', { requiresService: [{ id: 'demo.map' }] })
    ])

    const wiring = loader.getModuleWiring('map')

    expect(wiring.requires.map(wire => wire.provider)).toEqual(['tiles'])
    expect(wiring.provides.map(wire => wire.requirer)).toEqual(['atlas'])
  })

  it('should see a declared capability of one module from another', async () => {
    const { ModuleLoader } = await import('../ModuleLoader')
    const loader = new ModuleLoader()
    loader.register([
      bundle('dark', {
        capabilities: [{ namespace: 'demo.theme', attributes: { name: 'dark', version: '2.0.0' } }]
      }),
      bundle('app', {
        requirements: [{ namespace: 'demo.theme', filter: '(name=dark)', versionRange: '^2.0.0' }]
      })
    ])

    expect(loader.getUnresolvedModules()).toEqual([])
    expect(loader.getModuleWiring('app').requires[0].provider).toBe('dark')
  })
})
