/**
 * TSM - TypeScript Module System
 * Decorator-based Constructor Injection
 */

import 'reflect-metadata'
import type { ComponentOptions } from './types.js'

const INJECTABLE_KEY = Symbol('tsm:injectable')
const INJECT_KEY = Symbol('tsm:inject')
const INJECT_PROPERTY_KEY = Symbol('tsm:inject:property')
const SCOPE_KEY = Symbol('tsm:scope')
const COMPONENT_KEY = Symbol('tsm:component')
const ACTIVATE_KEY = Symbol('tsm:component:activate')
const DEACTIVATE_KEY = Symbol('tsm:component:deactivate')

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
 * What the metadata readers accept: a class, or any object carrying metadata.
 * Reflect.getOwnMetadata needs nothing more specific.
 */
type MetadataTarget = object

/**
 * Reads the inject metadata from a class, sorted by parameter index.
 */
export function getInjectMetadata(target: MetadataTarget): InjectMetadata[] {
  const metadata: InjectMetadata[] = Reflect.getOwnMetadata(INJECT_KEY, target) ?? []
  return metadata.sort((a, b) => a.index - b.index)
}

/**
 * Reads the property inject metadata from a class.
 */
export function getPropertyInjectMetadata(target: MetadataTarget): PropertyInjectMetadata[] {
  return Reflect.getOwnMetadata(INJECT_PROPERTY_KEY, target) ?? []
}

/**
 * Declares a class as a component: the loader registers it under the given
 * service ids and runs its lifecycle, so the module needs no imperative
 * `activate` export for it.
 *
 * The declaration lives on the class rather than beside it, which is what keeps
 * manifest and code from drifting apart.
 *
 * Implies `@injectable()`, so constructor injection works without a second
 * decorator.
 */
export function component(options: ComponentOptions = {}): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(COMPONENT_KEY, options, target)
    Reflect.defineMetadata(INJECTABLE_KEY, true, target)
  }
}

/**
 * Marks the method to call once the component exists.
 *
 * A component with an activate method is created when its module activates
 * (DS calls this an immediate component), because something has to run whether
 * or not anyone asks for its service. Without one it is created on first
 * resolution — a delayed component.
 */
export function activate(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(ACTIVATE_KEY, propertyKey, target.constructor)
  }
}

/** Marks the method to call when the component goes away */
export function deactivate(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(DEACTIVATE_KEY, propertyKey, target.constructor)
  }
}

/** Reads the component declaration, or undefined for a plain class */
export function getComponentMetadata(target: MetadataTarget): ComponentOptions | undefined {
  return Reflect.getOwnMetadata(COMPONENT_KEY, target)
}

/** Whether a class is declared as a component */
export function isComponent(target: MetadataTarget): boolean {
  return Reflect.getOwnMetadata(COMPONENT_KEY, target) !== undefined
}

/** The method marked with @activate, if any */
export function getActivateMethod(target: MetadataTarget): string | symbol | undefined {
  return Reflect.getOwnMetadata(ACTIVATE_KEY, target)
}

/** The method marked with @deactivate, if any */
export function getDeactivateMethod(target: MetadataTarget): string | symbol | undefined {
  return Reflect.getOwnMetadata(DEACTIVATE_KEY, target)
}

/**
 * Checks if a class is decorated with @injectable().
 */
export function isInjectable(target: MetadataTarget): boolean {
  return Reflect.getOwnMetadata(INJECTABLE_KEY, target) === true
}

/**
 * Reads the scope metadata from a class (set by @singleton() or @transient()).
 * Returns undefined if no scope decorator was used.
 */
export function getScopeMetadata(target: MetadataTarget): 'singleton' | 'transient' | undefined {
  return Reflect.getOwnMetadata(SCOPE_KEY, target)
}