/**
 * TSM - TypeScript Module System
 * Metatype - what a configuration looks like
 *
 * The counterpart to OSGi's Metatype Service (Compendium 105): a description of
 * the attributes a PID accepts — names, types, defaults, ranges — so that a
 * generic user interface can offer a form for a component nobody wrote a form
 * for. Config Admin holds values, Metatype describes them, and neither knows
 * about the other.
 *
 * One thing works out better here than in Java. There, a configuration needs an
 * annotated *interface* for the type and annotations for the description, and the
 * two can drift. Here a schema is a value, and the type is derived from it:
 *
 * ```typescript
 * const TileConfig = objectClass({
 *   id: 'demo.tiles',
 *   attributes: {
 *     url: { type: 'string', name: 'Tile URL' },
 *     zoom: { type: 'integer', default: 12, min: 1, max: 22 }
 *   }
 * })
 * type TileConfig = ConfigurationOf<typeof TileConfig>   // { url: string; zoom: number }
 * ```
 */

import type { ConfigurationProperties, ServicePropertyValue } from './types.js'

/**
 * The type of an attribute.
 *
 * OSGi distinguishes eight numeric types because Java does; JavaScript has one
 * number, so `integer` and `number` carry the distinction that survives — whether
 * a fractional value is allowed. `password` is a string a user interface should
 * not show in the clear, as in OSGi.
 */
export type AttributeType = 'string' | 'number' | 'integer' | 'boolean' | 'password'

/** How many values an attribute holds */
export type AttributeCardinality = 'single' | 'many' | number

export interface AttributeDefinition {
  type: AttributeType

  /** Label for a user interface. `%key` is looked up in the localization table. */
  name?: string

  /** Longer explanation, shown next to the field. `%key` is localized too. */
  description?: string

  /**
   * Whether a value has to be present. Defaults to **true**, as in OSGi — a
   * surprise worth knowing about.
   */
  required?: boolean

  /**
   * Value used when the configuration does not carry one.
   *
   * Applied as a component property, which is where bnd puts the defaults of an
   * annotated configuration type as well: the component sees the value without
   * having to write `?? something` around every read.
   */
  default?: ServicePropertyValue

  /** `single` (default), `many` for a list, or a number as the maximum length */
  cardinality?: AttributeCardinality

  /** Smallest allowed value, for `number` and `integer` */
  min?: number

  /** Largest allowed value, for `number` and `integer` */
  max?: number

  /** Shortest allowed string. OSGi compares min/max lexically here, which is of little use. */
  minLength?: number

  /** Longest allowed string */
  maxLength?: number

  /** The permitted values, which a user interface offers as a choice */
  options?: ReadonlyArray<{ value: string | number; label?: string }>

  /**
   * Anything the declaration cannot express. Returns a message, or undefined when
   * the value is acceptable — OSGi's `AttributeDefinition.validate`, with the
   * empty-string convention replaced by undefined.
   */
  validate?(value: ServicePropertyValue): string | undefined
}

/**
 * The description of one configuration: OSGi's ObjectClassDefinition.
 *
 * @typeParam A The attributes, kept as a literal type so {@link ConfigurationOf}
 *   can derive the shape of the configuration from it
 */
export interface ObjectClassDefinition<
  A extends Record<string, AttributeDefinition> = Record<string, AttributeDefinition>
> {
  /** Identifies the description itself; conventionally the PID it describes */
  id: string

  /** Title for a user interface. `%key` is localized. */
  name?: string

  description?: string

  attributes: A

  /**
   * Translations for the `%key` references in names and descriptions, by locale.
   *
   * OSGi keeps these in properties files next to the XML; the mechanism is the
   * same, only the storage differs.
   */
  localization?: Record<string, Record<string, string>>
}

/**
 * Declare a configuration schema.
 *
 * An identity function whose only job is inference: it keeps the attributes as
 * literal types, so `ConfigurationOf<typeof schema>` can name the value types.
 */
export function objectClass<const A extends Record<string, AttributeDefinition>>(
  definition: ObjectClassDefinition<A>
): ObjectClassDefinition<A> {
  return definition
}

type SingleValue<A extends AttributeDefinition> =
  A['type'] extends 'boolean' ? boolean
    : A['type'] extends 'number' | 'integer' ? number
      : string

type AttributeValue<A extends AttributeDefinition> =
  A extends { cardinality: 'many' | number } ? SingleValue<A>[] : SingleValue<A>

/**
 * Attributes that may be absent: explicitly not required, and without a default
 * to stand in for them.
 */
type OptionalAttributes<A extends Record<string, AttributeDefinition>> = {
  [K in keyof A]: A[K] extends { required: false }
    ? A[K] extends { default: ServicePropertyValue } ? never : K
    : never
}[keyof A]

