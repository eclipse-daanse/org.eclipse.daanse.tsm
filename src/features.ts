/**
 * TSM - TypeScript Module System
 * Features — a set of modules and their configuration as one deployable thing
 *
 * OSGi's Feature Service (Compendium 159). What it specifies is a *document
 * format* and an API to read and write it, deliberately not how a feature is
 * installed: that is a "launcher's" business, and the specification says so.
 *
 * The problem it solves is the one that appears once an application has more
 * than a handful of modules: the list of what to load, in which version, with
 * which configuration, stops fitting in someone's head and starts living in host
 * code. A feature moves it into a document that a person can read and a tool can
 * process — and that can be versioned, reviewed and shipped.
 *
 * Two departures from the specification, both because the identifier model is
 * Maven's and tsm's is npm's:
 *
 * An id is `name@version` (or `@scope/name@version`), not
 * `groupId:artifactId:type:classifier:version`. tsm modules are npm packages;
 * inventing a group id for them would be a field nobody could fill in truthfully.
 *
 * The `configurations` key follows Configuration Admin directly rather than
 * through the Configurator (Compendium 150), which tsm does not have. The typed
 * key syntax `"port:Integer"` is supported, because variable substitution needs
 * it — a `${...}` placeholder always produces a string.
 */

import type { ConfigurationProperties, ServicePropertyValue } from './types.js'

/** Service ID the loader publishes the feature service under */
export const FEATURE_SERVICE_ID = 'tsm.feature.service'

/** The implementation name for the feature service (Common Namespaces 135.4) */
export const FEATURE_IMPLEMENTATION = 'osgi.feature'

/** The version of the Feature specification this follows */
export const FEATURE_VERSION = '1.0.0'

/**
 * The version of the document format, as `feature-resource-version`.
 *
 * Read but not required: a document without it is taken as 1.0, since that is
 * the only version there is.
 */
export const FEATURE_RESOURCE_VERSION = '1.0'

/**
 * What a feature refers to: a module and a version.
 *
 * Kept as a parsed pair rather than a string, so a launcher does not have to
 * re-parse to compare versions.
 */
export interface FeatureId {
  /** Package name, `@scope/name` included */
  name: string
  version: string
}

/** One module a feature lists, with whatever metadata came with it */
export interface FeatureBundle {
  id: FeatureId

  /**
   * Custom metadata, as the specification allows on a bundle entry (159.4.1).
   *
   * Reverse-DNS keys by convention; unprefixed keys are reserved for OSGi. Only
   * strings, numbers and booleans, which is what the specification permits.
   */
  metadata?: Readonly<Record<string, string | number | boolean>>
}

/** How an entity that cannot handle an extension should treat it (159.7) */
export type ExtensionKind = 'mandatory' | 'optional' | 'transient'

/**
 * Custom content carried with a feature.
 *
 * The reason a feature can be the single artifact for a deployment: whatever else
 * belongs to it — a migration script, a licence text, a tool's own metadata —
 * travels with it instead of beside it.
 */
export type FeatureExtension =
  | { type: 'text'; kind: ExtensionKind; text: readonly string[] }
  | { type: 'json'; kind: ExtensionKind; json: unknown }
  | { type: 'artifacts'; kind: ExtensionKind; artifacts: readonly FeatureBundle[] }

/**
 * A feature: modules, configuration and custom content under one versioned id.
 *
 * Immutable once read, as the specification requires — the objects handed out are
 * frozen, so a launcher cannot change what it was given and a second consumer
 * sees the same thing.
 */
export interface Feature {
  id: FeatureId

  name?: string
  description?: string
  /** User-defined; empty when the document named none */
  categories: readonly string[]
  /**
   * Whether the feature has no external dependencies.
   *
   * A claim by the author, not a fact the reader checks — `resolveWiring()` is
   * what checks it, and {@link isComplete} is the check.
   */
  complete: boolean
  docURL?: string
  license?: string
  scm?: string
  vendor?: string

