/**
 * TSM - TypeScript Module System
 * Requirements and capabilities (OSGi Core 3.3)
 *
 * The general form of a dependency: a module offers **capabilities** in a
 * namespace, and needs **requirements** that assert some capability exists. What
 * `dependencies`, `provides` and `sharedDependencies` say is derived into this
 * model rather than living beside it, so there is one mechanism instead of four.
 *
 * Resolution here is **static**. It works on manifests and answers whether a
 * module could run at all — before anything is loaded. Whether a promised service
 * is actually registered is the other question, and `requiresService` asks it at
 * runtime. The specification draws the same line: a capability in the
 * `osgi.service` namespace "is a promise" at resolve time (Compendium 135.4).
 */

import semver from 'semver'
import type {
  Capability,
  ModuleManifest,
  Requirement,
  RequirementReport,
  ServicePropertyValue,
  UnresolvedRequirement,
  Wire,
  WiringResolution
} from './types.js'
import { createServiceFilter } from './serviceFilter.js'

/**
 * The namespace of a module's own identity, as OSGi names it.
 *
 * Attributes: the module id under `osgi.identity`, a `type`, and `version`.
 */
export const IDENTITY_NAMESPACE = 'osgi.identity'

/**
 * Services a module promises to register. Attributes: `objectClass` with the
 * service IDs, plus whatever the declaration carried.
 */
export const SERVICE_NAMESPACE = 'osgi.service'

/** Shared libraries the host provides. Attributes: `library`, `version`. */
export const LIBRARY_NAMESPACE = 'tsm.library'

/** The value of `type` on an identity capability */
export const MODULE_TYPE = 'tsm.module'

/** Only capabilities and requirements effective at resolve time are considered */
const RESOLVE = 'resolve'

function isEffectiveAtResolve(effective: string | undefined): boolean {
  return effective === undefined || effective === RESOLVE
}

/**
 * Everything a module offers, derived and declared.
 *
 * Derived first, so a declared capability can be read as an addition rather than
 * as a correction.
 */
export function capabilitiesOf(manifest: ModuleManifest): Capability[] {
  const derived: Capability[] = [
    {
      namespace: IDENTITY_NAMESPACE,
      attributes: {
        [IDENTITY_NAMESPACE]: manifest.id,
        type: MODULE_TYPE,
        version: manifest.version
      }
    }
  ]

  for (const service of manifest.provides ?? []) {
    derived.push({
      namespace: SERVICE_NAMESPACE,
      attributes: {
        // A list, as in the specification: one capability may cover several IDs
        objectClass: [service.id],
        ...service.properties
      }
    })
  }

  return [...derived, ...(manifest.capabilities ?? [])]
}

/**
 * Everything a module needs, derived and declared.
 *
 * A `dependencies` entry becomes an identity requirement, a `requiresService` a
 * service requirement, a `sharedDependencies` a library requirement — with the
 * optionality each of them already expressed.
 */
export function requirementsOf(manifest: ModuleManifest): Requirement[] {
  const derived: Requirement[] = []

  for (const dependency of manifest.dependencies ?? []) {
    const spec = typeof dependency === 'string' ? { id: dependency } : dependency
    derived.push({
      namespace: IDENTITY_NAMESPACE,
      filter: `(${IDENTITY_NAMESPACE}=${escapeValue(spec.id)})`,
      versionRange: spec.versionRange,
      resolution: spec.optional === true ? 'optional' : 'mandatory'
    })
  }

  for (const dependency of manifest.optionalDependencies ?? []) {
    const spec = typeof dependency === 'string' ? { id: dependency } : dependency
    derived.push({
      namespace: IDENTITY_NAMESPACE,
      filter: `(${IDENTITY_NAMESPACE}=${escapeValue(spec.id)})`,
      versionRange: spec.versionRange,
      resolution: 'optional'
    })
  }

  for (const requirement of manifest.requiresService ?? []) {
    derived.push({
      namespace: SERVICE_NAMESPACE,
      filter: `(objectClass=${escapeValue(requirement.id)})`,
      // The runtime requirement may be mandatory while the resolution is not:
      // cardinality 0..n means the module runs with no provider at all
      resolution: requirement.optional === true || requirement.cardinality?.startsWith('0')
        ? 'optional'
        : 'mandatory'
    })
  }

  for (const library of manifest.sharedDependencies ?? []) {
    derived.push({
      namespace: LIBRARY_NAMESPACE,
      filter: `(library=${escapeValue(library.id)})`,
      versionRange: library.versionRange
    })
  }

  return [...derived, ...(manifest.requirements ?? [])]
}

