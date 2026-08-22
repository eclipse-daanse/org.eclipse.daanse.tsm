/**
 * Library bundles: a module whose contribution is a package rather than a service.
 *
 * The OSGi equivalent of a bundle that exports a package and is never started.
 * The consumer imports it by its bare name and cannot tell whether the host or
 * another bundle supplies it — which is the point.
 */

import { describe, it, expect } from 'vitest'
import { generateImportMap, offeredByModules } from '../importMap.js'
import { resolveWiring, LIBRARY_NAMESPACE, systemBundle } from '../capabilities.js'
import type { ModuleManifest } from '../types.js'

const libraryBundle = (
  id: string, library: string, version: string, entry = `/modules/${id}/index.js`
): ModuleManifest => ({
  id, version, entry, exports: {},
  capabilities: [{ namespace: LIBRARY_NAMESPACE, attributes: { library, version } }]
})

const consumer = (id: string, library: string, range: string): ModuleManifest => ({
  id, version: '1.0.0', entry: `/modules/${id}/index.js`, exports: {},
  sharedDependencies: [{ id: library, versionRange: range }]
})

describe('offeredByModules()', () => {
  it('finds what a library bundle offers', () => {
    const offered = offeredByModules([libraryBundle('geo-bundle', 'geo', '1.2.0')])

    expect(offered.geo).toEqual({
      url: '/modules/geo-bundle/index.js',
      version: '1.2.0',
      moduleId: 'geo-bundle'
    })
  })

  it('points at the module entry, because the package is the module', () => {
    const offered = offeredByModules([
      libraryBundle('geo-bundle', 'geo', '1.0.0', '/dist/geo.mjs')
    ])
    expect(offered.geo.url).toBe('/dist/geo.mjs')
  })

  it('takes several libraries from one module', () => {
    const manifest: ModuleManifest = {
      id: 'kit', version: '1.0.0', entry: '/kit.js', exports: {},
      capabilities: [
        { namespace: LIBRARY_NAMESPACE, attributes: { library: 'geo', version: '1.0.0' } },
        { namespace: LIBRARY_NAMESPACE, attributes: { library: 'time', version: '2.0.0' } }
      ]
    }

    expect(Object.keys(offeredByModules([manifest])).sort()).toEqual(['geo', 'time'])
  })

  it('ignores capabilities in other namespaces', () => {
    const manifest: ModuleManifest = {
      id: 'x', version: '1.0.0', entry: '/x.js', exports: {},
      capabilities: [{ namespace: 'acme.screen', attributes: { width: 640 } }]
    }
    expect(offeredByModules([manifest])).toEqual({})
  })

  it('ignores a capability without a library name', () => {
    const manifest: ModuleManifest = {
      id: 'x', version: '1.0.0', entry: '/x.js', exports: {},
      capabilities: [{ namespace: LIBRARY_NAMESPACE, attributes: { version: '1.0.0' } }]
    }
    expect(offeredByModules([manifest])).toEqual({})
  })

  it('takes a capability without a version on trust', () => {
    const manifest: ModuleManifest = {
      id: 'x', version: '1.0.0', entry: '/x.js', exports: {},
      capabilities: [{ namespace: LIBRARY_NAMESPACE, attributes: { library: 'geo' } }]
    }
    expect(offeredByModules([manifest]).geo.version).toBeUndefined()
  })
})