  bundles: readonly FeatureBundle[]

  /**
   * Configuration by PID, ready for Configuration Admin. A factory
   * configuration uses the `factoryPid~name` form, as everywhere else in tsm.
   */
  configurations: Readonly<Record<string, ConfigurationProperties>>

  /**
   * Late-bound values. `null` means the launcher has to supply one, which is the
   * specification's way of declaring a value that must not be defaulted — a
   * password, a host name.
   */
  variables: Readonly<Record<string, string | number | boolean | null>>

  extensions: Readonly<Record<string, FeatureExtension>>
}

/**
 * Strip JSMin comments, which the specification permits in a feature (159.3).
 *
 * `JSON.parse` rejects them, so this runs first. String contents are left alone —
 * a URL in a configuration value contains `//`, and treating that as a comment
 * would quietly truncate it.
 */
export function stripComments(text: string): string {
  let out = ''
  let at = 0

  while (at < text.length) {
    const char = text[at]

    if (char === '"') {
      // Copy the string verbatim, escapes included, so nothing inside it is read
      // as syntax
      out += char
      at++
      while (at < text.length) {
        out += text[at]
        if (text[at] === '\\') {
          out += text[at + 1] ?? ''
          at += 2
          continue
        }
        if (text[at] === '"') { at++; break }
        at++
      }
      continue
    }

    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at++
      continue
    }

    if (char === '/' && text[at + 1] === '*') {
      at += 2
      while (at < text.length && !(text[at] === '*' && text[at + 1] === '/')) at++
      at += 2
      continue
    }

    out += char
    at++
  }

  return out
}

/**
 * Parse `name@version`, `@scope/name@version` or a bare name.
 *
 * The scoped form is why this is not a `split('@')`: the leading `@` of a scope
 * is part of the name.
 */
export function parseFeatureId(id: string): FeatureId {
  const at = id.lastIndexOf('@')

  if (at <= 0) {
    throw new Error(`Feature id '${id}' has no version — expected 'name@version'`)
  }

  const name = id.slice(0, at)
  const version = id.slice(at + 1)

  if (name.length === 0 || version.length === 0) {
    throw new Error(`Feature id '${id}' has an empty name or version`)
  }

  return { name, version }
}

/** The inverse of {@link parseFeatureId} */
export function formatFeatureId(id: FeatureId): string {
  return `${id.name}@${id.version}`
}

/**
 * The types a configuration key may declare, as the Configurator does with
 * `"port:Integer"`.
 *
 * Only the scalars: a placeholder always yields a string, and these are what it
 * has to be turned back into. The Configurator's collection and array forms have
 * no counterpart here, and a key asking for one is reported rather than guessed
 * at.
 */
const CONVERSIONS: Record<string, (raw: string) => ServicePropertyValue> = {
  String: raw => raw,
  Integer: raw => Number.parseInt(raw, 10),
  Long: raw => Number.parseInt(raw, 10),
  Float: raw => Number.parseFloat(raw),
  Double: raw => Number.parseFloat(raw),
  Boolean: raw => raw === 'true'
}

/**
 * Replace `${name}` in a value with what the variables say.
 *
 * A name nothing provides is **left as it is**, which the specification requires
 * (159.6): a launcher further along may know it, and silently emptying it would
 * turn a missing value into a wrong one.
 */
function substitute(
  value: string,
  variables: Readonly<Record<string, string | number | boolean | null>>
): string {
  return value.replace(/\$\{([^}]*)\}/g, (whole, name: string) => {
    const replacement = variables[name]
    return replacement === undefined || replacement === null ? whole : String(replacement)
  })
}

/**
 * Apply a feature's variables to its configurations, and convert typed keys.
 *
 * Returns configurations a Configuration Admin can take as they are. Kept apart
 * from reading so a launcher can supply its own values first — which is the whole
 * point of a variable.
 */
