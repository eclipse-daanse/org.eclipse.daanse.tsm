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

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path'
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

  /**
   * What to do with the `dependencies` the `tsm:` imports imply.
   *
   * - `'validate'` (the default when a manifest is given): an import of an
   *   undeclared module fails the build, a declaration nothing imports warns
   * - `'derive'`: emit a manifest whose `dependencies` are the modules actually
   *   imported, so the declaration exists in one place only
   *
   * A `tsm:` import of a **shared library** is not a module dependency and is
   * left out: the module depends on the host providing it, which is what
   * `sharedDependencies` says.
   */
  dependencies?: 'validate' | 'derive'

  /**
   * File name for the emitted manifest with `components: 'derive'` or
   * `dependencies: 'derive'`. Both write the same file, so what they derive ends
   * up in one manifest rather than two that overwrite each other.
   */
  derivedManifestName?: string

  /**
   * Whether files from outside this bundle may be pulled into it.
   *
   * ES modules have no counterpart to a class loader: a relative path reaching
   * into another bundle's sources compiles, bundles, and runs — with that
   * bundle's code copied in, no entry in the manifest, and the whole service
   * layer bypassed. Nothing at runtime can tell, and the copy keeps working after
   * the other bundle is undeployed.
   *
   * The boundary is where the **manifest** is: a bundle is defined by its
   * manifest, so `dirname(manifest)` is the root unless `root` says otherwise.
   * Needs `manifest` to be a path; with a parsed object there is no directory to
   * take, and the check stays off unless `root` is given.
   *
   * Always allowed: anything under the root, and anything under `node_modules`
   * — an npm dependency is a declared dependency.
   *
   * @default enabled when the manifest is a path
   */
  boundary?: false | {
    /** The bundle's root. Defaults to the directory the manifest is in. */
    root?: string

    /**
     * Paths outside the root that may be imported anyway, as prefixes —
     * absolute, or relative to the root.
     *
     * The contract module belongs here: it sits outside every bundle on purpose,
     * and that is exactly why it has to be named rather than guessed. Anything
     * allowed here is code that ends up copied into this bundle, so the list
     * should stay short and each entry should be something without behaviour.
     */
    allow?: string[]
  }

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
    dependencies = 'validate',
    derivedManifestName = 'manifest.json',
    boundary
  } = options

  let validatable: ValidatableManifest | undefined
  /** Module IDs actually imported, collected across files for the unused check */
  const importedModuleIds = new Set<string>()
  /** Services declared by `@component()`, collected across files */
  const declaredServices = new Map<string, DeclaredService>()

  /**
   * Where this bundle ends, and what may come in from outside it.
   *
   * Resolved once: the manifest's directory is the root, because a bundle is
   * defined by its manifest. Without a manifest path and without an explicit
   * root there is nothing to measure against, and the check stays off rather
   * than guessing at the entry or the working directory.
   */
  const boundaryRoot = boundary === false
    ? undefined
    : boundary?.root ?? (typeof manifest === 'string' ? dirname(manifest) : undefined)

  const boundaryAllowed = (boundary === false ? [] : boundary?.allow ?? [])
    .map(entry => (isAbsolute(entry)
      ? entry
      : resolvePath(boundaryRoot ?? '.', entry)))

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
            if (!found.exported) {
              // The loader looks for components in the module's namespace, so an
              // unexported one is silently never registered
              const message =
                `tsm: '${id}:${found.line}' component ${found.name} is not exported, ` +
                `so the loader cannot find it`
              if (strict) this.error(message)
              else this.warn(message)
            }

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

          // Deriving means the manifest follows the code, so there is nothing to
          // hold the code against
          if (dependencies === 'derive') continue
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

      if (dependencies === 'derive') return

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
    generateBundle(_outputOptions, bundle) {
      // The boundary ES modules do not have. Checked here rather than in
      // `transform`, because only the finished chunk says what was actually
      // pulled in — and `getModuleInfo` can then name who pulled it
      if (boundaryRoot !== undefined) {
        // Always an error, unlike the other checks: an undeclared dependency
        // costs a needless load, but a file copied across a bundle boundary is
        // structurally wrong — there is no version of it that is merely untidy.
        // The place to say "this one is fine" is `boundary.allow`, where it is
        // written down rather than tolerated
        for (const crossing of crossesBoundary(bundle, boundaryRoot, boundaryAllowed)) {
          // Who reached across, which is the part an author can act on. Only the
          // importers from inside the bundle are worth naming: a chain of
          // outside files says nothing about what to change here
          const importers = (this.getModuleInfo(crossing.file)?.importers ?? [])
            .filter(importer => !importer.includes('node_modules'))
          const from = (file: string): string => relative(boundaryRoot, file)
          const by = importers.length > 0
            ? ` — imported by ${importers.map(from).join(', ')}`
            : ''
          this.error(
            `tsm: ${from(crossing.file)} is outside this bundle and its code was ` +
            `copied into ${crossing.chunk}${by}. ES modules have no class loader, so ` +
            `nothing at runtime can tell — and the copy keeps working after that ` +
            `bundle is undeployed. Consume it as a service, declare it as a ` +
            `sharedDependency, or list it in boundary.allow if it is a contract.`
          )
        }
      }

      // A package declared as shared but bundled anyway is a second instance of
      // it, and nothing at runtime can tell: validateSharedDependencies only asks
      // whether the *host* has the library, not whether the module uses it
      for (const problem of bundledSharedLibraries(validatable, bundle)) {
        const report = strict ? this.error.bind(this) : this.warn.bind(this)
        report(
          `tsm: '${problem.library}' is declared in sharedDependencies but its code ` +
          `is bundled into ${problem.fileName} (${problem.evidence}). ` +
          `That gives the module its own copy instead of the host's. ` +
          `Pass the manifest to createTsmExternals() so the two agree.`
        )
      }

      if (!validatable) return

      // One file, however many things are derived: two emits under the same name
      // would silently overwrite each other
      const derived: Record<string, unknown> = { ...validatable }

      if (components === 'derive') {
        derived.provides = [...declaredServices.values()].map(service => ({
          id: service.id,
          ...(service.ranking === undefined ? {} : { ranking: service.ranking }),
          ...(service.properties === undefined ? {} : { properties: service.properties })
        }))
      }

      if (dependencies === 'derive') {
        // A tsm: import of a shared library is not a module dependency: the
        // module depends on the host providing it, which sharedDependencies says
        const shared = new Set(
          (validatable.sharedDependencies ?? []).map(dependency => dependency.id)
        )
        derived.dependencies = [...importedModuleIds]
          .filter(moduleId => !shared.has(moduleId))
          .sort()
      }

      if (components !== 'derive' && dependencies !== 'derive') return

      this.emitFile({
        type: 'asset',
        fileName: derivedManifestName,
        source: `${JSON.stringify(derived, null, 2)}\n`
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
 * Read a module an import points at, so a service id held in a constant there
 * can be resolved.
 *
 * Both kinds of specifier, because a service contract belongs in a package of
 * its own — the API bundle — and `@component({ service: [WIDGET_SERVICE] })` is
 * exactly where that constant is needed. Reading only relative imports left every
 * such declaration falling back to a repeated literal.
 *
 * Synchronous because the scan is, which rules out the bundler's own resolver.
 * `import.meta.resolve` is the synchronous one that still honours `exports` and
 * its conditions — and the `import` condition is what points at the sources in a
 * workspace, where a package's `main` is often the TypeScript file itself.
 */
function readImportedSource(specifier: string, importerId: string): string | undefined {
  const candidates = specifier.startsWith('.')
    ? relativeCandidates(specifier, importerId)
    : packageCandidates(specifier, importerId)

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf-8')
    } catch {
      // Try the next spelling; TypeScript sources are imported with .js
    }
  }
  return undefined
}

function relativeCandidates(specifier: string, importerId: string): string[] {
  const base = resolvePath(dirname(importerId), specifier)
  return [base, base.replace(/\.js$/, '.ts'), `${base}.ts`]
}

/**
 * Where a package specifier lands, and the spellings worth trying next to it.
 *
 * `node_modules` is walked by hand rather than through a resolver, because the
 * scan is synchronous: the bundler's own resolver is async, and
 * `import.meta.resolve` — the synchronous one — is not there under Vite, which is
 * where this runs.
 *
 * The `types` condition is tried first on purpose. In a workspace an API package
 * usually points every condition at its TypeScript source, and where it does not,
 * `types` is still the entry that exists before anything is built. What the scan
 * needs is the *value* of a constant, so built output is only useful if it is
 * actually there, and a `.d.ts` never carries it at all.
 */
function packageCandidates(specifier: string, importerId: string): string[] {
  const parts = specifier.split('/')
  // A scoped package takes two segments; a deep import keeps the rest as a path
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const subpath = specifier.slice(name.length).replace(/^\//, '')

  const directory = packageDirectory(name, importerId)
  if (directory === undefined) return []

  if (subpath !== '') {
    const target = resolvePath(directory, subpath)
    return [target, target.replace(/\.js$/, '.ts'), `${target}.ts`]
  }

  let manifest: { main?: string; module?: string; types?: string; exports?: unknown }
  try {
    manifest = JSON.parse(readFileSync(resolvePath(directory, 'package.json'), 'utf-8'))
  } catch {
    return []
  }

  const entries = [
    ...exportedEntries(manifest.exports),
    manifest.types,
    manifest.module,
    manifest.main,
    'index.ts',
    'index.js'
  ].filter((entry): entry is string => typeof entry === 'string')

  const candidates: string[] = []
  for (const entry of entries) {
    const target = resolvePath(directory, entry)
    candidates.push(target)
    // Built output is no use when it is not built yet, and a .d.ts has no value
    // in it — the matching source is what the scan is after
    const source = target
      .replace(/([/\\])(dist|lib|build|out)([/\\])/, '$1src$3')
      .replace(/\.d\.ts$/, '.ts')
      .replace(/\.js$/, '.ts')
    if (source !== target) candidates.push(source)
  }

  return candidates
}

/** The `.` entry of an `exports` map, by the conditions worth trying */
function exportedEntries(exported: unknown): string[] {
  if (typeof exported === 'string') return [exported]
  if (typeof exported !== 'object' || exported === null) return []

  const map = exported as Record<string, unknown>
  const root = '.' in map ? map['.'] : map

  if (typeof root === 'string') return [root]
  if (typeof root !== 'object' || root === null) return []

  const conditions = root as Record<string, unknown>
  return ['types', 'import', 'module', 'default', 'require']
    .map(condition => conditions[condition])
    .filter((entry): entry is string => typeof entry === 'string')
}

/**
 * The directory a package name resolves to, walking up from the importer as
 * Node does.
 */
function packageDirectory(name: string, importerId: string): string | undefined {
  let at = dirname(importerId)

  for (;;) {
    const candidate = resolvePath(at, 'node_modules', name)
    if (existsSync(resolvePath(candidate, 'package.json'))) return candidate

    const up = dirname(at)
    if (up === at) return undefined
    at = up
  }
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
  /**
   * Modules that provide libraries (won't externalize their deps).
   *
   * @deprecated Only consulted when a module id is passed instead of a manifest.
   *   A manifest says it already: a provider does not list what it provides in
   *   its own `sharedDependencies`, so it bundles it.
   */
  libraryProviders?: string[]

  /**
   * Packages to externalize **in addition** to the manifest's
   * `sharedDependencies` and to tsm itself.
   *
   * For the transitive ones a module never imports by name but a bundler may pull
   * in anyway: with `vue` shared, `@vue/runtime-core` is the same library under
   * another package name, and bundling it would produce the second instance that
   * sharing exists to avoid. A scope prefix covers its packages:
   * `['@vue', '@primevue']`.
   *
   * (With a module id instead of a manifest this replaces the default list, as
   * it did before.)
   */
  alwaysExternal?: string[]

  /**
   * Packages to externalize for non-library-providers.
   *
   * @deprecated Only consulted when a module id is passed instead of a manifest.
   */
  sharedPackages?: string[]
}

/**
 * Shared libraries whose code ended up inside the bundle.
 *
 * The evidence is a module path under `node_modules/<library>/`: if the package
 * had been external, no file of it would be in a chunk at all.
 */
/**
 * Files a chunk pulled in from outside the bundle.
 *
 * Anything under the root belongs here; anything under `node_modules` is a
 * declared npm dependency and so does an allowed path. What is left is a file
 * from somewhere else in the tree — in a monorepo, usually another bundle's
 * sources, reached by a relative path that no manifest mentions.
 *
 * Virtual modules (`\0`-prefixed, `virtual:`) are left alone: they have no place
 * on disk to compare, and they come from plugins rather than from an author.
 */
function crossesBoundary(
  bundle: Record<string, { type: string; modules?: Record<string, unknown> }>,
  root: string,
  allowed: readonly string[]
): Array<{ file: string; chunk: string; importers: string[] }> {
  const crossings: Array<{ file: string; chunk: string; importers: string[] }> = []
  const seen = new Set<string>()

  const inside = (file: string, directory: string): boolean => {
    const relation = relative(directory, file)
    return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation)
  }

  for (const [chunkName, chunk] of Object.entries(bundle)) {
    if (chunk.type !== 'chunk' || !chunk.modules) continue

    for (const file of Object.keys(chunk.modules)) {
      if (seen.has(file)) continue
      if (file.startsWith('\0') || file.includes('virtual:')) continue
      if (!isAbsolute(file)) continue
      if (file.includes('node_modules')) continue
      if (inside(file, root)) continue
      if (allowed.some(entry => file === entry || inside(file, entry))) continue

      seen.add(file)
      crossings.push({ file, chunk: chunkName, importers: [] })
    }
  }

  return crossings
}

function bundledSharedLibraries(
  manifest: ValidatableManifest | undefined,
  bundle: Record<string, { type: string; modules?: Record<string, unknown> }>
): Array<{ library: string; fileName: string; evidence: string }> {
  const shared = (manifest?.sharedDependencies ?? []).map(dependency => dependency.id)
  if (shared.length === 0) return []

  const found: Array<{ library: string; fileName: string; evidence: string }> = []

  for (const [fileName, chunk] of Object.entries(bundle)) {
    if (chunk.type !== 'chunk' || !chunk.modules) continue

    for (const library of shared) {
      // Both separators, so a Windows build reports the same thing
      const needles = [`node_modules/${library}/`, `node_modules\\${library}\\`]
      const hit = Object.keys(chunk.modules).find(
        moduleId => needles.some(needle => moduleId.includes(needle))
      )
      if (hit === undefined) continue

      found.push({ library, fileName, evidence: shorten(hit) })
    }
  }

  return found
}

/** Enough of a path to recognise, without the machine it was built on */
function shorten(moduleId: string): string {
  const index = moduleId.lastIndexOf('node_modules')
  return index < 0 ? moduleId : moduleId.slice(index)
}

/** The packages a module never bundles: the host always supplies tsm itself */
const ALWAYS_EXTERNAL = ['tsm', '@eclipse-daanse/tsm']

/**
 * Which packages a module build must not bundle.
 *
 * Pass the **manifest**: what it declares as `sharedDependencies` is external,
 * everything else is bundled. That way the declaration the loader validates and
 * the build that has to honour it are the same sentence — a package declared as
 * shared but bundled anyway yields a second instance, and nothing at runtime can
 * detect it. `tsmPlugin({ manifest })` fails the build over exactly that.
 *
 * ```ts
 * import manifest from './manifest.json'
 * export default defineConfig({
 *   build: { rollupOptions: { external: createTsmExternals(manifest) } },
 *   plugins: [tsmPlugin({ manifest })]
 * })
 * ```
 *
 * @param source The manifest, or — for the older arrangement — a module id, in
 *   which case `libraryProviders` and `sharedPackages` decide as before.
 */
export function createTsmExternals(
  source: string | ValidatableManifest,
  options: CreateExternalsOptions = {}
) {
  /** `vue` also covers `vue/dist/…`, `@scope/pkg` also `@scope/pkg/sub` */
  const covers = (packageName: string, id: string): boolean =>
    id === packageName || id.startsWith(`${packageName}/`)

  if (typeof source !== 'string') {
    // Additive, not replacing: tsm itself must stay external whatever else is
    // listed, and forgetting to repeat it would be a silent trap
    const external = [
      ...(source.sharedDependencies ?? []).map(dependency => dependency.id),
      ...ALWAYS_EXTERNAL,
      ...(options.alwaysExternal ?? [])
    ]
    return (id: string): boolean => external.some(packageName => covers(packageName, id))
  }

  // Older arrangement: the module id decides, from lists kept here
  const {
    libraryProviders = [],
    alwaysExternal = ['vue', 'vue-router', 'tsm'],
    sharedPackages = ['primevue', '@primevue', 'primeicons']
  } = options
  const isLibraryProvider = libraryProviders.includes(source)

  return (id: string): boolean => {
    if (alwaysExternal.some(packageName => covers(packageName, id))) return true

    // Library providers bundle everything else
    if (isLibraryProvider) return false

    return sharedPackages.some(
      packageName => covers(packageName, id) || id.startsWith(packageName)
    )
  }
}