describe('the import map', () => {
  it('resolves a consumer against a library bundle', () => {
    const result = generateImportMap([
      libraryBundle('geo-bundle', 'geo', '1.2.0'),
      consumer('map', 'geo', '^1.2.0')
    ])

    expect(result.importMap.imports).toEqual({ geo: '/modules/geo-bundle/index.js' })
    expect(result.missing).toEqual([])
  })

  it('needs no host offer at all', () => {
    // The whole point: the chain closes without the host being involved
    const result = generateImportMap([
      libraryBundle('geo-bundle', 'geo', '1.0.0'),
      consumer('map', 'geo', '^1.0.0')
    ])
    expect(result.importMap.imports.geo).toBeDefined()
  })

  it('reports a version the consumer cannot use', () => {
    const result = generateImportMap([
      libraryBundle('geo-bundle', 'geo', '1.0.0'),
      consumer('map', 'geo', '^2.0.0')
    ])

    expect(result.importMap.imports).toEqual({})
    expect(result.incompatible).toEqual([
      { moduleId: 'map', library: 'geo', versionRange: '^2.0.0', offered: '1.0.0' }
    ])
  })

  it('reports a library nothing offers', () => {
    const result = generateImportMap([consumer('map', 'geo', '^1.0.0')])

    expect(result.missing).toEqual([
      { moduleId: 'map', library: 'geo', versionRange: '^1.0.0' }
    ])
  })

  it('lets the host win where both offer', () => {
    const result = generateImportMap(
      [libraryBundle('geo-bundle', 'geo', '1.0.0'), consumer('map', 'geo', '^1.0.0')],
      { geo: { url: 'https://cdn/geo.js', version: '1.5.0' } }
    )

    // The host is the outer environment, and a module cannot know what else was
    // built against the host's copy
    expect(result.importMap.imports.geo).toBe('https://cdn/geo.js')
    expect(result.shadowed).toEqual([{
      library: 'geo', moduleId: 'geo-bundle', moduleVersion: '1.0.0', hostVersion: '1.5.0'
    }])
  })

  it('reports the shadowing even when nobody consumes it', () => {
    // It usually means a library bundle was deployed that nobody needed
    const result = generateImportMap(
      [libraryBundle('geo-bundle', 'geo', '1.0.0')],
      { geo: 'https://cdn/geo.js' }
    )

    expect(result.shadowed).toHaveLength(1)
    expect(result.shadowed[0].hostVersion).toBeUndefined()
  })

  it('says nothing about shadowing when only a module offers', () => {
    const result = generateImportMap([
      libraryBundle('geo-bundle', 'geo', '1.0.0'), consumer('map', 'geo', '^1.0.0')
    ])
    expect(result.shadowed).toEqual([])
  })

  it('mixes host and module offers', () => {
    const result = generateImportMap(
      [
        libraryBundle('geo-bundle', 'geo', '1.0.0'),
        consumer('map', 'geo', '^1.0.0'),
        consumer('ui', 'vue', '^3.4.0')
      ],
      { vue: { url: 'https://cdn/vue.js', version: '3.5.0' } }
    )

    expect(result.importMap.imports).toEqual({
      geo: '/modules/geo-bundle/index.js',
      vue: 'https://cdn/vue.js'
    })
    expect(result.missing).toEqual([])
  })
})

describe('the resolution', () => {
  it('wires a consumer to the library bundle before anything loads', () => {
    const resolution = resolveWiring([
      libraryBundle('geo-bundle', 'geo', '1.2.0'),
      consumer('map', 'geo', '^1.2.0')
    ])

    expect(resolution.unresolved).toEqual([])
    expect(resolution.wires.some(wire =>
      wire.requirer === 'map' && wire.provider === 'geo-bundle'
    )).toBe(true)
  })

  it('leaves a consumer unresolved when the version is wrong', () => {
    const resolution = resolveWiring([
      libraryBundle('geo-bundle', 'geo', '1.0.0'),
      consumer('map', 'geo', '^2.0.0')
    ])

    // This is what the mechanism buys over a runtime lookup: not running beats
    // running against the wrong version
    expect(resolution.unresolved.map(entry => entry.moduleId)).toEqual(['map'])
  })

  it('works alongside the system bundle', () => {
    const resolution = resolveWiring([
      systemBundle({ libraries: { vue: '3.5.0' } }),
      libraryBundle('geo-bundle', 'geo', '1.0.0'),
      consumer('map', 'geo', '^1.0.0'),
      consumer('ui', 'vue', '^3.4.0')
    ])

    expect(resolution.unresolved).toEqual([])
  })
})

describe('a library bundle in the loader', () => {
  it('needs no components and no services', async () => {
    const { ModuleLoader } = await import('../ModuleLoader.js')
    const loader = new ModuleLoader({ entryResolver: () => ({ project: () => 'ok' }) })

    const manifest = libraryBundle('geo-bundle', 'geo', '1.0.0')
    await loader.loadModule(manifest)

    // Active but empty: nothing to start, which is what an API bundle is
    expect(loader.getComponents('geo-bundle')).toEqual([])
    expect(loader.getModule('geo-bundle')?.state).toBe('active')
  })

  it('offers its library through the loader wiring', async () => {
    const { ModuleLoader } = await import('../ModuleLoader.js')
    const loader = new ModuleLoader()
    loader.register([
      libraryBundle('geo-bundle', 'geo', '1.0.0'),
      consumer('map', 'geo', '^1.0.0')
    ])

    expect(loader.getWiring().unresolved).toEqual([])
  })
})
