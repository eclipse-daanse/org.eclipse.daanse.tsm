/**
 * TSM Vite Plugin
 *
 * Provides build support for TSM (TypeScript Module System) modules.
 *
 * Features:
 * - Transforms `tsm:module/namespace` imports to `__tsm__.require()` calls
 * - Handles import aliasing (e.g., `import { ref as ref$1 }`)
 * - Injects CSS loader code for extracted CSS files
 *
 * Usage in vite.config.ts:
 *   import { tsmPlugin } from 'tsm/vite'
 *   export default defineConfig({
 *     plugins: [tsmPlugin()]
 *   })
 *
 * Usage in source files:
 *   import { ref, computed } from 'tsm:my-app/vue'
 *   import { Button } from 'tsm:my-app/ui'
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import type { Plugin } from 'vite'
import {
  collectTsmImports,
  declaredIds,
  requiredDependencyIds,
  isDeclared,
  type ValidatableManifest
} from './manifestImports.js'
import {
  ComponentScanError,
  extractComponents,
  type DeclaredService
} from './componentScan.js'

const TSM_PREFIX = 'tsm:'

export interface TsmPluginOptions {
  /**
   * Whether to use renderChunk (for production builds) or transform (for dev)
   * Default: true
   */
  useRenderChunk?: boolean

  /**
   * Manifest to validate `tsm:` imports against — a path to read or the parsed
   * object. Without it no validation happens.
   *
   * Code and manifest are otherwise two independent sources of truth, and a
   * mismatch only shows at runtime: an import of an undeclared module resolves
   * to nothing and the module fails to activate.
   */
  manifest?: string | ValidatableManifest

  /**
   * What to do with the `@component()` declarations in the sources.
   *
   * - `'validate'`: compare them against the manifest's `provides` and report
   *   what is missing or stale
   * - `'derive'`: emit a manifest whose `provides` is generated from them, so
   *   the declaration exists in one place only
   * - `false` (default): ignore them
   *
   * The loader reads the declarations at runtime anyway; this is for everything
   * that has to know them *before* a module is imported — load order,
   * satisfaction, and whether a set of modules is self-sufficient. In OSGi bnd
   * generates the descriptors for the same reason.
   *
   * Requires `manifest`.
   */
  components?: 'validate' | 'derive' | false

  /** File name for the emitted manifest with `components: 'derive'` */
  derivedManifestName?: string

  /**
   * Whether an import of an undeclared module fails the build.
   * Default: true. With `false` it is reported as a warning.
   *
   * A `dependencies` entry no import references is always a warning — it costs
   * a needless module load, it does not break anything.
   */
  strict?: boolean

  /**
   * Shared modules whose bare imports should also be transformed.
   * This is needed for Vue SFC support, where the compiler generates
   * bare imports like `import { openBlock } from 'vue'`.
   *
   * Example: ['vue', 'vue-router', 'primevue']
   *
   * Default: [] (only tsm: prefixed imports are transformed)
   */
  sharedModules?: string[]
}

/**
 * Convert import specifiers to valid destructuring syntax
 * Handles: "x", "x as y" -> proper destructuring with colon syntax
 * Filters out type imports (e.g., "type Ref", "type Ref as R")
 */
function convertImports(importList: string, moduleId: string): string {
  const specifiers = importList.split(',').map(s => s.trim()).filter(s => s)

  // Filter out inline type imports (e.g., "type Ref", "type Ref as R")
  const valueSpecifiers = specifiers.filter(s => !s.startsWith('type '))

  // If only type imports were present, return empty string
  if (valueSpecifiers.length === 0) return ''

  const destructured: string[] = []
  for (const spec of valueSpecifiers) {
    // Convert "foo as bar" to "foo: bar" for destructuring
    const converted = spec.replace(/^(\w+)\s+as\s+(\S+)$/, '$1: $2')
    destructured.push(converted)
  }
  return `const { ${destructured.join(', ')} } = __tsm__.require('${moduleId}');`
}

/**
 * Transform tsm: imports in code
 * @internal Exported for testing
 */
