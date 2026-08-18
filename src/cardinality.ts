/**
 * TSM - TypeScript Module System
 * Cardinality semantics for service requirements
 *
 * Kept in one place because the two questions below are asked from three
 * directions — the registry when checking requirements, the loader when
 * deciding what to report, the resolver when building load order — and three
 * copies of a string comparison drift apart.
 */

import type { ServiceCardinality } from './types.js'

/** The parts of a requirement that determine cardinality */
export interface CardinalityBearing {
  optional?: boolean
  cardinality?: ServiceCardinality
}

/**
 * Whether at least one provider is needed for the requirement to be satisfied.
 *
 * `optional` is the older spelling of cardinality '0..1'; either form makes the
 * requirement non-blocking. The n-variants need one provider just like 1..1 —
 * cardinality says how many are consumed, not how many are required.
 */
export function requiresAtLeastOne(requirement: CardinalityBearing): boolean {
  if (requirement.cardinality) {
    return requirement.cardinality.startsWith('1..')
  }
  return requirement.optional !== true
}

/**
 * Whether the requirement consumes every provider rather than a single one.
 *
 * A collector hears about a provider joining or leaving an already non-empty
 * set; a single-valued requirement only cares whether anything is there.
 */
export function collectsMany(requirement: CardinalityBearing): boolean {
  return requirement.cardinality?.endsWith('..n') === true
}
