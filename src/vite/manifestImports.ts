/**
 * TSM Vite Plugin - manifest validation
 *
 * Code and manifest are two sources of truth for what a module needs. The
 * transform already sees every `tsm:` import, so the mismatch can be caught at
 * build time instead of on activation.
 */

const TSM_IMPORT = /import\s+([\s\S]*?)\s*from\s*['"]tsm:([^'"]+)['"]|import\s*['"]tsm:([^'"]+)['"]/g

/** One `tsm:` import found in a source file */
export interface TsmImportRef {
  /** Everything after `tsm:`, e.g. "plugin-a" or "my-app/vue" */
  specifier: string
  /** The part before the first slash — the module ID a manifest declares */
  moduleId: string
  /** 1-based line in the source file */
  line: number
  /**
   * Whether the import leaves no runtime trace. Type-only imports are exempt:
   * that they vanish is what makes cross-module typing possible without
   * bundling, so they must not require a dependency.
   */
  typeOnly: boolean
}

/**
 * Whether an import clause disappears at runtime — `import type { … }`, or a
 * brace clause whose every specifier is inline `type`.
 */
function isTypeOnlyClause(clause: string | undefined): boolean {
  if (clause === undefined) return false

  const trimmed = clause.trim()
  if (trimmed.startsWith('type ') || trimmed.startsWith('type{')) return true

  const braces = trimmed.match(/^\{([\s\S]*)\}$/)
  if (!braces) return false

  const specifiers = braces[1].split(',').map(part => part.trim()).filter(part => part.length > 0)
  return specifiers.length > 0 && specifiers.every(specifier => specifier.startsWith('type '))
}

/** Find every `tsm:` import in a source file */
export function collectTsmImports(code: string): TsmImportRef[] {
  if (!code.includes('tsm:')) return []

  const found: TsmImportRef[] = []

  for (const match of code.matchAll(TSM_IMPORT)) {
    const specifier = match[2] ?? match[3]
    if (specifier === undefined) continue

    found.push({
      specifier,
      moduleId: specifier.split('/')[0],
      line: code.slice(0, match.index).split('\n').length,
      typeOnly: isTypeOnlyClause(match[1])
    })
  }

  return found
}

/** The parts of a manifest this validation needs */
export interface ValidatableManifest {
  id?: string
  dependencies?: Array<string | { id: string }>
  optionalDependencies?: Array<string | { id: string }>
  sharedDependencies?: Array<{ id: string }>
}

/**
 * IDs the manifest declares. `sharedDependencies` counts too, because the
 * `tsm:` scheme serves both module imports and host libraries.
 */
export function declaredIds(manifest: ValidatableManifest): Set<string> {
  const ids = new Set<string>()

  for (const dependency of [...(manifest.dependencies ?? []), ...(manifest.optionalDependencies ?? [])]) {
    ids.add(typeof dependency === 'string' ? dependency : dependency.id)
  }
  for (const shared of manifest.sharedDependencies ?? []) {
    ids.add(shared.id)
  }

  return ids
}

/** Module IDs the manifest lists under `dependencies` (not the optional ones) */
export function requiredDependencyIds(manifest: ValidatableManifest): string[] {
  return (manifest.dependencies ?? []).map(
    dependency => (typeof dependency === 'string' ? dependency : dependency.id)
  )
}

/**
 * Whether an import is covered by the manifest.
 *
 * Accepts the module ID, the full specifier, or its subpath: with
 * `tsm:my-app/vue` either the providing module or the library may be what the
 * manifest names, and rejecting one of those spellings would produce false
 * alarms rather than findings.
 */
export function isDeclared(reference: TsmImportRef, declared: Set<string>): boolean {
  if (declared.has(reference.moduleId)) return true
  if (declared.has(reference.specifier)) return true

  const slash = reference.specifier.indexOf('/')
  if (slash >= 0 && declared.has(reference.specifier.slice(slash + 1))) return true

  return false
}