/** Flattens an intersection, so the hover text reads as one object */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * The configuration a schema describes, as a type.
 *
 * ```typescript
 * type TileConfig = ConfigurationOf<typeof TileConfigSchema>
 * ```
 */
export type ConfigurationOf<O extends ObjectClassDefinition<Record<string, AttributeDefinition>>> =
  O extends ObjectClassDefinition<infer A>
    ? Simplify<
      { [K in Exclude<keyof A, OptionalAttributes<A>>]: AttributeValue<A[K]> } &
      { [K in OptionalAttributes<A>]?: AttributeValue<A[K]> }
    >
    : never

/** What is wrong with one attribute of a configuration */
export interface AttributeError {
  attribute: string
  message: string
}

/** Separator between a factory PID and an instance name, as in OSGi CM 1.6 */
const FACTORY_SEPARATOR = '~'

function isMultiValued(attribute: AttributeDefinition): boolean {
  const cardinality = attribute.cardinality ?? 'single'
  return cardinality !== 'single'
}

function maxLength(attribute: AttributeDefinition): number | undefined {
  return typeof attribute.cardinality === 'number' ? attribute.cardinality : undefined
}

/**
 * Descriptions of configurations, by PID.
 *
 * OSGi's MetaTypeService, which answers per bundle; here the loader registers
 * what a component declared, so the registry answers for the whole application.
 */
export class MetatypeRegistry {
  private singletons = new Map<string, ObjectClassDefinition>()
  private factories = new Map<string, ObjectClassDefinition>()
  /** Which module registered a PID, so a teardown can take its schemas with it */
  private owners = new Map<string, string>()

  /**
   * Connect a description to a PID — OSGi's `@Designate`.
   *
   * @param options.factory The PID is a factory PID, so the description applies
   *   to every instance created from it. A user interface reads this as a licence
   *   to offer "add another one".
   * @param options.providedBy Module the declaration came from
   */
  designate(
    pid: string,
    definition: ObjectClassDefinition<Record<string, AttributeDefinition>>,
    options: { factory?: boolean; providedBy?: string } = {}
  ): void {
    const target = options.factory === true ? this.factories : this.singletons
    target.set(pid, definition as ObjectClassDefinition)

    if (options.providedBy !== undefined) {
      this.owners.set(pid, options.providedBy)
    }
  }

  /** Withdraw the descriptions a module registered */
  removeAllOf(moduleId: string): void {
    for (const [pid, owner] of [...this.owners]) {
      if (owner !== moduleId) continue

      this.singletons.delete(pid)
      this.factories.delete(pid)
      this.owners.delete(pid)
    }
  }

  /** PIDs with a description of their own */
  getPids(): string[] {
    return [...this.singletons.keys()]
  }

  /** Factory PIDs, whose description applies to every configuration of them */
  getFactoryPids(): string[] {
    return [...this.factories.keys()]
  }

  /**
   * The description for a PID, with `%key` references resolved for a locale.
   *
   * A factory instance's PID (`factoryPid~name`) is answered with its factory's
   * description: that is what a user interface editing the instance needs, and
   * the instance has no description of its own.
   */
  getObjectClassDefinition(pid: string, locale?: string): ObjectClassDefinition | undefined {
    const found = this.definitionFor(pid)
    if (!found) return undefined

    return locale === undefined ? found : localizeDefinition(found, locale)
  }

  private definitionFor(pid: string): ObjectClassDefinition | undefined {
    const direct = this.singletons.get(pid) ?? this.factories.get(pid)
    if (direct) return direct

    const separator = pid.indexOf(FACTORY_SEPARATOR)
    if (separator < 0) return undefined

    return this.factories.get(pid.slice(0, separator))
  }

  /** The locales a description has translations for */
  getLocales(pid: string): string[] {
    return Object.keys(this.definitionFor(pid)?.localization ?? {})
  }

  /**
   * The declared default values of a PID.
   *
   * The loader merges these underneath a component's properties, so a component
   * reads a configured value or the declared default and never has to invent one.
   */
  defaults(pid: string): ConfigurationProperties {
    const definition = this.definitionFor(pid)
    if (!definition) return {}

    const values: ConfigurationProperties = {}
    for (const [id, attribute] of Object.entries(definition.attributes)) {
      if (attribute.default !== undefined) {
        values[id] = attribute.default
      }
    }
    return values
  }

