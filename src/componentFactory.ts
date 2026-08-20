/**
 * TSM - TypeScript Module System
 * Factory components — a component somebody instantiates by asking
 *
 * A factory component (DS 112.2.4) does not register its own service. It
 * registers a factory, and every call builds one instance with the properties
 * the caller passes.
 *
 * The distinction from a factory *configuration* is who decides there should be
 * another one. A factory configuration is data: a management UI or a stored file
 * creates instances, and the component is a template filled from outside. A
 * factory component is a call: code decides, which is the only way to express
 * "one editor per open tab" — nothing outside the code that opens tabs knows a
 * tab was opened.
 */

/** Service ID every {@link ComponentFactory} is registered under */
export const COMPONENT_FACTORY_SERVICE_ID = 'tsm.component.factory'

/**
 * The property carrying the factory's name, so a consumer filters on it rather
 * than on the class. Spelled as in DS.
 */
export const COMPONENT_FACTORY = 'component.factory'

/** The property carrying the component class's name */
export const COMPONENT_NAME = 'component.name'

/** The filter selecting one factory by name */
export function componentFactoryFilter(name: string): string {
  return `(${COMPONENT_FACTORY}=${name})`
}