/** Escape what a filter value may not contain unescaped (Core 3.2.7) */
function escapeValue(value: string): string {
  return value.replace(/[\\()*]/g, character => `\\${character}`)
}

/**
 * Whether one capability satisfies one requirement.
 *
 * Namespace first, then the filter over that capability's attributes alone — the
 * specification is explicit that `(&(a=1)(b=2))` must be met by a single
 * capability, not by two that each carry one of them.
 */
export function satisfies(requirement: Requirement, capability: Capability): boolean {
  if (capability.namespace !== requirement.namespace) return false
  if (!isEffectiveAtResolve(capability.directives?.effective)) return false

  const attributes = capability.attributes ?? {}

  if (requirement.versionRange !== undefined) {
    const version = attributes.version
    if (typeof version !== 'string' || !semver.validRange(requirement.versionRange)) {
      return false
    }
    if (!semver.satisfies(version, requirement.versionRange, { includePrerelease: true })) {
      return false
    }
  }

  if (requirement.filter === undefined) return true

  // Case sensitive attribute names, as Core 3.3.6 asks for
  return createServiceFilter(requirement.filter, { caseSensitive: true })(
    attributes as Record<string, ServicePropertyValue>
  )
}

/**
 * Wire the requirements of these modules to the capabilities among them.
 *
 * A module resolves when every mandatory requirement found a capability. An
 * optional one that found nothing is simply not wired — no error, as in OSGi.
 */
export function resolveWiring(manifests: ModuleManifest[]): WiringResolution {
  const offered = manifests.flatMap(manifest =>
    capabilitiesOf(manifest).map(capability => ({ provider: manifest.id, capability }))
  )

  const wires: Wire[] = []
  const unresolved: UnresolvedRequirement[] = []
  const requirements: RequirementReport[] = []
  const failed = new Set<string>()

  for (const manifest of manifests) {
    for (const requirement of requirementsOf(manifest)) {
      if (!isEffectiveAtResolve(requirement.effective)) continue

      const matches = offered.filter(entry => satisfies(requirement, entry.capability))
      const report: RequirementReport = { moduleId: manifest.id, requirement, wires: [] }
      requirements.push(report)

      if (matches.length === 0) {
        if ((requirement.resolution ?? 'mandatory') === 'optional') continue

        // Distinguish "nothing of this kind exists" from "nothing matched", since
        // the two point at different mistakes
        const anyInNamespace = offered.some(
          entry => entry.capability.namespace === requirement.namespace
        )
        const failure: UnresolvedRequirement = {
          moduleId: manifest.id,
          requirement,
          reason: anyInNamespace ? 'no-match' : 'no-capability'
        }
        unresolved.push(failure)
        report.failure = failure
        failed.add(manifest.id)
        continue
      }

      const chosen = (requirement.cardinality ?? 'single') === 'multiple'
        ? matches
        : [best(matches)]

      for (const entry of chosen) {
        const wire: Wire = {
          requirer: manifest.id,
          requirement,
          provider: entry.provider,
          capability: entry.capability
        }
        wires.push(wire)
        report.wires.push(wire)
      }
    }
  }

  return {
    wires,
    unresolved,
    requirements,
    resolved: manifests.map(manifest => manifest.id).filter(id => !failed.has(id))
  }
}

/**
 * Which of several matches to wire.
 *
 * The highest `version` attribute wins, and declaration order breaks a tie —
 * OSGi's provider selection is richer (Core 3.7.10), but a version preference is
 * the part that carries its weight without a full constraint solver.
 */
function best<T extends { capability: Capability }>(matches: T[]): T {
  return matches.reduce((winner, candidate) => {
    const left = versionOf(candidate.capability)
    const right = versionOf(winner.capability)
    if (left === undefined || right === undefined) return winner
    return semver.gt(left, right) ? candidate : winner
  })
}

function versionOf(capability: Capability): string | undefined {
  const version = capability.attributes?.version
  return typeof version === 'string' && semver.valid(version) ? version : undefined
}

/**
 * The wires of one module, as `inspect requirement` shows them in Gogo.
 */
export function wiringOf(resolution: WiringResolution, moduleId: string): {
  requires: Wire[]
  provides: Wire[]
} {
  return {
    requires: resolution.wires.filter(wire => wire.requirer === moduleId),
    provides: resolution.wires.filter(wire => wire.provider === moduleId)
  }
}