export function resolveConfigurations(
  feature: Feature,
  supplied: Readonly<Record<string, string | number | boolean>> = {}
): Record<string, ConfigurationProperties> {
  const variables = { ...feature.variables, ...supplied }
  const resolved: Record<string, ConfigurationProperties> = {}

  for (const [pid, properties] of Object.entries(feature.configurations)) {
    const values: ConfigurationProperties = {}

    for (const [key, value] of Object.entries(properties)) {
      const colon = key.lastIndexOf(':')
      const declaredType = colon > 0 ? key.slice(colon + 1) : undefined
      const convert = declaredType === undefined ? undefined : CONVERSIONS[declaredType]

      // A type nobody knows is not a type: the key keeps its colon, because
      // guessing would put a value under a name the component never declared
      const name = convert === undefined ? key : key.slice(0, colon)
      const substituted = typeof value === 'string' ? substitute(value, variables) : value

      values[name] = convert !== undefined && typeof substituted === 'string'
        ? convert(substituted)
        : substituted
    }

    resolved[pid] = values
  }

  return resolved
}

/** Which variables have no value — neither a default nor one supplied */
export function missingVariables(
  feature: Feature,
  supplied: Readonly<Record<string, string | number | boolean>> = {}
): string[] {
  return Object.entries(feature.variables)
    .filter(([name, value]) => value === null && supplied[name] === undefined)
    .map(([name]) => name)
}

/**
 * Read a feature from a JSON document.
 *
 * Strict about what identifies the feature and lax about the rest: an unknown key
 * is kept out of the way rather than rejected, because a feature is meant to
 * carry other people's content.
 */
