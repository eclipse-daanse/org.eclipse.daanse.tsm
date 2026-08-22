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
 * matches their `sharedDependencies` against what is on offer, and reports what
 * is missing or incompatible instead of letting it fail as a 404 later.
 *
 * What is on offer comes from two places: the host, and **library bundles** —
 * modules whose contribution is a package rather than a service, declared with a
 * `tsm.library` capability. The consumer cannot tell the difference, which is the
 * point: `import { project } from 'geo'` says nothing about who supplies it.
 */

import semver from 'semver'
import { LIBRARY_NAMESPACE } from './capabilities.js'
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
  /** Libraries a module needs and nothing offers */
  missing: MissingLibrary[]
  /** Libraries offered in a version no module's range accepts */
  incompatible: IncompatibleLibrary[]
  /**
   * Libraries the host and a module both offer.
   *
   * The host wins — it is the outer environment, and a module cannot know what
   * else was built against the host's copy. Reported all the same, because it
   * usually means a library bundle was deployed that nobody needed.
   */
  shadowed: ShadowedLibrary[]
}

/** A library a module offers that the host also offers */
export interface ShadowedLibrary {
  library: string
  /** The module whose offer is unused */
  moduleId: string
  moduleVersion?: string
  /** What the host offers instead */
  hostVersion?: string
}

/**
 * The libraries the modules themselves offer, from their `tsm.library`
 * capabilities.
 *
 * A **library bundle**: a module whose contribution is a package rather than a
 * service. It declares what it provides and where it is served from, and a
 * consumer imports it by its bare name like any other dependency — so the same
 * mechanism covers "the host supplies Vue" and "this bundle supplies our geometry
 * helpers", which is what a package-exporting bundle is in OSGi.
 *
 * Such a module is never *activated*: it has no components and no services, so
 * there is nothing to start. The browser fetches it through the map when someone
 * imports it, which is exactly how an API bundle that is never started behaves.
 */
export function offeredByModules(
  manifests: readonly ModuleManifest[]
): Record<string, OfferedLibrary & { moduleId: string }> {
  const offered: Record<string, OfferedLibrary & { moduleId: string }> = {}

  for (const manifest of manifests) {
    for (const capability of manifest.capabilities ?? []) {
      if (capability.namespace !== LIBRARY_NAMESPACE) continue

      const library = capability.attributes?.library
      if (typeof library !== 'string') continue

      const version = capability.attributes?.version
      offered[library] = {
        // The module's own entry is where the package lives: a library bundle is
        // the package, so there is nothing else it could point at
        url: manifest.entry,
        version: typeof version === 'string' ? version : undefined,
        moduleId: manifest.id
      }
    }
  }

  return offered
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
  offered: Record<string, OfferedLibrary | string> = {}
): ImportMapResult {
  const imports: Record<string, string> = {}
  const missing: MissingLibrary[] = []
  const incompatible: IncompatibleLibrary[] = []
  const shadowed: ShadowedLibrary[] = []

  // A library bundle offers a package the same way the host does; the host wins
  // where both do, and the unused offer is reported rather than dropped in silence
  const fromModules = offeredByModules(manifests)

  for (const [library, entry] of Object.entries(fromModules)) {
    if (offered[library] === undefined) continue

    const host = offered[library]
    shadowed.push({
      library,
      moduleId: entry.moduleId,
      moduleVersion: entry.version,
      hostVersion: typeof host === 'string' ? undefined : host.version
    })
  }

  for (const manifest of manifests) {
    for (const dependency of manifest.sharedDependencies ?? []) {
      const entry = offered[dependency.id] ?? fromModules[dependency.id]

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

  return { importMap: { imports }, missing, incompatible, shadowed }
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