export function transformTsmImports(code: string, sharedModules: string[] = []): string | null {
  const hasTsmImports = code.includes(TSM_PREFIX)
  const hasSharedImports = sharedModules.some(m =>
    code.includes(`from '${m}'`) || code.includes(`from "${m}"`) ||
    code.includes(`from '${m}/`) || code.includes(`from "${m}/`)
  )

  if (!hasTsmImports && !hasSharedImports) return null

  let transformed = code

  // ============================================================
  // Transform tsm: prefixed imports
  // ============================================================

  // Remove: import type { ... } from 'tsm:module' (type-only imports)
  transformed = transformed.replace(
    /import\s+type\s*\{[^}]*\}\s*from\s*['"]tsm:[^'"]+['"]\s*;?/g,
    ''
  )

  // Transform: import { x, y as z } from 'tsm:module' or 'tsm:module/subpath'
  transformed = transformed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, imports, moduleId) => convertImports(imports, moduleId)
  )

  // Transform: import * as X from 'tsm:module'
  transformed = transformed.replace(
    /import\s*\*\s*as\s*(\w+)\s*from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, alias, moduleId) =>
      `const ${alias} = __tsm__.require('${moduleId}');`
  )

  // Transform: import X from 'tsm:module'
  transformed = transformed.replace(
    /import\s+(\w+)\s+from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, name, moduleId) =>
      `const ${name} = __tsm__.require('${moduleId}').default;`
  )

  // ============================================================
  // Transform bare imports from shared modules (for SFC support)
  // ============================================================

  for (const moduleId of sharedModules) {
    // Escape special regex characters in module name
    const escaped = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Remove: import type { ... } from 'module' (type-only imports)
    transformed = transformed.replace(
      new RegExp(`import\\s+type\\s*\\{[^}]*\\}\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      ''
    )

    // Transform: import { x, y as z } from 'module' or 'module/sub'
    transformed = transformed.replace(
      new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, imports, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return convertImports(imports, fullModule)
      }
    )

    // Transform: import * as X from 'module'
    transformed = transformed.replace(
      new RegExp(`import\\s*\\*\\s*as\\s*(\\w+)\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, alias, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return `const ${alias} = __tsm__.require('${fullModule}');`
      }
    )

    // Transform: import X from 'module'
    transformed = transformed.replace(
      new RegExp(`import\\s+(\\w+)\\s+from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, name, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return `const ${name} = __tsm__.require('${fullModule}').default;`
      }
    )
  }

  return transformed !== code ? transformed : null
}

/**
 * TSM Vite Plugin for development and production builds
 */
export function tsmPlugin(options: TsmPluginOptions = {}): Plugin {
  const {
    useRenderChunk = true,
    sharedModules = [],
    manifest,
    strict = true,
    components = false,
    derivedManifestName = 'manifest.json'
  } = options

  let validatable: ValidatableManifest | undefined
  /** Module IDs actually imported, collected across files for the unused check */
  const importedModuleIds = new Set<string>()
  /** Services declared by `@component()`, collected across files */
  const declaredServices = new Map<string, DeclaredService>()

  return {
    name: 'tsm-plugin',
    enforce: 'pre',

    async buildStart() {
      importedModuleIds.clear()
      declaredServices.clear()
      validatable = undefined

      if (manifest === undefined) return

      if (typeof manifest !== 'string') {
        validatable = manifest
        return
      }

      try {
        validatable = JSON.parse(await readFile(manifest, 'utf-8')) as ValidatableManifest
      } catch (error) {
        this.error(`tsm: cannot read manifest '${manifest}': ${(error as Error).message}`)
      }
    },

    // Mark tsm: imports and shared modules as external
    resolveId(source: string) {
      if (source.startsWith(TSM_PREFIX)) {
        return { id: source, external: true }
      }
      // Mark shared modules as external too
      for (const mod of sharedModules) {
        if (source === mod || source.startsWith(mod + '/')) {
          return { id: source, external: true }
        }
      }
      return null
    },

    // Validation lives here rather than in renderChunk: only a source file can
    // name the file and line a bad import sits on
    transform(code: string, id: string) {
      if (!id.match(/\.(ts|js|tsx|jsx|vue)$/)) return null
      if (id.includes('node_modules')) return null

      if (components !== false) {
        try {
          for (const found of extractComponents(code, specifier =>
            readImportedSource(specifier, id)
          )) {
            for (const service of found.services) {
              const known = declaredServices.get(service.id)
              if (known && JSON.stringify(known) !== JSON.stringify(service)) {
                // `provides` holds one entry per ID, so two components offering
                // the same ID differently cannot both be expressed there
                this.warn(
                  `tsm: '${service.id}' is declared differently by more than one ` +
                  `component; the manifest can only carry one of them`
                )
                continue
              }
              declaredServices.set(service.id, service)
            }
          }
        } catch (error) {
          if (error instanceof ComponentScanError) {
            this.error(`tsm: '${id}:${error.line}' ${error.message}`)
          }
          throw error
        }
      }

      if (validatable) {
        const declared = declaredIds(validatable)

        for (const reference of collectTsmImports(code)) {
          // A type-only import leaves no runtime trace, so it needs no dependency
          if (reference.typeOnly) continue

          importedModuleIds.add(reference.moduleId)
          if (isDeclared(reference, declared)) continue

          const message =
            `tsm: '${id}:${reference.line}' imports 'tsm:${reference.specifier}', ` +
            `but '${reference.moduleId}' is not declared in the manifest. ` +
            `Add it to dependencies, or to sharedDependencies if the host provides it.`

          if (strict) {
            this.error(message)
          } else {
            this.warn(message)
          }
        }
      }

      if (useRenderChunk) return null

      const transformed = transformTsmImports(code, sharedModules)
      return transformed ? { code: transformed, map: null } : null
    },

    // A declaration nothing imports keeps the resolver loading a module for no
    // reason — worth reporting, but not worth failing a build over
    buildEnd() {
      if (components === 'validate' && validatable) {
        const scanned = new Set(declaredServices.keys())
        const inManifest = new Set((validatable.provides ?? []).map(service => service.id))

        const missing = [...scanned].filter(id => !inManifest.has(id))
        const stale = [...inManifest].filter(id => !scanned.has(id))

        if (missing.length > 0) {
          const message =
            `tsm: component(s) declare service(s) the manifest does not list: ` +
            `${missing.join(', ')}. Add them to provides, or use components: 'derive'.`
          if (strict) this.error(message)
          else this.warn(message)
        }
        if (stale.length > 0) {
          // Not an error: a module may still register these imperatively
          this.warn(
            `tsm: manifest lists service(s) no component declares: ${stale.join(', ')}`
          )
        }
      }

      if (!validatable) return

      const unused = requiredDependencyIds(validatable).filter(
        dependencyId => !importedModuleIds.has(dependencyId)
      )

      if (unused.length > 0) {
        this.warn(
          `tsm: manifest declares dependencies that nothing imports: ${unused.join(', ')}`
        )
      }
    },

    // The generated manifest belongs to the build output, like a descriptor
    generateBundle() {
      if (components !== 'derive' || !validatable) return

      const provides = [...declaredServices.values()].map(service => ({
        id: service.id,
        ...(service.ranking === undefined ? {} : { ranking: service.ranking }),
        ...(service.properties === undefined ? {} : { properties: service.properties })
      }))

      this.emitFile({
        type: 'asset',
        fileName: derivedManifestName,
        source: `${JSON.stringify({ ...validatable, provides }, null, 2)}\n`
      })
    },

    // For production: transform final output
    renderChunk(code: string) {
      if (!useRenderChunk) return null

      const transformed = transformTsmImports(code, sharedModules)
      return transformed ? { code: transformed, map: null } : null
    }
  }
}

/**
 * Generate CSS loader code that injects a stylesheet link
 *
 * @param cssUrl - URL to the CSS file
 * @returns JavaScript code that injects the CSS
 */
/**
 * Read a module referenced by a relative import, so a service id held in a
 * constant there can be resolved. Synchronous because the scan is.
 */
function readImportedSource(specifier: string, importerId: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined

  const base = resolvePath(dirname(importerId), specifier)
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`]) {
    try {
      return readFileSync(candidate, 'utf-8')
    } catch {
      // Try the next spelling; TypeScript sources are imported with .js
    }
  }
  return undefined
}