export function readFeature(document: string | object): Feature {
  const raw = (typeof document === 'string'
    ? JSON.parse(stripComments(document))
    : document) as Record<string, unknown>

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('A feature document has to be a JSON object')
  }

  if (typeof raw.id !== 'string') {
    throw new Error('A feature needs an "id" of the form "name@version"')
  }

  const version = raw['feature-resource-version']
  if (version !== undefined && version !== FEATURE_RESOURCE_VERSION) {
    throw new Error(
      `Unsupported feature-resource-version '${String(version)}' — ` +
      `this reads ${FEATURE_RESOURCE_VERSION}`
    )
  }

  return Object.freeze({
    id: parseFeatureId(raw.id),
    name: optionalString(raw.name, 'name'),
    description: optionalString(raw.description, 'description'),
    categories: Object.freeze(readCategories(raw.categories)),
    complete: raw.complete === true,
    docURL: optionalString(raw.docURL, 'docURL'),
    license: optionalString(raw.license, 'license'),
    scm: optionalString(raw.scm, 'scm'),
    vendor: optionalString(raw.vendor, 'vendor'),
    bundles: Object.freeze(readBundles(raw.bundles)),
    configurations: Object.freeze(readConfigurations(raw.configurations)),
    variables: Object.freeze(readVariables(raw.variables)),
    extensions: Object.freeze(readExtensions(raw.extensions))
  })
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Feature "${key}" has to be a string`)
  return value
}

function readCategories(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error('Feature "categories" has to be an array of strings')
  }
  return [...value] as string[]
}

function readBundles(value: unknown): FeatureBundle[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Feature "bundles" has to be an array')

  return value.map(entry => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Every entry in "bundles" has to be an object with an "id"')
    }

    const { id, ...rest } = entry as Record<string, unknown>
    if (typeof id !== 'string') {
      throw new Error('Every entry in "bundles" needs a string "id"')
    }

    const metadata: Record<string, string | number | boolean> = {}
    for (const [key, own] of Object.entries(rest)) {
      if (typeof own !== 'string' && typeof own !== 'number' && typeof own !== 'boolean') {
        throw new Error(
          `Bundle metadata '${key}' of '${id}' is a ${typeof own}; ` +
          `only strings, numbers and booleans are allowed`
        )
      }
      metadata[key] = own
    }

    return Object.freeze({
      id: parseFeatureId(id),
      ...(Object.keys(metadata).length > 0 ? { metadata: Object.freeze(metadata) } : {})
    })
  })
}

function readConfigurations(value: unknown): Record<string, ConfigurationProperties> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Feature "configurations" has to be an object keyed by PID')
  }

  const configurations: Record<string, ConfigurationProperties> = {}
  for (const [pid, properties] of Object.entries(value)) {
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      throw new Error(`Configuration '${pid}' has to be an object of properties`)
    }
    configurations[pid] = Object.freeze({ ...properties }) as ConfigurationProperties
  }
  return configurations
}

function readVariables(value: unknown): Record<string, string | number | boolean | null> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Feature "variables" has to be an object')
  }

  const variables: Record<string, string | number | boolean | null> = {}
  for (const [name, own] of Object.entries(value)) {
    if (own !== null && typeof own !== 'string' && typeof own !== 'number' &&
        typeof own !== 'boolean') {
      throw new Error(
        `Variable '${name}' is a ${typeof own}; a default has to be a string, ` +
        `a number, a boolean, or null for "the launcher must supply this"`
      )
    }
    variables[name] = own
  }
  return variables
}

function readExtensions(value: unknown): Record<string, FeatureExtension> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Feature "extensions" has to be an object')
  }

  const extensions: Record<string, FeatureExtension> = {}

  for (const [name, own] of Object.entries(value)) {
    if (typeof own !== 'object' || own === null) {
      throw new Error(`Extension '${name}' has to be an object`)
    }

    const entry = own as Record<string, unknown>
    const kind = readKind(entry.kind, name)

    switch (entry.type) {
      case 'text':
        if (!Array.isArray(entry.text) || entry.text.some(line => typeof line !== 'string')) {
          throw new Error(`Text extension '${name}' needs a "text" array of strings`)
        }
        extensions[name] = Object.freeze({
          type: 'text', kind, text: Object.freeze([...entry.text] as string[])
        })
        break

      case 'json':
        if (!('json' in entry)) {
          throw new Error(`JSON extension '${name}' needs a "json" value`)
        }
        extensions[name] = Object.freeze({ type: 'json', kind, json: entry.json })
        break

      case 'artifacts':
        extensions[name] = Object.freeze({
          type: 'artifacts', kind,
          artifacts: Object.freeze(readBundles(entry.artifacts))
        })
        break

      default:
        throw new Error(
          `Extension '${name}' has type '${String(entry.type)}'; ` +
          `expected 'text', 'json' or 'artifacts'`
        )
    }
  }

  return extensions
}

function readKind(value: unknown, name: string): ExtensionKind {
  if (value === undefined) return 'optional'
  if (value !== 'mandatory' && value !== 'optional' && value !== 'transient') {
    throw new Error(
      `Extension '${name}' has kind '${String(value)}'; ` +
      `expected 'mandatory', 'optional' or 'transient'`
    )
  }
  return value
}

/**
 * Write a feature back as a JSON document.
 *
 * Round-trips: reading what this produces gives the same feature. Empty
 * collections are left out, so a document does not grow keys it never had.
 */
export function writeFeature(feature: Feature, options: { indent?: number } = {}): string {
  const document: Record<string, unknown> = {
    'feature-resource-version': FEATURE_RESOURCE_VERSION,
    id: formatFeatureId(feature.id)
  }

  if (feature.name !== undefined) document.name = feature.name
  if (feature.description !== undefined) document.description = feature.description
  if (feature.categories.length > 0) document.categories = [...feature.categories]
  if (feature.complete) document.complete = true
  if (feature.docURL !== undefined) document.docURL = feature.docURL
  if (feature.license !== undefined) document.license = feature.license
  if (feature.scm !== undefined) document.scm = feature.scm
  if (feature.vendor !== undefined) document.vendor = feature.vendor

  if (feature.bundles.length > 0) {
    document.bundles = feature.bundles.map(bundle => ({
      id: formatFeatureId(bundle.id),
      ...bundle.metadata
    }))
  }

  if (Object.keys(feature.configurations).length > 0) {
    document.configurations = feature.configurations
  }
  if (Object.keys(feature.variables).length > 0) {
    document.variables = feature.variables
  }
  if (Object.keys(feature.extensions).length > 0) {
    document.extensions = feature.extensions
  }

  return JSON.stringify(document, undefined, options.indent ?? 2)
}

/** What is wrong with a feature, as far as the document alone can tell */
export interface FeatureProblem {
  /** Where it is: `bundles[2]`, `variables.db.password`, `extensions.acme.ddl` */
  at: string
  problem: string
}

/**
 * Check a feature against itself.
 *
 * Only what the document can answer: a repeated module, a variable nobody can
 * supply, a mandatory extension. Whether the modules actually resolve is
 * `resolveWiring()`'s question, and needs their manifests.
 */
export function validateFeature(
  feature: Feature,
  options: {
    supplied?: Readonly<Record<string, string | number | boolean>>
    /** Extension names this consumer can handle, for the mandatory check */
    handles?: readonly string[]
  } = {}
): FeatureProblem[] {
  const problems: FeatureProblem[] = []

  // The same module twice is a contradiction rather than a merge: nothing could
  // say which version wins, and the specification allows several versions of one
  // bundle only deliberately — which the *same* version twice cannot be
  const seen = new Map<string, number>()
  feature.bundles.forEach((bundle, at) => {
    const key = formatFeatureId(bundle.id)
    const first = seen.get(key)
    if (first !== undefined) {
      problems.push({ at: `bundles[${at}]`, problem: `'${key}' is already listed at ${first}` })
    } else {
      seen.set(key, at)
    }
  })

  for (const name of missingVariables(feature, options.supplied)) {
    problems.push({
      at: `variables.${name}`,
      problem: 'declared without a default, so a value has to be supplied'
    })
  }

  const handles = new Set(options.handles ?? [])
  for (const [name, extension] of Object.entries(feature.extensions)) {
    if (extension.kind === 'mandatory' && !handles.has(name)) {
      problems.push({
        at: `extensions.${name}`,
        problem: 'is mandatory, and this consumer does not handle it'
      })
    }
  }

  return problems
}

/**
 * Reading, writing and checking features — OSGi's `FeatureService` (159.11).
 *
 * A service rather than only functions, for the reason SCR's runtime is one: a
 * module that builds or inspects features should not have to import the host's
 * package.
 *
 * The specification's builder API is left out on purpose. Builders exist there
 * because a `Feature` is an immutable Java object with a dozen fields; here an
 * object literal *is* the builder, and it type-checks.
 */
export interface FeatureService {
  readFeature(document: string | object): Feature
  writeFeature(feature: Feature, options?: { indent?: number }): string

  validateFeature(
    feature: Feature,
    options?: {
      supplied?: Readonly<Record<string, string | number | boolean>>
      handles?: readonly string[]
    }
  ): FeatureProblem[]

  /** The configurations with variables applied and typed keys converted */
  resolveConfigurations(
    feature: Feature,
    supplied?: Readonly<Record<string, string | number | boolean>>
  ): Record<string, ConfigurationProperties>

  /** Variables with neither a default nor a supplied value */
  missingVariables(
    feature: Feature,
    supplied?: Readonly<Record<string, string | number | boolean>>
  ): string[]

  getId(name: string, version: string): FeatureId
  parseId(id: string): FeatureId
  formatId(id: FeatureId): string
}

/** The feature service, as the loader publishes it */
export const featureService: FeatureService = Object.freeze({
  readFeature,
  writeFeature,
  validateFeature,
  resolveConfigurations,
  missingVariables,
  getId: (name: string, version: string) => ({ name, version }),
  parseId: parseFeatureId,
  formatId: formatFeatureId
})
