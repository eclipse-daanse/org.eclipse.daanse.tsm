/**
 * TSM - TypeScript Module System
 * Decorator-based Constructor Injection
 */

import 'reflect-metadata'

const INJECTABLE_KEY = Symbol('tsm:injectable')
const INJECT_KEY = Symbol('tsm:inject')
const INJECT_PROPERTY_KEY = Symbol('tsm:inject:property')
const SCOPE_KEY = Symbol('tsm:scope')

/**
 * Metadata for a single constructor parameter injection
 */
export interface InjectMetadata {
  index: number
  serviceId: string
  optional: boolean
}

/**
 * Metadata for a property injection
 */
export interface PropertyInjectMetadata {
  propertyKey: string | symbol
  serviceId: string
  optional: boolean
}

/**
 * Marks a class as injectable — required for constructor injection via bindClass().
 */
export function injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE_KEY, true, target)
  }
}

/**
 * Marks a constructor parameter or a property for injection.
 * @param serviceId - Service ID in the ServiceRegistry
 * @param options - { optional: true } if the service may be absent
 *
 * Usage on constructor parameter:
 *   constructor(@inject('logger') private logger: Logger) {}
 *
 * Usage on property:
 *   @inject('logger') private logger!: Logger
 */
export function inject(serviceId: string, options?: { optional?: boolean }): ParameterDecorator & PropertyDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex?: number) => {
    if (parameterIndex !== undefined) {
      // Constructor parameter injection
      const existing: InjectMetadata[] = Reflect.getOwnMetadata(INJECT_KEY, target) ?? []
      existing.push({
        index: parameterIndex,
        serviceId,
        optional: options?.optional ?? false
      })
      Reflect.defineMetadata(INJECT_KEY, existing, target)
    } else {
      // Property injection
      const ctor = target.constructor
      const existing: PropertyInjectMetadata[] = Reflect.getOwnMetadata(INJECT_PROPERTY_KEY, ctor) ?? []
      existing.push({
        propertyKey: propertyKey!,
        serviceId,
        optional: options?.optional ?? false
      })
      Reflect.defineMetadata(INJECT_PROPERTY_KEY, existing, ctor)
    }
  }
}

/**
 * Declares the default scope of a class as singleton.
 * Can be overridden at bindClass() call site.
 */
export function singleton(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SCOPE_KEY, 'singleton', target)
  }
}

/**
 * Declares the default scope of a class as transient (new instance per get()).
 * Can be overridden at bindClass() call site.
 */
export function transient(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SCOPE_KEY, 'transient', target)
  }
}

/**
 * Reads the inject metadata from a class, sorted by parameter index.
 */
export function getInjectMetadata(target: Function): InjectMetadata[] {
  const metadata: InjectMetadata[] = Reflect.getOwnMetadata(INJECT_KEY, target) ?? []
  return metadata.sort((a, b) => a.index - b.index)
}

/**
 * Reads the property inject metadata from a class.
 */
export function getPropertyInjectMetadata(target: Function): PropertyInjectMetadata[] {
  return Reflect.getOwnMetadata(INJECT_PROPERTY_KEY, target) ?? []
}

/**
 * Checks if a class is decorated with @injectable().
 */
export function isInjectable(target: Function): boolean {
  return Reflect.getOwnMetadata(INJECTABLE_KEY, target) === true
}

/**
 * Reads the scope metadata from a class (set by @singleton() or @transient()).
 * Returns undefined if no scope decorator was used.
 */
export function getScopeMetadata(target: Function): 'singleton' | 'transient' | undefined {
  return Reflect.getOwnMetadata(SCOPE_KEY, target)
}