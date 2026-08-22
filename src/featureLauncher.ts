/**
 * TSM - TypeScript Module System
 * Installing a feature — the part the specification leaves open
 *
 * OSGi 159 defines the document and the API to read it, and says explicitly that
 * turning a feature into a running system is a "launcher's" business. This is
 * that launcher, kept in its own file because it needs the loader and the
 * Configuration Admin, while the feature model needs neither.
 *
 * Two decisions worth stating, because they are where the specification stops:
 *
 * **Configuration before loading.** A component with
 * `configurationPolicy: 'require'` does not run without its configuration, and
 * one with `@modified` would otherwise be reconfigured immediately after starting.
 * Writing the configuration first means every component sees its values on the
 * first activation.
 *
 * **The resolver decides the order, not the feature.** The specification allows a
 * `start-order` on a bundle entry. tsm has a dependency resolver that knows the
 * actual requirements, and a hand-written order that disagrees with them would
 * either be redundant or wrong.
 */

import type { ModuleLoader } from './ModuleLoader.js'
import type { ConfigurationAdmin } from './ConfigurationAdmin.js'
import type { ModuleManifest } from './types.js'
import {
  formatFeatureId,
  missingVariables,
  resolveConfigurations,
  validateFeature,
  type Feature,
  type FeatureId
} from './features.js'

/** How a feature's module references become manifests the loader can take */
export type ManifestResolver =
  (id: FeatureId) => ModuleManifest | undefined | Promise<ModuleManifest | undefined>

export interface InstallOptions {
  loader: ModuleLoader

  /**
   * Where the configuration goes.
   *
   * Optional, and its absence is reported rather than ignored: a feature whose
   * configurations are silently dropped would start components with defaults and
   * look like it worked.
   */
  configurationAdmin?: ConfigurationAdmin

  /**
   * How to turn a module reference into a manifest.
   *
   * The seam the specification leaves open — a repository lookup, a static map, a
   * fetch. Returning undefined means "not available", which stops the install
   * before anything is loaded.
   */
  resolve: ManifestResolver

  /** Values for the feature's variables */
  variables?: Readonly<Record<string, string | number | boolean>>

  /** Extension names this launcher can handle, for the mandatory check */
  handles?: readonly string[]

  /**
   * Load the modules, or only register and configure them.
   *
   * `false` leaves the loader with the manifests known and the configuration
   * written, which is what a staged rollout wants: resolve first, load later.
   */
  load?: boolean
}

export interface InstallResult {
  feature: Feature
  /** The manifests that were registered, in the order the feature listed them */
  manifests: ModuleManifest[]
  /** The modules that came up, by id — empty when `load: false` */
  loaded: string[]
  /** PIDs that were written */
  configured: string[]
}

/**
 * Install a feature: check it, write its configuration, register its modules and
 * load them.
 *
 * Refuses before doing anything if the feature cannot be installed — a missing
 * variable, a module nothing provides, a mandatory extension nobody handles.
 * Half-installing a feature is worse than not installing it, because the half
 * that ran cannot be told from a system that was meant to look that way.
 */
export async function installFeature(
  feature: Feature,
  options: InstallOptions
): Promise<InstallResult> {
  const { loader, configurationAdmin, resolve } = options
  const label = formatFeatureId(feature.id)

  const problems = validateFeature(feature, {
    supplied: options.variables,
    handles: options.handles
  })
  if (problems.length > 0) {
    throw new Error(
      `Feature ${label} cannot be installed:\n` +
      problems.map(entry => `  ${entry.at}: ${entry.problem}`).join('\n')
    )
  }

  const configurations = resolveConfigurations(feature, options.variables)
  const pids = Object.keys(configurations)

  if (pids.length > 0 && !configurationAdmin) {
    throw new Error(
      `Feature ${label} carries configuration for ${pids.length} PID(s) but no ` +
      `Configuration Admin was given — its components would start on defaults`
    )
  }

  // Everything resolvable before anything is installed
  const manifests: ModuleManifest[] = []
  const unavailable: string[] = []

  for (const bundle of feature.bundles) {
    const manifest = await resolve(bundle.id)
    if (manifest) manifests.push(manifest)
    else unavailable.push(formatFeatureId(bundle.id))
  }

  if (unavailable.length > 0) {
    throw new Error(
      `Feature ${label} lists module(s) nothing provides: ${unavailable.join(', ')}`
    )
  }

  // Configuration first — see the note at the top of this file
  for (const [pid, properties] of Object.entries(configurations)) {
    await configurationAdmin!.getConfiguration(pid).update(properties)
  }

  loader.register(manifests)

  if (options.load !== false) {
    await loader.loadAll()
  }

  // Configuration events and registry events both run on the loader's queue, so
  // an install that has returned is an install that has settled
  await loader.settle()

  // What actually came up, rather than what was asked for: a module whose
  // requirements are unmet stays parked, and the caller should be able to see
  // that without asking a second question
  const loaded = options.load === false
    ? []
    : manifests
        .map(manifest => manifest.id)
        .filter(id => loader.getModule(id)?.state === 'active')

  return { feature, manifests, loaded, configured: pids }
}

/**
 * What a feature would need that it does not bring itself.
 *
 * The check behind `complete: true`, which is only a claim by the author. Uses
 * the loader's own wiring, so the system bundle's capabilities count — a feature
 * relying on a host-provided library is complete in a runtime that has it and not
 * in one that does not, which is exactly the distinction worth reporting.
 */
export function unsatisfiedRequirements(
  feature: Feature,
  options: { loader: ModuleLoader; manifests: readonly ModuleManifest[] }
): string[] {
  const inFeature = new Set(feature.bundles.map(bundle => bundle.id.name))
  const wiring = options.loader.getWiring()

  return wiring.unresolved
    .filter(entry => inFeature.has(entry.moduleId))
    .map(entry => `${entry.moduleId}: ${entry.requirement.namespace}` +
      (entry.requirement.filter ? ` ${entry.requirement.filter}` : '') +
      ` (${entry.reason})`)
}

/** Whether a feature's own claim of completeness holds in this runtime */
export function isComplete(
  feature: Feature,
  options: { loader: ModuleLoader; manifests: readonly ModuleManifest[] }
): boolean {
  return unsatisfiedRequirements(feature, options).length === 0
}

/** The variables a launcher still has to be given — re-exported for convenience */
export { missingVariables }
