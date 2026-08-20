/**
 * TSM - TypeScript Module System
 * Conditions — a service that carries no behaviour, only a statement
 *
 * A condition is how something says "this is now the case" without inventing a
 * service for it, and without whoever waits knowing who decides. DS 1.5 uses it
 * for the satisfying condition of a component (112.3.13); the Core R8 Condition
 * Service is where the idea comes from.
 *
 * The value of it over a plain marker service is the filter: one condition ID
 * space, many statements, and a component that waits for the one it names.
 */

import type { ServiceProperties } from './types.js'

/** Service ID every condition is registered under */
export const CONDITION_SERVICE_ID = 'tsm.condition'

/**
 * The property naming which condition a registration stands for.
 *
 * Spelled as in OSGi, so a filter written for a Java `@Reference` reads the same
 * here — the same choice the registry's own `service.ranking` makes.
 */
export const CONDITION_ID = 'condition.id'

/** The condition that always holds, as DS has it */
export const TRUE_CONDITION_ID = 'true'

/**
 * The object a condition registers.
 *
 * Deliberately empty and shared: a condition is its properties, and nothing
 * should be tempted to call anything on it.
 */
export const TRUE_CONDITION: Readonly<Record<string, never>> = Object.freeze({})

/** The filter matching the condition that always holds */
export const TRUE_CONDITION_FILTER = `(${CONDITION_ID}=${TRUE_CONDITION_ID})`

/**
 * The properties a condition is registered with.
 *
 * ```typescript
 * context.services.register(CONDITION_SERVICE_ID, TRUE_CONDITION, {
 *   properties: conditionProperties('data.loaded')
 * })
 * ```
 */
export function conditionProperties(id: string, extra?: ServiceProperties): ServiceProperties {
  return { ...extra, [CONDITION_ID]: id }
}

/** The filter selecting one condition by ID */
export function conditionFilter(id: string): string {
  return `(${CONDITION_ID}=${id})`
}
