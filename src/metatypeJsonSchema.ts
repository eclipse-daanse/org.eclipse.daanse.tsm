/**
 * TSM - TypeScript Module System
 * Configuration schemas as JSON Schema
 *
 * The way out of tsm's own vocabulary and into anything that reads a standard:
 * `@emfts/codec.jsonschema` turns the result into an EMF EPackage, from where
 * `@emfts/vue-registry` and `@emfts/uimodel-composer` can render a form; JSON
 * Forms and ordinary validators read it directly.
 *
 * Only this direction exists. Schemas are declared in code, so the way back —
 * from a document to a declaration — would have no reader.
 */

import type { AttributeDefinition, ObjectClassDefinition } from './Metatype.js'
import { localizeDefinition, type MetatypeRegistry } from './Metatype.js'

/**
 * As much of JSON Schema as this translation produces.
 *
 * Written out rather than taken from a package: a type is not worth a dependency,
 * and the shape here is exactly what {@link toJsonSchema} emits.
 */
export interface JsonSchema {
  $schema?: string
  $id?: string
  $ref?: string
  title?: string
  description?: string
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean'
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  maxItems?: number
  format?: string
  default?: unknown
  enum?: Array<string | number>
  /**
   * Labels for the values in `enum`, keyed by value.
   *
   * JSON Schema's `enum` cannot carry labels, and the `oneOf`-with-`const` form
   * that can is not what an EPackage converter recognises as an enumeration —
   * so the values stay in `enum` and the labels travel beside them.
   */
  'x-tsm-option-labels'?: Record<string, string>
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number

  /** The classes of a metamodel, which is where an EPackage converter looks */
  $defs?: Record<string, JsonSchema>

  /**
   * The identity of the description this came from, so the trip through JSON
   * Schema does not lose which ObjectClassDefinition it was.
   */
  'x-tsm-object-class'?: string

  /**
   * Attributes carrying a `validate()` function.
   *
   * A function cannot be expressed in any schema language, so what survives is
   * the knowledge that these attributes are checked by something the schema does
   * not describe — enough for a form to expect a rejection it cannot predict.
   * An OCL constraint is where such a rule would belong on the model side.
   */
  'x-tsm-validated'?: string[]

