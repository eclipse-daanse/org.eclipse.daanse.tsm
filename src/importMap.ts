/**
 * TSM - TypeScript Module System
 * Import maps for shared libraries
 *
 * The standard answer to the question `__tsm__.require()` was invented for: every
 * module writes `import { ref } from 'vue'`, and the host decides where `vue`
 * comes from. No bundler trick, no global registry, no transform.
 *
 * What it does not answer is versions. An import map maps a name to a URL and
 * knows nothing about `^3.4.0`, so the checking has to happen before the map is
 * installed — which is what `generateImportMap` is for: it reads the manifests,
 * matches their `sharedDependencies` against what the host offers, and reports
 * what is missing or incompatible instead of letting it fail as a 404 later.
 */

import semver from 'semver'
import type { ModuleManifest } from './types.js'

/** What the host offers under a bare specifier */
export interface OfferedLibrary {
  /** Where it is served from — the value that lands in the import map */
  url: string

  /**
   * Which version this is. Given, it is matched against every module's declared
   * range; omitted, the range is taken on trust.
   */
  version?: string
}

/** An import map, as the browser reads it */
export interface ImportMap {
  imports: Record<string, string>

  /**
   * Per-importer overrides. Not generated: two instances of a library are two
   * reactivity systems, two class identities, two registries — which is what
   * sharing exists to avoid. Kept in the type because a host may add one
   * deliberately.
   */
  scopes?: Record<string, Record<string, string>>
}

export interface MissingLibrary {
  moduleId: string
  library: string
  versionRange: string
}

export interface IncompatibleLibrary extends MissingLibrary {
  offered: string
}

export interface ImportMapResult {
  importMap: ImportMap
  /** Libraries a module needs and the host does not offer */
  missing: MissingLibrary[]
  /** Libraries the host offers in a version no module's range accepts */
  incompatible: IncompatibleLibrary[]
}

/**
 * Build an import map for what these modules declare as shared.
 *
 * Only what is actually needed goes in: a library nobody asks for is left out, so
 * the map says what the set of modules requires rather than what the host happens
 * to have lying around.
 */
export function generateImportMap(
  manifests: ModuleManifest[],
  offered: Record<string, OfferedLibrary | string>
): ImportMapResult {
  const imports: Record<string, string> = {}
  const missing: MissingLibrary[] = []
  const incompatible: IncompatibleLibrary[] = []

  for (const manifest of manifests) {
    for (const dependency of manifest.sharedDependencies ?? []) {
      const entry = offered[dependency.id]

      if (entry === undefined) {
        missing.push({
          moduleId: manifest.id,
          library: dependency.id,
          versionRange: dependency.versionRange
        })
        continue
      }

      const library = typeof entry === 'string' ? { url: entry } : entry

      if (
        library.version !== undefined &&
        semver.validRange(dependency.versionRange) &&
        !semver.satisfies(library.version, dependency.versionRange, { includePrerelease: true })
      ) {
        incompatible.push({
          moduleId: manifest.id,
          library: dependency.id,
          versionRange: dependency.versionRange,
          offered: library.version
        })
        continue
      }

      imports[dependency.id] = library.url
    }
  }

  return { importMap: { imports }, missing, incompatible }
}

/**
 * The map as the script tag that belongs in the document.
 *
 * `</script>` inside a URL would end the tag early, so the sequence is escaped —
 * the same care any inline JSON needs.
 */
export function importMapScript(map: ImportMap): string {
  const json = JSON.stringify(map, null, 2).replace(/<\/script/gi, '<\\/script')
  return `<script type="importmap">\n${json}\n</script>`
}

/**
 * Install the map into the current document.
 *
 * **Only before the first module import.** A browser reads the import map once,
 * when it needs to resolve its first specifier; adding one afterwards has no
 * effect on what is already resolved, and older browsers reject a second map
 * outright. So this belongs in a classic script at the top of the page, before
 * any `<script type="module">` runs — or the map is written into the HTML and this
 * function is not needed at all.
 *
 * @returns false when a map is already present, in which case nothing is changed
 */
export function installImportMap(map: ImportMap, target: Document = document): boolean {
  if (target.querySelector('script[type="importmap"]') !== null) return false

  const script = target.createElement('script')
  script.type = 'importmap'
  // textContent, not innerHTML: the content is data, and nothing in it is markup
  script.textContent = JSON.stringify(map)
  target.head.appendChild(script)
  return true
}
