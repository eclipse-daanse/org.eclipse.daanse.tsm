import { describe, it, expect } from 'vitest'
import { ComponentScanError, extractComponents } from '../vite/componentScan'

describe('extractComponents', () => {
  it('should find a component with a literal service id', () => {
    const code = `
      @component({ service: ['ui.component'] })
      export class Widget {}
    `

    expect(extractComponents(code)).toEqual([
      {
        name: 'Widget',
        line: 2,
        services: [{ id: 'ui.component' }],
        immediate: false,
        exported: true
      }
    ])
  })

  it('should read a service id from a constant in the same file', () => {
    const code = `
      const UI_COMPONENT = 'ui.component'

      @component({ service: [UI_COMPONENT] })
      export class Widget {}
    `

    expect(extractComponents(code)[0].services).toEqual([{ id: 'ui.component' }])
  })

  it('should read a service id from an imported constant', () => {
    const code = `
      import { UI_COMPONENT } from './contracts.js'

      @component({ service: [UI_COMPONENT] })
      export class Widget {}
    `
    const contracts = `export const UI_COMPONENT = 'ui.component'`

    const found = extractComponents(code, specifier =>
      specifier === './contracts.js' ? contracts : undefined
    )

    expect(found[0].services).toEqual([{ id: 'ui.component' }])
  })

  it('should read properties and ranking', () => {
    const code = `
      @component({
        service: ['ui.component'],
        properties: { region: 'main', order: 3, experimental: false },
        ranking: 10
      })
      export class Widget {}
    `

    expect(extractComponents(code)[0].services).toEqual([{
      id: 'ui.component',
      ranking: 10,
      properties: { region: 'main', order: 3, experimental: false }
    }])
  })

  it('should read a negative ranking', () => {
    const code = `
      @component({ service: ['fallback'], ranking: -5 })
      export class Fallback {}
    `

    expect(extractComponents(code)[0].services[0].ranking).toBe(-5)
  })

  it('should give each id its own properties from propertiesById', () => {
    const code = `
      @component({
        service: ['chart.renderer', 'ui.component'],
        properties: { engine: 'canvas' },
        propertiesById: { 'ui.component': { region: 'main' } }
      })
      export class ChartRenderer {}
    `

    expect(extractComponents(code)[0].services).toEqual([
      { id: 'chart.renderer', properties: { engine: 'canvas' } },
      { id: 'ui.component', properties: { region: 'main' } }
    ])
  })

  it('should mark a component with an activate method as immediate', () => {
    const code = `
      @component({ service: ['clock'] })
      export class ClockView {
        @activate()
        start() {}
      }
    `

    expect(extractComponents(code)[0].immediate).toBe(true)
  })

  it('should honour an explicit immediate flag', () => {
    const code = `
      @component({ service: ['eager'], immediate: true })
      export class Eager {}
    `

    expect(extractComponents(code)[0].immediate).toBe(true)
  })

  it('should find a component that offers no service', () => {
    const code = `
      @component()
      export class Background {
        @activate() start() {}
      }
    `

    expect(extractComponents(code)).toEqual([
      { name: 'Background', line: 2, services: [], immediate: true, exported: true }
    ])
  })

  it('should find several components in one file', () => {
    const code = `
      @component({ service: ['first'] })
      export class First {}

      @component({ service: ['second'] })
      export class Second {}
    `

    expect(extractComponents(code).map(entry => entry.name)).toEqual(['First', 'Second'])
  })

  it('should ignore classes and decorators that are not components', () => {
    const code = `
      @injectable()
      export class Service {}

      export class Plain {}
    `

    expect(extractComponents(code)).toEqual([])
  })

  it('should ignore a file without the decorator at all', () => {
    expect(extractComponents(`export const x = 1`)).toEqual([])
  })

  it('should report an id it cannot read', () => {
    const code = `
      @component({ service: [SOME_MODULE.ID] })
      export class Widget {}
    `

    expect(() => extractComponents(code)).toThrow(ComponentScanError)
    expect(() => extractComponents(code)).toThrow(/cannot be read at build time/)
  })

  it('should report an imported id whose module is unavailable', () => {
    const code = `
      import { UI_COMPONENT } from './missing.js'

      @component({ service: [UI_COMPONENT] })
      export class Widget {}
    `

    expect(() => extractComponents(code)).toThrow(/cannot be read at build time/)
  })

  it('should reject a non-literal options argument', () => {
    const code = `
      const options = { service: ['x'] }

      @component(options)
      export class Widget {}
    `

    expect(() => extractComponents(code)).toThrow(/object literal/)
  })

  it('should reject a service list that is not an array literal', () => {
    const code = `
      const ids = ['x']

      @component({ service: ids })
      export class Widget {}
    `

    expect(() => extractComponents(code)).toThrow(/array literal/)
  })

  it('should note whether the class is exported', () => {
    const exported = `
      @component({ service: ['a'] })
      export class Exported {}
    `
    const hidden = `
      @component({ service: ['b'] })
      class Hidden {}
    `

    // The loader finds components in the module namespace, so this is decidable
    // here and nowhere at runtime
    expect(extractComponents(exported)[0].exported).toBe(true)
    expect(extractComponents(hidden)[0].exported).toBe(false)
  })

  it('should note a default export as exported', () => {
    const code = `
      @component({ service: ['a'] })
      export default class Widget {}
    `

    expect(extractComponents(code)[0].exported).toBe(true)
  })

  it('should report the line of the declaration', () => {
    const code = [
      '// header',
      '',
      '@component({ service: [\'late\'] })',
      'export class Late {}'
    ].join('\n')

    expect(extractComponents(code)[0].line).toBe(3)
  })
})

describe('numbers a declaration can carry', () => {
  it('reads a negative ranking', () => {
    // A provider that means to lose against the default — ranking 0 — and a
    // perfectly ordinary thing to declare
    const [found] = extractComponents(`
      @component({ service: ['demo.fallback'], ranking: -10 })
      export class Fallback {}
    `)

    expect(found.services).toEqual([{ id: 'demo.fallback', ranking: -10 }])
  })

  it('reads a negative number in properties', () => {
    const [found] = extractComponents(`
      @component({ service: ['demo.tiles'], properties: { offset: -1, zoom: 3 } })
      export class Tiles {}
    `)

    expect(found.services[0].properties).toEqual({ offset: -1, zoom: 3 })
  })

  it('leaves an expression it cannot evaluate out of the properties', () => {
    // A computed value has no build-time answer, and guessing would put
    // something in the manifest the component never declared
    const [found] = extractComponents(`
      @component({ service: ['demo.tiles'], properties: { computed: 1 + 1, kept: 'yes' } })
      export class Tiles {}
    `)

    expect(found.services[0].properties).toEqual({ kept: 'yes' })
  })
})

describe('a property key that is computed', () => {
  it('resolves it through a constant', () => {
    // `properties: { [KEY]: 'x' }` — the key itself comes from a constant, which
    // is how a contract keeps its property names in one place
    const [found] = extractComponents(`
      const REGION = 'widget.region'
      @component({ service: ['ui.component'], properties: { [REGION]: 'sidebar' } })
      export class Panel {}
    `)

    expect(found.services[0].properties).toEqual({ 'widget.region': 'sidebar' })
  })

  it('leaves out a computed key it cannot read', () => {
    const [found] = extractComponents(`
      @component({ service: ['ui.component'], properties: { [Symbol.iterator]: 'x', kept: 1 } })
      export class Panel {}
    `)

    expect(found.services[0].properties).toEqual({ kept: 1 })
  })
})
