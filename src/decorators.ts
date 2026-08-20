/**
 * TSM - TypeScript Module System
 * Decorator-based Constructor Injection
 */

import 'reflect-metadata'
import type { ComponentOptions, ServiceScope } from './types.js'

/**
 * Metadata keys, taken from the global symbol registry rather than created here.
 *
 * A separately built module may carry its own copy of this package. With
 * `Symbol()` each copy would write under a key of its own, so a decorator
 * applied in the module would be invisible to the loader in the host — silently.
 * `Symbol.for()` makes the key the same wherever the code came from.
 */
const INJECTABLE_KEY = Symbol.for('tsm:injectable')
const INJECT_KEY = Symbol.for('tsm:inject')
const INJECT_PROPERTY_KEY = Symbol.for('tsm:inject:property')
const SCOPE_KEY = Symbol.for('tsm:scope')
const COMPONENT_KEY = Symbol.for('tsm:component')
const ACTIVATE_KEY = Symbol.for('tsm:component:activate')
const DEACTIVATE_KEY = Symbol.for('tsm:component:deactivate')
const MODIFIED_KEY = Symbol.for('tsm:component:modified')
const BIND_KEY = Symbol.for('tsm:component:bind')
const UNBIND_KEY = Symbol.for('tsm:component:unbind')

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
 * Declares the default scope of a class as one instance per consuming module —
 * OSGi's `bundle` scope, under the name tsm uses for a bundle.
 *
 * For a service that keeps state *about* whoever uses it: a per-module cache, a
 * session, an undo stack. A singleton would mix two modules' state into one
 * object; `transient()` would lose it between two calls.
 *
 * The instance is created on that module's first resolution and dropped when the
 * module is deactivated — with `dispose()` called on it if it has one.
 */
export function perModule(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SCOPE_KEY, 'module', target)
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
 * The class has to be **exported**: the loader looks for components in the
 * module's namespace, so one that is not exported is never registered, and
 * nothing at runtime can say why. `tsmPlugin({ components: … })` reports it at
 * build time.
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

/**
 * Marks the method to call when the component's configuration changed.
 *
 * Its presence is what decides how a change is applied, exactly as in DS:
 * without one the component is torn down and built again with the new values,
 * with one it stays alive and is handed them. Choose it when rebuilding would
 * cost something the component cannot cheaply recreate — an open connection, a
 * mounted view, accumulated state.
 *
 * The properties of the services it registered are updated either way, so a
 * consumer's target filter sees the new values without the registration being
 * withdrawn.
 */
export function modified(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(MODIFIED_KEY, propertyKey, target.constructor)
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

/** One service a component binds, and the method that takes it */
export interface BindingMetadata {
  serviceId: string
  method: string | symbol
  optional: boolean
}

/**
 * Marks the method that receives a service while the component runs.
 *
 * This is what makes a reference **dynamic**: without it, a service arriving or
 * leaving means the component is built again — with it, the component stays and
 * is handed the change. DS calls these bind methods (112.5.10); the difference
 * there is that the method names are declared in XML, while here the decorator
 * names them by being on them.
 *
 * The method runs before `@activate` when the component starts, in the order the
 * references were declared, as in DS.
 *
 * ```typescript
 * @bind(TILE_SERVICE) setTiles(tiles: TileSource) { this.tiles = tiles }
 * @unbind(TILE_SERVICE) unsetTiles() { this.tiles = undefined }
 * ```
 *
 * @param options.optional The component runs without it. Otherwise the service
 *   has to be there for the component to start at all, as with `@inject()`.
 */
export function bind(serviceId: string, options?: { optional?: boolean }): MethodDecorator {
  return (target, propertyKey) => {
    const existing: BindingMetadata[] =
      Reflect.getOwnMetadata(BIND_KEY, target.constructor) ?? []
    Reflect.defineMetadata(
      BIND_KEY,
      [...existing, { serviceId, method: propertyKey, optional: options?.optional === true }],
      target.constructor
    )
  }
}

/**
 * Marks the method called when a bound service goes away.
 *
 * The component keeps running — dropping the reference is its own business, which
 * is what a dynamic reference means. Without an unbind method the component is
 * stopped instead, since nothing else could keep it consistent.
 */
export function unbind(serviceId: string): MethodDecorator {
  return (target, propertyKey) => {
    const existing: BindingMetadata[] =
      Reflect.getOwnMetadata(UNBIND_KEY, target.constructor) ?? []
    Reflect.defineMetadata(
      UNBIND_KEY,
      [...existing, { serviceId, method: propertyKey, optional: false }],
      target.constructor
    )
  }
}

/** The services this class binds, with the methods that take them */
export function getBindMethods(target: MetadataTarget): BindingMetadata[] {
  return Reflect.getOwnMetadata(BIND_KEY, target) ?? []
}

/** The methods called when a bound service goes away */
export function getUnbindMethods(target: MetadataTarget): BindingMetadata[] {
  return Reflect.getOwnMetadata(UNBIND_KEY, target) ?? []
}

/** The method marked with @modified, if any */
export function getModifiedMethod(target: MetadataTarget): string | symbol | undefined {
  return Reflect.getOwnMetadata(MODIFIED_KEY, target)
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
export function getScopeMetadata(target: MetadataTarget): ServiceScope | undefined {
  return Reflect.getOwnMetadata(SCOPE_KEY, target)
}