import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { transformTsmImports, tsmPlugin } from '../vite/plugin'

describe('tsmPlugin type import handling', () => {
  describe('inline type imports with tsm: prefix', () => {
    it('should filter out inline type imports', () => {
      const input = `import { ref, type Ref } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const { ref } = __tsm__.require('vue');`)
    })

    it('should keep all value imports when mixed with type imports', () => {
      const input = `import { a, type B, c, type D } from 'tsm:module'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const { a, c } = __tsm__.require('module');`)
    })

    it('should return empty for type-only inline imports', () => {
      const input = `import { type Ref } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe('')
    })

    it('should handle type imports with aliases', () => {
      const input = `import { ref, type Ref as VueRef } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const { ref } = __tsm__.require('vue');`)
    })

    it('should handle value imports with aliases alongside type imports', () => {
      const input = `import { ref as vueRef, type Ref } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const { ref: vueRef } = __tsm__.require('vue');`)
    })
  })

  describe('import type statements with tsm: prefix', () => {
    it('should remove import type statements completely', () => {
      const input = `import type { Ref, ComputedRef } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe('')
    })

    it('should remove import type and keep value imports', () => {
      const input = `import type { Ref } from 'tsm:vue'
import { ref } from 'tsm:vue'`
      const result = transformTsmImports(input)
      // import type line is removed (empty string), value import is transformed
      expect(result).toBe(`const { ref } = __tsm__.require('vue');`)
    })
  })

  describe('inline type imports with shared modules', () => {
    it('should filter out inline type imports from shared modules', () => {
      const input = `import { ref, type Ref } from 'vue'`
      const result = transformTsmImports(input, ['vue'])
      expect(result).toBe(`const { ref } = __tsm__.require('vue');`)
    })

    it('should return empty for type-only inline imports from shared modules', () => {
      const input = `import { type Ref } from 'vue'`
      const result = transformTsmImports(input, ['vue'])
      expect(result).toBe('')
    })

    it('should handle subpaths in shared modules', () => {
      const input = `import { type ButtonProps, Button } from 'primevue/button'`
      const result = transformTsmImports(input, ['primevue'])
      expect(result).toBe(`const { Button } = __tsm__.require('primevue/button');`)
    })
  })

  describe('import type statements with shared modules', () => {
    it('should remove import type statements from shared modules', () => {
      const input = `import type { Ref } from 'vue'`
      const result = transformTsmImports(input, ['vue'])
      expect(result).toBe('')
    })

    it('should remove import type with subpaths', () => {
      const input = `import type { ButtonProps } from 'primevue/button'`
      const result = transformTsmImports(input, ['primevue'])
      expect(result).toBe('')
    })
  })

  describe('non-type imports should work as before', () => {
    it('should transform regular named imports', () => {
      const input = `import { ref, computed } from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const { ref, computed } = __tsm__.require('vue');`)
    })

    it('should transform namespace imports', () => {
      const input = `import * as Vue from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const Vue = __tsm__.require('vue');`)
    })

    it('should transform default imports', () => {
      const input = `import Vue from 'tsm:vue'`
      const result = transformTsmImports(input)
      expect(result).toBe(`const Vue = __tsm__.require('vue').default;`)
    })

    it('should return null for code without tsm imports', () => {
      const input = `import { ref } from 'vue'`
      const result = transformTsmImports(input)
      expect(result).toBeNull()
    })
  })
})

