/**
 * TSM - TypeScript Module System
 * Service Component Runtime — the component layer, as a service
 *
 * In OSGi, SCR is an ordinary bundle: an extender that reads other bundles'
 * component descriptions and manages them from outside. The framework itself
 * knows nothing about Declarative Services. Two things follow from that which are
 * worth keeping even where the extender is not a separate bundle:
 *
 * A module can declare that it *needs* the component layer, through the
 * `osgi.extender` capability SCR provides (see {@link EXTENDER_NAMESPACE}).
 *
 * And introspection is a **service** (`ServiceComponentRuntime`, 112.10), not a
 * privileged back door. That is what lets a component view, a diagnostics panel
 * or a set of devtools ship as a module rather than having to live in the host —
 * and it is why this file exists: in tsm the loader is framework and SCR in one
 * object, so without it nothing but the host could see the components.
 */

import type { ComponentInfo } from './types.js'

/** Service ID the loader publishes its component runtime under */
export const COMPONENT_RUNTIME_SERVICE_ID = 'tsm.component.runtime'

/**
 * The capability namespace an extender offers, as OSGi registers it
 * (Common Namespaces 135.3).
 */
export const EXTENDER_NAMESPACE = 'osgi.extender'

/** The extender name for the component layer, spelled as in DS */
export const COMPONENT_EXTENDER = 'osgi.component'

/**
 * The extender name for Metatype, as Metatype 105.12 registers it.
 *
 * Offered only when the application handed the loader a `MetatypeRegistry`:
 * without one, a component's `configurationSchema` is dropped on the floor, so a
 * module that has one has a real reason to require this.
 */
export const METATYPE_EXTENDER = 'osgi.metatype'

/**
 * The namespace for "this implementation is present", as opposed to an extender
 * that acts on other bundles (Common Namespaces 135.4).
 */
export const IMPLEMENTATION_NAMESPACE = 'osgi.implementation'

/** Configuration Admin, which is an implementation rather than an extender */
export const CONFIGURATION_IMPLEMENTATION = 'osgi.cm'

/**
 * What a module gets to see and do about components — OSGi's
 * `ServiceComponentRuntime` (112.10), in the shapes tsm already uses.
 *
 * Deliberately not a second model: OSGi's DTOs exist because a bundle must not be
 * handed live SCR objects across a class-loader boundary. Here `ComponentInfo` is
 * already a plain description rather than the component itself, so it is the DTO.
 */
export interface ServiceComponentRuntime {
  /**
   * The component declarations, of one module or of all of them.
   *
   * OSGi's `getComponentDescriptionDTOs(Bundle...)`. Each entry carries its
   * configurations, which is where the state lives — a declaration has none.
   */
  getComponentDescriptions(moduleId?: string): ComponentInfo[]

  /** One declaration by module and class name, or undefined */
  getComponentDescription(moduleId: string, className: string): ComponentInfo | undefined

  /**
   * Whether a component is enabled — the switch, not satisfaction.
   *
   * A disabled component is not waiting for anything; an enabled one may still be
   * unsatisfied. OSGi keeps the two apart the same way (112.5.1 against 112.5.2).
   */
  isComponentEnabled(moduleId: string, className: string): boolean

  /**
   * Switch a component off, leaving its module and its siblings running.
   *
   * Resolves once the component has stopped and its services are withdrawn — a
   * `Promise` where OSGi returns its own `Promise`, for the same reason: the work
   * is not done when the call returns.
   */
  disableComponent(moduleId: string, className: string): Promise<boolean>

  /** Let it run again, if what it needs is there */
  enableComponent(moduleId: string, className: string): Promise<boolean>

  /** Every component switched off, as `moduleId/className` */
  getDisabledComponents(): string[]
}
