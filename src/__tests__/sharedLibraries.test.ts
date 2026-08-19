// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateImportMap, importMapScript, installImportMap } from '../importMap'
import { createTsmExternals } from '../vite/plugin'
import { ModuleLoader } from '../ModuleLoader'
import type { ModuleManifest } from '../types'

/**
 * Shared libraries: the declaration in the manifest, the build that has to honour
 * it, and the import map that resolves it.
 *
 * The failure these guard against is the quiet one — a package declared as shared
 * but bundled anyway gives the module its own copy, and nothing at runtime notices.
 */
function bundle(id: string, shared: Array<{ id: string; versionRange: string }> = []): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    entry: `/modules/${id}.js`,
    exports: {},
    sharedDependencies: shared
  }
}

describe('createTsmExternals', () => {
  describe('from a manifest', () => {
    const manifest = bundle('ui', [
      { id: 'vue', versionRange: '^3.4.0' },
      { id: '@primevue/core', versionRange: '^4.0.0' }
    ])

    it('should externalize what the manifest declares as shared', () => {
      const external = createTsmExternals(manifest)

      expect(external('vue')).toBe(true)
      expect(external('@primevue/core')).toBe(true)
    })

    it('should cover subpaths of a declared package', () => {
      const external = createTsmExternals(manifest)

      expect(external('vue/dist/vue.esm-bundler.js')).toBe(true)
      expect(external('@primevue/core/config')).toBe(true)
    })

    it('should bundle anything the manifest does not declare', () => {
      const external = createTsmExternals(manifest)

      // The whole point: the manifest decides, not a list kept in the build
      expect(external('lodash')).toBe(false)
      expect(external('vue-router')).toBe(false)
    })

    it('should always externalize tsm itself, which the host supplies', () => {
      const external = createTsmExternals(bundle('plain'))

      expect(external('@eclipse-daanse/tsm')).toBe(true)
      expect(external('@eclipse-daanse/tsm/decorators')).toBe(true)
    })

    it('should add to the defaults rather than replace them', () => {
      // A transitive package under another name: with vue shared, bundling
      // @vue/runtime-core would create the second instance sharing avoids
      const external = createTsmExternals(manifest, { alwaysExternal: ['@vue'] })

      expect(external('@vue/runtime-core')).toBe(true)
      // And tsm stays external without having to be repeated
      expect(external('@eclipse-daanse/tsm')).toBe(true)
      expect(external('vue')).toBe(true)
    })

    it('should let a library provider bundle what it provides', () => {
      // A provider does not list what it provides in its own sharedDependencies,
      // so it falls out of the external set by itself
      const provider = createTsmExternals(bundle('vue-provider'))

      expect(provider('vue')).toBe(false)
    })
  })

  describe('from a module id, as before', () => {
    it('should still consult the kept lists', () => {
      const external = createTsmExternals('some-module')

      expect(external('vue')).toBe(true)
      expect(external('primevue/button')).toBe(true)
      expect(external('lodash')).toBe(false)
    })

    it('should still let a declared library provider bundle everything', () => {
      const external = createTsmExternals('ui-provider', { libraryProviders: ['ui-provider'] })

      expect(external('primevue')).toBe(false)
      // Except tsm, which the host owns either way
      expect(external('tsm')).toBe(true)
    })
  })
})