export function generateCssLoader(cssUrl: string): string {
  return `(function(){` +
    `var l=document.createElement('link');` +
    `l.rel='stylesheet';` +
    `l.href='${cssUrl}';` +
    `document.head.appendChild(l);` +
    `})();`
}

export interface CreateExternalsOptions {
  /** Modules that provide libraries (won't externalize their deps) */
  libraryProviders?: string[]
  /** Additional packages to always externalize */
  alwaysExternal?: string[]
  /** Packages to externalize for non-library-providers */
  sharedPackages?: string[]
}

/**
 * Create external function for TSM module builds
 *
 * Library providers bundle shared libraries (Vue, UI frameworks, etc.)
 * Other modules mark them as external and load from library providers at runtime.
 *
 * @param moduleId - The ID of the module being built
 * @param options - Configuration options
 */
export function createTsmExternals(moduleId: string, options: CreateExternalsOptions = {}) {
  const {
    libraryProviders = [],
    alwaysExternal = ['vue', 'vue-router', 'tsm'],
    sharedPackages = ['primevue', '@primevue', 'primeicons']
  } = options

  const isLibraryProvider = libraryProviders.includes(moduleId)

  return (id: string): boolean => {
    // Always external packages
    for (const pkg of alwaysExternal) {
      if (id === pkg || id.startsWith(pkg + '/')) return true
    }

    // Library providers bundle everything else
    if (isLibraryProvider) {
      return false
    }

    // Other modules: shared packages are external
    for (const pkg of sharedPackages) {
      if (id === pkg || id.startsWith(pkg + '/') || id.startsWith(pkg)) return true
    }

    return false
  }
}