  /**
   * What is wrong with these values, according to the description.
   *
   * An empty array means they are acceptable. Every problem is reported, not just
   * the first, because a form wants to mark all its fields at once.
   *
   * Attributes the description does not mention are left alone: a configuration
   * may carry more than a schema knows, and `service.pid` always does.
   */
  validate(pid: string, values: ConfigurationProperties): AttributeError[] {
    const definition = this.definitionFor(pid)
    if (!definition) return []

    const errors: AttributeError[] = []

    for (const [id, attribute] of Object.entries(definition.attributes)) {
      const value = values[id]

      if (value === undefined) {
        // Required by default, as in OSGi — but a default value stands in for it
        if (attribute.required !== false && attribute.default === undefined) {
          errors.push({ attribute: id, message: 'is required' })
        }
        continue
      }

      errors.push(...checkAttribute(id, attribute, value))
    }

    return errors
  }

  /**
   * The values, with defaults filled in, or an error listing everything wrong.
   *
   * One call for the usual sequence a form goes through before writing.
   */
  coerce(
    pid: string,
    values: ConfigurationProperties
  ): { values: ConfigurationProperties; errors: AttributeError[] } {
    const complete = { ...this.defaults(pid), ...values }
    return { values: complete, errors: this.validate(pid, complete) }
  }
}

function checkAttribute(
  id: string,
  attribute: AttributeDefinition,
  value: ServicePropertyValue
): AttributeError[] {
  const errors: AttributeError[] = []
  const many = isMultiValued(attribute)

  if (many !== Array.isArray(value)) {
    errors.push({
      attribute: id,
      message: many ? 'expects a list of values' : 'expects a single value'
    })
    return errors
  }

  const entries: ServicePropertyValue[] = Array.isArray(value) ? [...value] : [value]

  const limit = maxLength(attribute)
  if (limit !== undefined && entries.length > limit) {
    errors.push({ attribute: id, message: `takes at most ${limit} value(s)` })
  }

  for (const entry of entries) {
    errors.push(...checkValue(id, attribute, entry))
  }

  if (attribute.validate) {
    const message = attribute.validate(value)
    if (message !== undefined) {
      errors.push({ attribute: id, message })
    }
  }

  return errors
}

function checkValue(
  id: string,
  attribute: AttributeDefinition,
  value: ServicePropertyValue
): AttributeError[] {
  const errors: AttributeError[] = []

  switch (attribute.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({ attribute: id, message: 'expects true or false' })
      }
      break

    case 'number':
    case 'integer':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({ attribute: id, message: 'expects a number' })
        break
      }
      if (attribute.type === 'integer' && !Number.isInteger(value)) {
        errors.push({ attribute: id, message: 'expects a whole number' })
      }
      if (attribute.min !== undefined && value < attribute.min) {
        errors.push({ attribute: id, message: `must be at least ${attribute.min}` })
      }
      if (attribute.max !== undefined && value > attribute.max) {
        errors.push({ attribute: id, message: `must be at most ${attribute.max}` })
      }
      break

    case 'string':
    case 'password':
      if (typeof value !== 'string') {
        errors.push({ attribute: id, message: 'expects text' })
        break
      }
      if (attribute.minLength !== undefined && value.length < attribute.minLength) {
        errors.push({
          attribute: id,
          message: `must be at least ${attribute.minLength} character(s)`
        })
      }
      if (attribute.maxLength !== undefined && value.length > attribute.maxLength) {
        errors.push({
          attribute: id,
          message: `must be at most ${attribute.maxLength} character(s)`
        })
      }
      break
  }

  if (attribute.options && !attribute.options.some(option => option.value === value)) {
    const allowed = attribute.options.map(option => String(option.value)).join(', ')
    errors.push({ attribute: id, message: `must be one of: ${allowed}` })
  }

  return errors
}

/**
 * Resolve the `%key` references of a description for one locale.
 *
 * A key without a translation keeps its `%key` form rather than becoming empty:
 * a visible placeholder is easier to fix than a blank label.
 *
 * Exported for the JSON Schema translation, which needs the same resolution.
 */
export function localizeDefinition(
  definition: ObjectClassDefinition,
  locale: string
): ObjectClassDefinition {
  const table = definition.localization?.[locale]
  if (!table) return definition

  const translate = (text?: string): string | undefined =>
    text !== undefined && text.startsWith('%') ? table[text.slice(1)] ?? text : text

  const attributes: Record<string, AttributeDefinition> = {}
  for (const [id, attribute] of Object.entries(definition.attributes)) {
    attributes[id] = {
      ...attribute,
      name: translate(attribute.name),
      description: translate(attribute.description),
      options: attribute.options?.map(option => ({
        ...option,
        label: translate(option.label)
      }))
    }
  }

  return {
    ...definition,
    name: translate(definition.name),
    description: translate(definition.description),
    attributes
  }
}

/** Service ID the loader publishes the metatype registry under */
export const METATYPE_SERVICE_ID = 'tsm.metatype'