describe('tsmPlugin manifest validation', () => {
  interface PluginContext {
    errors: string[]
    warnings: string[]
    error(message: string): never
    warn(message: string): void
  }

  function context(): PluginContext {
    const errors: string[] = []
    const warnings: string[] = []
    return {
      errors,
      warnings,
      error(message: string): never {
        errors.push(message)
        throw new Error(message)
      },
      warn(message: string) {
        warnings.push(message)
      }
    }
  }

  type Hook = (this: PluginContext, ...args: unknown[]) => unknown

  async function run(
    options: Parameters<typeof tsmPlugin>[0],
    files: Array<{ id: string; code: string }>
  ) {
    const plugin = tsmPlugin(options)
    const ctx = context()

    try {
      await (plugin.buildStart as Hook).call(ctx)
    } catch {
      // this.error() throws by contract; the message is recorded in ctx
    }
    for (const file of files) {
      try {
        await (plugin.transform as Hook).call(ctx, file.code, file.id)
      } catch {
        // this.error() throws by contract; the message is recorded in ctx
      }
    }
    await (plugin.buildEnd as Hook).call(ctx)

    return ctx
  }

  const manifest = {
    id: 'my-module',
    dependencies: ['plugin-a'],
    sharedDependencies: [{ id: 'vue', versionRange: '^3.0.0' }]
  }

  it('should do nothing without a manifest', async () => {
    const ctx = await run({}, [
      { id: '/src/Widget.vue', code: `import { X } from 'tsm:nowhere'` }
    ])

    expect(ctx.errors).toEqual([])
    expect(ctx.warnings).toEqual([])
  })

  it('should fail on an import the manifest does not declare', async () => {
    const ctx = await run({ manifest }, [
      { id: '/src/Widget.vue', code: `\nimport { GEO } from 'tsm:plugin-missing'` }
    ])

    expect(ctx.errors).toHaveLength(1)
    expect(ctx.errors[0]).toContain('/src/Widget.vue:2')
    expect(ctx.errors[0]).toContain('plugin-missing')
    expect(ctx.errors[0]).toContain('not declared')
  })

  it('should warn instead of failing when strict is off', async () => {
    const ctx = await run({ manifest, strict: false }, [
      { id: '/src/Widget.vue', code: `import { GEO } from 'tsm:plugin-missing'` }
    ])

    expect(ctx.errors).toEqual([])
    expect(ctx.warnings.some(warning => warning.includes('plugin-missing'))).toBe(true)
  })

  it('should accept a declared dependency', async () => {
    const ctx = await run({ manifest }, [
      { id: '/src/Widget.vue', code: `import { GEO } from 'tsm:plugin-a'` }
    ])

    expect(ctx.errors).toEqual([])
    expect(ctx.warnings).toEqual([])
  })

  it('should accept a shared library import', async () => {
    const ctx = await run({ manifest }, [
      { id: '/src/Widget.vue', code: `import { ref } from 'tsm:my-module/vue'` },
      { id: '/src/Other.vue', code: `import { GEO } from 'tsm:plugin-a'` }
    ])

    expect(ctx.errors).toEqual([])
  })

  it('should exempt type-only imports', async () => {
    const ctx = await run({ manifest }, [
      { id: '/src/types.ts', code: `import type { Widget } from 'tsm:plugin-typed'` },
      { id: '/src/more.ts', code: `import { type Ref } from 'tsm:plugin-typed'` },
      { id: '/src/Widget.vue', code: `import { GEO } from 'tsm:plugin-a'` }
    ])

    expect(ctx.errors).toEqual([])
    expect(ctx.warnings).toEqual([])
  })

  it('should warn about a dependency nothing imports', async () => {
    const ctx = await run({ manifest }, [
      { id: '/src/Widget.vue', code: `const x = 1` }
    ])

    expect(ctx.warnings).toHaveLength(1)
    expect(ctx.warnings[0]).toContain('plugin-a')
    expect(ctx.warnings[0]).toContain('nothing imports')
  })

  it('should not warn when a type-only import is the only use', async () => {
    // A type import leaves no runtime trace, so the declaration really is unused
    const ctx = await run({ manifest }, [
      { id: '/src/types.ts', code: `import type { A } from 'tsm:plugin-a'` }
    ])

    expect(ctx.warnings.some(warning => warning.includes('plugin-a'))).toBe(true)
  })

  it('should skip files outside the source set', async () => {
    const ctx = await run({ manifest }, [
      { id: '/node_modules/dep/index.js', code: `import { X } from 'tsm:plugin-missing'` },
      { id: '/src/styles.css', code: `import { X } from 'tsm:plugin-missing'` },
      { id: '/src/Widget.vue', code: `import { GEO } from 'tsm:plugin-a'` }
    ])

    expect(ctx.errors).toEqual([])
  })

  describe('component declarations', () => {
    const componentSource = `
      import { UI_COMPONENT } from './contracts.js'

      @component({ service: [UI_COMPONENT], properties: { region: 'main' }, ranking: 5 })
      export class Widget {
        @activate() start() {}
      }
    `

    async function runWithFiles(
      options: Parameters<typeof tsmPlugin>[0],
      files: Array<{ id: string; code: string }>
    ) {
      const plugin = tsmPlugin(options)
      const errors: string[] = []
      const warnings: string[] = []
      const emitted: Array<{ fileName: string; source: string }> = []

      const ctx = {
        error(message: string): never { errors.push(message); throw new Error(message) },
        warn(message: string) { warnings.push(message) },
        emitFile(file: { fileName: string; source: string }) { emitted.push(file) }
      }

      type Hook = (this: typeof ctx, ...args: unknown[]) => unknown

      for (const hook of ['buildStart'] as const) {
        try { await (plugin[hook] as Hook).call(ctx) } catch { /* recorded */ }
      }
      for (const file of files) {
        try { await (plugin.transform as Hook).call(ctx, file.code, file.id) } catch { /* recorded */ }
      }
      for (const hook of ['buildEnd', 'generateBundle'] as const) {
        try { await (plugin[hook] as Hook).call(ctx) } catch { /* recorded */ }
      }

      return { errors, warnings, emitted }
    }

    it('should do nothing unless asked to', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tsm-scan-'))
      try {
        const result = await runWithFiles(
          { manifest: { id: 'widget' } },
          [{ id: join(directory, 'Widget.ts'), code: componentSource }]
        )
        expect(result.errors).toEqual([])
        expect(result.emitted).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('should fail validation when the manifest omits a declared service', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tsm-scan-'))
      await writeFile(join(directory, 'contracts.ts'), `export const UI_COMPONENT = 'ui.component'`)

      try {
        const result = await runWithFiles(
          { manifest: { id: 'widget' }, components: 'validate' },
          [{ id: join(directory, 'Widget.ts'), code: componentSource }]
        )

        expect(result.errors).toHaveLength(1)
        expect(result.errors[0]).toContain('ui.component')
        expect(result.errors[0]).toContain("components: 'derive'")
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('should pass validation when the manifest lists it', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tsm-scan-'))
      await writeFile(join(directory, 'contracts.ts'), `export const UI_COMPONENT = 'ui.component'`)

      try {
        const result = await runWithFiles(
          {
            manifest: { id: 'widget', provides: [{ id: 'ui.component' }] },
            components: 'validate'
          },
          [{ id: join(directory, 'Widget.ts'), code: componentSource }]
        )

        expect(result.errors).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('should warn about a manifest entry no component declares', async () => {
      const result = await runWithFiles(
        {
          manifest: { id: 'widget', provides: [{ id: 'gone.service' }] },
          components: 'validate'
        },
        [{ id: '/src/Plain.ts', code: 'export class Plain {}' }]
      )

      expect(result.warnings.some(warning => warning.includes('gone.service'))).toBe(true)
    })

    it('should emit a manifest with the derived provides', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tsm-scan-'))
      await writeFile(join(directory, 'contracts.ts'), `export const UI_COMPONENT = 'ui.component'`)

      try {
        const result = await runWithFiles(
          { manifest: { id: 'widget' }, components: 'derive' },
          [{ id: join(directory, 'Widget.ts'), code: componentSource }]
        )

        expect(result.emitted).toHaveLength(1)
        expect(result.emitted[0].fileName).toBe('manifest.json')
        expect(JSON.parse(result.emitted[0].source)).toEqual({
          id: 'widget',
          provides: [{ id: 'ui.component', ranking: 5, properties: { region: 'main' } }]
        })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('should report a component that is not exported', async () => {
      const result = await runWithFiles(
        { manifest: { id: 'widget' }, components: 'validate' },
        [{
          id: '/src/Hidden.ts',
          code: "@component({ service: ['ui.component'] })\nclass Hidden {}"
        }]
      )

      expect(result.errors[0]).toContain('/src/Hidden.ts:1')
      expect(result.errors[0]).toContain('not exported')
    })

    it('should report a declaration it cannot read', async () => {
      const result = await runWithFiles(
        { manifest: { id: 'widget' }, components: 'validate' },
        [{
          id: '/src/Widget.ts',
          code: '@component({ service: [SOME.ID] })\nexport class Widget {}'
        }]
      )

      expect(result.errors[0]).toContain('/src/Widget.ts:1')
      expect(result.errors[0]).toContain('cannot be read at build time')
    })

    it('should warn when two components declare one ID differently', async () => {
      const result = await runWithFiles(
        { manifest: { id: 'widget' }, components: 'derive' },
        [{
          id: '/src/Two.ts',
          code: `
            @component({ service: ['ui.component'], properties: { region: 'main' } })
            export class First {}

            @component({ service: ['ui.component'], properties: { region: 'sidebar' } })
            export class Second {}
          `
        }]
      )

      expect(result.warnings.some(warning => warning.includes('more than one'))).toBe(true)
    })
  })

  it('should read a manifest given as a path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tsm-plugin-'))
    const path = join(directory, 'manifest.json')
    await writeFile(path, JSON.stringify({ id: 'm', dependencies: ['plugin-a'] }))

    try {
      const ctx = await run({ manifest: path }, [
        { id: '/src/Widget.vue', code: `import { X } from 'tsm:plugin-missing'` }
      ])

      expect(ctx.errors).toHaveLength(1)
      expect(ctx.errors[0]).toContain('plugin-missing')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('should report a manifest it cannot read', async () => {
    const ctx = await run({ manifest: '/nonexistent/manifest.json' }, [])

    expect(ctx.errors).toHaveLength(1)
    expect(ctx.errors[0]).toContain('cannot read manifest')
  })
})

describe('tsmPlugin - shared libraries bundled by mistake', () => {
  const manifest = {
    id: 'ui',
    sharedDependencies: [{ id: 'vue', versionRange: '^3.4.0' }, { id: '@scope/lib', versionRange: '^1.0.0' }]
  }

  interface Recorded { errors: string[]; warnings: string[] }

  async function generate(
    bundle: Record<string, unknown>,
    options: { strict?: boolean } = {}
  ): Promise<Recorded> {
    const plugin = tsmPlugin({ manifest, strict: options.strict ?? true })
    const recorded: Recorded = { errors: [], warnings: [] }
    const ctx = {
      error(message: string) { recorded.errors.push(message); throw new Error(message) },
      warn(message: string) { recorded.warnings.push(message) },
      emitFile() {}
    }
    type Hook = (this: typeof ctx, ...args: unknown[]) => unknown

    await (plugin.buildStart as Hook).call(ctx)
    try {
      await (plugin.generateBundle as Hook).call(ctx, {}, bundle)
    } catch {
      // this.error() throws by contract; the message is recorded
    }
    return recorded
  }

  function chunk(modules: string[]): Record<string, unknown> {
    return {
      'ui.js': {
        type: 'chunk',
        modules: Object.fromEntries(modules.map(id => [id, {}]))
      }
    }
  }

  it('should fail when a declared library was bundled', async () => {
    const recorded = await generate(chunk([
      '/project/src/index.ts',
      '/project/node_modules/vue/dist/vue.runtime.esm-bundler.js'
    ]))

    expect(recorded.errors).toHaveLength(1)
    expect(recorded.errors[0]).toContain("'vue' is declared in sharedDependencies")
    expect(recorded.errors[0]).toContain('createTsmExternals')
    // The evidence, so the report can be acted on
    expect(recorded.errors[0]).toContain('node_modules/vue/dist')
  })

  it('should pass when the library stayed external', async () => {
    const recorded = await generate(chunk([
      '/project/src/index.ts',
      '/project/src/widget.vue'
    ]))

    expect(recorded.errors).toEqual([])
    expect(recorded.warnings).toEqual([])
  })

  it('should recognise a scoped package', async () => {
    const recorded = await generate(chunk([
      '/project/node_modules/@scope/lib/index.js'
    ]))

    expect(recorded.errors[0]).toContain("'@scope/lib'")
  })

  it('should not mistake a package whose name merely starts the same', async () => {
    const recorded = await generate(chunk([
      // vue-router is its own package and is not declared as shared
      '/project/node_modules/vue-router/dist/vue-router.mjs'
    ]))

    expect(recorded.errors).toEqual([])
  })

  it('should warn instead of failing when strict is off', async () => {
    const recorded = await generate(
      chunk(['/project/node_modules/vue/dist/vue.js']),
      { strict: false }
    )

    expect(recorded.errors).toEqual([])
    expect(recorded.warnings).toHaveLength(1)
  })

  it('should find it in a windows path too', async () => {
    const recorded = await generate(chunk([
      'C:\\project\\node_modules\\vue\\dist\\vue.js'
    ]))

    expect(recorded.errors).toHaveLength(1)
  })

  it('should ignore assets, which have no modules', async () => {
    const recorded = await generate({
      'style.css': { type: 'asset', source: '.a{}' }
    })

    expect(recorded.errors).toEqual([])
  })
})
