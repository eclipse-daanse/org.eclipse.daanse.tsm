import { describe, it, expect } from 'vitest'
import { MetatypeRegistry, objectClass } from '../Metatype'
import { toJsonSchema, toMetamodelSchema } from '../metatypeJsonSchema'

/**
 * The way out of tsm's vocabulary. Verified once by hand against the real
 * `JsonSchemaToEPackageConverter` from `@emfts/codec.jsonschema`, which produced
 * an EPackage with the EClasses, bounds and a named EEnum these tests describe —
 * the assertions here keep that shape without making tsm depend on it.
 */
describe('toJsonSchema', () => {
  const schema = objectClass({
    id: 'demo.tiles',
    name: 'Tile source',
    description: 'Where tiles come from',
    attributes: {
      url: { type: 'string', name: 'Tile URL', minLength: 8, maxLength: 200 },
      zoom: { type: 'integer', default: 12, min: 1, max: 22 },
      scale: { type: 'number' },
      retina: { type: 'boolean', required: false },
      token: { type: 'password', name: 'Token', required: false },
      layers: { type: 'string', cardinality: 'many', default: ['road'] },
      zooms: { type: 'integer', cardinality: 3 }
    }
  })

  it('should produce a Draft 2020-12 object schema', () => {
    const result = toJsonSchema(schema)

    expect(result.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(result.type).toBe('object')
    expect(result.title).toBe('Tile source')
    expect(result.description).toBe('Where tiles come from')
  })

  it('should keep which description it came from', () => {
    // So a trip through JSON Schema does not lose the PID it belongs to
    expect(toJsonSchema(schema)['x-tsm-object-class']).toBe('demo.tiles')
  })

  it('should map the types, and a password to its format', () => {
    const properties = toJsonSchema(schema).properties!

    expect(properties.url.type).toBe('string')
    expect(properties.zoom.type).toBe('integer')
    expect(properties.scale.type).toBe('number')
    expect(properties.retina.type).toBe('boolean')
    expect(properties.token).toMatchObject({ type: 'string', format: 'password' })
  })

  it('should carry ranges and lengths', () => {
    const properties = toJsonSchema(schema).properties!

    expect(properties.zoom).toMatchObject({ minimum: 1, maximum: 22 })
    expect(properties.url).toMatchObject({ minLength: 8, maxLength: 200 })
  })

  it('should turn cardinality into an array, and a number into a limit', () => {
    const properties = toJsonSchema(schema).properties!

    expect(properties.layers).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(properties.zooms).toMatchObject({ type: 'array', maxItems: 3 })
    expect(properties.layers.maxItems).toBeUndefined()
  })

  it('should require only what has no default', () => {
    // A declared default makes the value dispensable in the document, which is
    // the same rule validate() applies — anything else would call a
    // configuration invalid that tsm accepts
    expect(toJsonSchema(schema).required).toEqual(['url', 'scale', 'zooms'])
  })

  it('should carry titles and defaults onto the properties', () => {
    const properties = toJsonSchema(schema).properties!

    expect(properties.url.title).toBe('Tile URL')
    expect(properties.zoom.default).toBe(12)
    expect(properties.layers.default).toEqual(['road'])
  })

  it('should set an id only when one is given', () => {
    expect(toJsonSchema(schema).$id).toBeUndefined()
    expect(toJsonSchema(schema, { id: 'http://example.com/tiles' }).$id)
      .toBe('http://example.com/tiles')
  })

  describe('options', () => {
    const withOptions = objectClass({
      id: 'demo.mode',
      attributes: {
        mode: {
          type: 'string',
          options: [{ value: 'car', label: 'By car' }, { value: 'bike' }]
        },
        plain: { type: 'string', options: [{ value: 'a' }, { value: 'b' }] }
      }
    })

    it('should use enum, which is what a converter recognises', () => {
      const properties = toJsonSchema(withOptions).properties!

      expect(properties.mode.enum).toEqual(['car', 'bike'])
      expect(properties.plain.enum).toEqual(['a', 'b'])
    })

    it('should keep the labels beside it, since enum cannot hold them', () => {
      const properties = toJsonSchema(withOptions).properties!

      expect(properties.mode['x-tsm-option-labels']).toEqual({ car: 'By car' })
      expect(properties.plain['x-tsm-option-labels']).toBeUndefined()
    })
  })

  describe('what no schema language can express', () => {
    it('should name the attributes that carry a validator', () => {
      const validated = objectClass({
        id: 'demo.endpoint',
        attributes: {
          url: { type: 'string', validate: () => undefined },
          name: { type: 'string' }
        }
      })

      // A form cannot predict the rejection, but it can expect one
      expect(toJsonSchema(validated)['x-tsm-validated']).toEqual(['url'])
    })

    it('should say nothing when no attribute has one', () => {
      expect(toJsonSchema(schema)['x-tsm-validated']).toBeUndefined()
    })
  })

  describe('localization', () => {
    const localized = objectClass({
      id: 'demo.localized',
      name: '%title',
      attributes: { url: { type: 'string', name: '%url.name' } },
      localization: { de: { title: 'Kartenquelle', 'url.name': 'Kachel-URL' } }
    })

    it('should resolve the titles for a locale', () => {
      const result = toJsonSchema(localized, { locale: 'de' })

      expect(result.title).toBe('Kartenquelle')
      expect(result.properties!.url.title).toBe('Kachel-URL')
      // Already resolved, so the table would be dead weight
      expect(result['x-tsm-localization']).toBeUndefined()
    })

    it('should carry the tables along when no locale was chosen', () => {
      const result = toJsonSchema(localized)

      expect(result.title).toBe('%title')
      expect(result['x-tsm-localization']).toEqual({
        de: { title: 'Kartenquelle', 'url.name': 'Kachel-URL' }
      })
    })
  })
})

describe('toMetamodelSchema', () => {
  const tiles = objectClass({
    id: 'demo.tiles',
    attributes: { url: { type: 'string' } }
  })
  const sources = objectClass({
    id: 'demo.tile-source',
    attributes: {
      name: { type: 'string' },
      kind: {
        type: 'string',
        default: 'raster',
        options: [{ value: 'raster', label: 'Raster' }, { value: 'vector' }]
      }
    }
  })

  it('should put the classes under $defs, where a converter looks', () => {
    const result = toMetamodelSchema([tiles, sources])

    expect(Object.keys(result.$defs!)).toContain('DemoTiles')
    expect(result.$defs!.DemoTiles.type).toBe('object')
    // A top-level object schema is ignored by an EPackage converter
    expect(result.type).toBeUndefined()
  })

  it('should turn a PID into a class name and keep the original', () => {
    const result = toMetamodelSchema([sources])

    expect(result.$defs!.DemoTileSource['x-tsm-object-class']).toBe('demo.tile-source')
  })

  it('should number a name that would collide', () => {
    const other = objectClass({ id: 'demo-tiles', attributes: {} })

    const result = toMetamodelSchema([tiles, other])

    expect(Object.keys(result.$defs!)).toEqual(['DemoTiles', 'DemoTiles2'])
  })

  it('should lift an enumeration into a named definition', () => {
    const result = toMetamodelSchema([sources])

    // Otherwise the converter has to invent a name like ArtificialClassifier0
    expect(result.$defs!.DemoTileSourceKind.enum).toEqual(['raster', 'vector'])
    expect(result.$defs!.DemoTileSource.properties!.kind.$ref)
      .toBe('#/$defs/DemoTileSourceKind')
    expect(result.$defs!.DemoTileSource.properties!.kind.enum).toBeUndefined()
    // The value keeps its default and label even though the values moved out
    expect(result.$defs!.DemoTileSource.properties!.kind.default).toBe('raster')
    expect(result.$defs!.DemoTileSourceKind['x-tsm-option-labels']).toEqual({ raster: 'Raster' })
  })

  it('should name the package when asked, since the converter reads the title', () => {
    const result = toMetamodelSchema([tiles], {
      id: 'http://example.com/config',
      name: 'demoConfig'
    })

    expect(result.title).toBe('demoConfig')
    expect(result.$id).toBe('http://example.com/config')
    // Document-level keys belong to the bundle, not to the classes in it
    expect(result.$defs!.DemoTiles.$schema).toBeUndefined()
    expect(result.$defs!.DemoTiles.$id).toBeUndefined()
  })

  it('should read a whole registry, PIDs and factory PIDs alike', () => {
    const metatype = new MetatypeRegistry()
    metatype.designate('demo.tiles', tiles)
    metatype.designate('demo.tile-source', sources, { factory: true })

    const result = toMetamodelSchema(metatype, { name: 'demoConfig' })

    expect(Object.keys(result.$defs!).sort())
      .toEqual(['DemoTileSource', 'DemoTileSourceKind', 'DemoTiles'])
  })

  it('should resolve a locale across the whole metamodel', () => {
    const metatype = new MetatypeRegistry()
    metatype.designate('demo.localized', objectClass({
      id: 'demo.localized',
      name: '%title',
      attributes: {},
      localization: { de: { title: 'Kartenquelle' } }
    }))

    const result = toMetamodelSchema(metatype, { locale: 'de' })

    expect(result.$defs!.DemoLocalized.title).toBe('Kartenquelle')
  })
})