describe('generateImportMap', () => {
  const modules = [
    bundle('map', [{ id: 'vue', versionRange: '^3.4.0' }]),
    bundle('chart', [
      { id: 'vue', versionRange: '^3.0.0' },
      { id: 'd3', versionRange: '^7.0.0' }
    ])
  ]

  it('should map each declared library to its url', () => {
    const { importMap } = generateImportMap(modules, {
      vue: '/libs/vue.js',
      d3: '/libs/d3.js'
    })

    expect(importMap.imports).toEqual({ vue: '/libs/vue.js', d3: '/libs/d3.js' })
  })

  it('should leave out what nobody asks for', () => {
    const { importMap } = generateImportMap(modules, {
      vue: '/libs/vue.js',
      d3: '/libs/d3.js',
      unused: '/libs/unused.js'
    })

    expect(importMap.imports.unused).toBeUndefined()
  })

  it('should report a library the host does not offer', () => {
    const { missing, importMap } = generateImportMap(modules, { vue: '/libs/vue.js' })

    expect(missing).toEqual([
      { moduleId: 'chart', library: 'd3', versionRange: '^7.0.0' }
    ])
    expect(importMap.imports.d3).toBeUndefined()
  })

  it('should report a version no declared range accepts', () => {
    const { incompatible } = generateImportMap(modules, {
      vue: { url: '/libs/vue.js', version: '3.2.0' },
      d3: { url: '/libs/d3.js', version: '7.8.0' }
    })

    // chart accepts ^3.0.0, map does not accept 3.2.0
    expect(incompatible).toEqual([
      { moduleId: 'map', library: 'vue', versionRange: '^3.4.0', offered: '3.2.0' }
    ])
  })

  it('should accept a version that satisfies the range', () => {
    const { missing, incompatible, importMap } = generateImportMap(modules, {
      vue: { url: '/libs/vue.js', version: '3.5.13' },
      d3: { url: '/libs/d3.js', version: '7.9.0' }
    })

    expect(missing).toEqual([])
    expect(incompatible).toEqual([])
    expect(importMap.imports.vue).toBe('/libs/vue.js')
  })

  it('should take a range on trust when no version is offered', () => {
    const { incompatible } = generateImportMap(modules, {
      vue: '/libs/vue.js',
      d3: '/libs/d3.js'
    })

    expect(incompatible).toEqual([])
  })
})

describe('importMapScript', () => {
  it('should produce a script tag the document can carry', () => {
    const html = importMapScript({ imports: { vue: '/libs/vue.js' } })

    expect(html).toContain('<script type="importmap">')
    expect(html).toContain('"vue": "/libs/vue.js"')
  })

  it('should not let a url end the tag early', () => {
    const html = importMapScript({ imports: { evil: '/x</script><script>alert(1)</script>' } })

    expect(html).not.toContain('</script><script>')
    expect(html).toContain('<\\/script')
  })
})

describe('installImportMap', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  afterEach(() => {
    document.head.innerHTML = ''
  })

  it('should add the map to the document', () => {
    expect(installImportMap({ imports: { vue: '/libs/vue.js' } })).toBe(true)

    const script = document.querySelector('script[type="importmap"]')
    expect(JSON.parse(script!.textContent!)).toEqual({ imports: { vue: '/libs/vue.js' } })
  })

  it('should refuse to add a second one', () => {
    installImportMap({ imports: { vue: '/a.js' } })

    // A browser reads the map once; a second would be ignored or rejected, so
    // silently replacing the first would be worse than saying no
    expect(installImportMap({ imports: { vue: '/b.js' } })).toBe(false)
    expect(document.querySelectorAll('script[type="importmap"]')).toHaveLength(1)
  })
})

describe('the loader with an import map', () => {
  it('should not demand the tsm runtime', async () => {
    const loader = new ModuleLoader({ sharedLibraries: 'import-map' })
    const manifest = bundle('ui', [{ id: 'vue', versionRange: '^3.4.0' }])
    loader.register([manifest])

    // Without the runtime this would throw before anything is imported
    await expect(loader.loadModule(manifest)).rejects.toThrow(/Failed to load module entry/)
  })

  it('should still demand it by default', async () => {
    const loader = new ModuleLoader()
    const manifest = bundle('ui', [{ id: 'vue', versionRange: '^3.4.0' }])
    loader.register([manifest])

    await expect(loader.loadModule(manifest)).rejects.toThrow(/TSM runtime is not initialized/)
  })
})