  /** The `%key` translation tables, which JSON Schema has no place for */
  'x-tsm-localization'?: Record<string, Record<string, string>>
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema'

/**
 * Translate a configuration schema into JSON Schema (Draft 2020-12).
 *
 * @param locale Resolves `%key` references to that locale first, so the result
 *   carries readable titles. Without it the keys stay as they are and the
 *   translation tables travel along in `x-tsm-localization`.
 *
 * An attribute is listed in `required` when it has no default: a declared default
 * makes the value dispensable in the stored document, which is the same rule
 * `MetatypeRegistry.validate()` applies. Anything else would call a configuration
 * invalid that tsm itself accepts.
 */
export function toJsonSchema(
  definition: ObjectClassDefinition,
  options: { locale?: string; id?: string } = {}
): JsonSchema {
  const source = options.locale === undefined
    ? definition
    : localizeDefinition(definition, options.locale)

  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  const validated: string[] = []

  for (const [id, attribute] of Object.entries(source.attributes)) {
    properties[id] = propertyFor(attribute)

    if (attribute.required !== false && attribute.default === undefined) {
      required.push(id)
    }
    if (attribute.validate !== undefined) {
      validated.push(id)
    }
  }

  const schema: JsonSchema = {
    $schema: DRAFT,
    type: 'object',
    'x-tsm-object-class': source.id,
    properties
  }

  if (options.id !== undefined) schema.$id = options.id
  if (source.name !== undefined) schema.title = source.name
  if (source.description !== undefined) schema.description = source.description
  if (required.length > 0) schema.required = required
  if (validated.length > 0) schema['x-tsm-validated'] = validated

  // Only worth carrying when the titles were not resolved already
  if (options.locale === undefined && definition.localization !== undefined) {
    schema['x-tsm-localization'] = definition.localization
  }

  return schema
}

/**
 * Every description as one metamodel, in the form an EPackage converter reads.
 *
 * A different shape for a different question, and the distinction matters:
 * {@link toJsonSchema} describes *a document* — what one PID's values look like,
 * which is what a validator or a form library wants. This describes *classes*,
 * which is what `@emfts/codec.jsonschema` turns into an EPackage: it reads
 * `$defs` and ignores a top-level object schema.
 *
 * ```typescript
 * const ePackage = new JsonSchemaToEPackageConverter().convert(
 *   toMetamodelSchema(metatype, { id: 'http://example.com/config', name: 'config' })
 * )
 * ```
 *
 * @param options.name Becomes the EPackage name; without it the package has none.
 *
 * @param source A registry — every PID and factory PID it knows — or a list of
 *   descriptions.
 */
export function toMetamodelSchema(
  source: MetatypeRegistry | ReadonlyArray<ObjectClassDefinition>,
  options: { locale?: string; id?: string; name?: string } = {}
): JsonSchema {
  const definitions = Array.isArray(source)
    ? [...source]
    : collectDefinitions(source as MetatypeRegistry, options.locale)

  const defs: Record<string, JsonSchema> = {}
  const taken = new Set<string>()

  for (const definition of definitions) {
    const schema = toJsonSchema(definition, options)
    // The document-level keys belong to the bundle, not to a class in it
    delete schema.$schema
    delete schema.$id

    const className = uniqueClassName(definition.id, taken)
    extractEnumerations(className, schema, defs, taken)
    defs[className] = schema
  }

  const bundle: JsonSchema = { $schema: DRAFT, $defs: defs }
  if (options.id !== undefined) bundle.$id = options.id
  // The converter reads the top-level title as the EPackage name, and a package
  // without one is awkward to work with downstream
  if (options.name !== undefined) bundle.title = options.name
  return bundle
}

/**
 * Lift inline enumerations into named definitions of their own.
 *
 * An `enum` written inside a property has no name, so a converter has to invent
 * one — `ArtificialClassifier0` and the like. Naming it after the class and
 * attribute it belongs to gives the resulting EEnum a name somebody can read.
 */
function extractEnumerations(
  className: string,
  schema: JsonSchema,
  defs: Record<string, JsonSchema>,
  taken: Set<string>
): void {
  for (const [id, property] of Object.entries(schema.properties ?? {})) {
    // For a list it is the item schema that carries the values
    const holder = property.type === 'array' && property.items ? property.items : property
    if (holder.enum === undefined) continue

    const name = uniqueClassName(`${className} ${id}`, taken)
    defs[name] = { enum: holder.enum }
    if (holder['x-tsm-option-labels'] !== undefined) {
      defs[name]['x-tsm-option-labels'] = holder['x-tsm-option-labels']
    }

    delete holder.enum
    delete holder['x-tsm-option-labels']
    delete holder.type
    holder.$ref = `#/$defs/${name}`
  }
}

function collectDefinitions(
  registry: MetatypeRegistry,
  locale?: string
): ObjectClassDefinition[] {
  return [...registry.getPids(), ...registry.getFactoryPids()]
    .map(pid => registry.getObjectClassDefinition(pid, locale))
    .filter((definition): definition is ObjectClassDefinition => definition !== undefined)
}

/**
 * A PID is not a class name: `demo.tile-source` becomes `DemoTileSource`.
 *
 * The original stays in `x-tsm-object-class`, so nothing is lost — and a name
 * that would collide gets a number rather than overwriting its predecessor.
 */
function uniqueClassName(id: string, taken: Set<string>): string {
  const base = id
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('') || 'Configuration'

  let name = base
  let counter = 1
  while (taken.has(name)) {
    name = `${base}${++counter}`
  }
  taken.add(name)
  return name
}

function propertyFor(attribute: AttributeDefinition): JsonSchema {
  const value = valueSchema(attribute)
  const cardinality = attribute.cardinality ?? 'single'

  const property: JsonSchema = cardinality === 'single'
    ? value
    : { type: 'array', items: value }

  if (typeof cardinality === 'number') {
    property.maxItems = cardinality
  }

  if (attribute.name !== undefined) property.title = attribute.name
  if (attribute.description !== undefined) property.description = attribute.description
  if (attribute.default !== undefined) property.default = attribute.default

  return property
}

/** The schema for one value, before cardinality wraps it in an array */
function valueSchema(attribute: AttributeDefinition): JsonSchema {
  const schema: JsonSchema = {
    type: attribute.type === 'password' ? 'string' : attribute.type
  }

  // JSON Schema has a format for exactly this, so a form knows to mask it
  if (attribute.type === 'password') {
    schema.format = 'password'
  }

  if (attribute.min !== undefined) schema.minimum = attribute.min
  if (attribute.max !== undefined) schema.maximum = attribute.max
  if (attribute.minLength !== undefined) schema.minLength = attribute.minLength
  if (attribute.maxLength !== undefined) schema.maxLength = attribute.maxLength

  if (attribute.options) {
    schema.enum = attribute.options.map(option => option.value)

    const labels: Record<string, string> = {}
    for (const option of attribute.options) {
      if (option.label !== undefined) {
        labels[String(option.value)] = option.label
      }
    }
    if (Object.keys(labels).length > 0) {
      schema['x-tsm-option-labels'] = labels
    }
  }

  return schema
}
