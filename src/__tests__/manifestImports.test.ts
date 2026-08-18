import { describe, it, expect } from 'vitest'
import {
  collectTsmImports,
  declaredIds,
  isDeclared,
  requiredDependencyIds
} from '../vite/manifestImports'

describe('collectTsmImports', () => {
  it('should find named, namespace, default and side-effect imports', () => {
    const code = [
      `import { GEO_SERVICE } from 'tsm:plugin-a'`,
      `import * as widgets from 'tsm:plugin-b'`,
      `import Chart from 'tsm:plugin-c'`,
      `import 'tsm:plugin-d'`
    ].join('\n')

    expect(collectTsmImports(code).map(reference => reference.moduleId))
      .toEqual(['plugin-a', 'plugin-b', 'plugin-c', 'plugin-d'])
  })

  it('should report the line of each import', () => {
    const code = [
      `// header`,
      ``,
      `import { a } from 'tsm:plugin-a'`,
      `const x = 1`,
      `import { b } from 'tsm:plugin-b'`
    ].join('\n')

    expect(collectTsmImports(code).map(reference => reference.line)).toEqual([3, 5])
  })

  it('should split module ID from subpath', () => {
    const [reference] = collectTsmImports(`import { ref } from 'tsm:my-app/vue'`)

    expect(reference.moduleId).toBe('my-app')
    expect(reference.specifier).toBe('my-app/vue')
  })

  it('should mark type-only imports', () => {
    const code = [
      `import type { Widget } from 'tsm:plugin-a'`,
      `import { type Ref, type Computed } from 'tsm:plugin-b'`,
      `import { type Ref, watch } from 'tsm:plugin-c'`
    ].join('\n')

    expect(collectTsmImports(code).map(reference => [reference.moduleId, reference.typeOnly]))
      .toEqual([['plugin-a', true], ['plugin-b', true], ['plugin-c', false]])
  })

  it('should handle a multi-line import clause', () => {
    const code = `import {\n  first,\n  second\n} from 'tsm:plugin-a'`

    expect(collectTsmImports(code)).toEqual([
      expect.objectContaining({ moduleId: 'plugin-a', line: 1, typeOnly: false })
    ])
  })

  it('should ignore files without tsm imports', () => {
    expect(collectTsmImports(`import { ref } from 'vue'`)).toEqual([])
  })
})

describe('declaredIds and isDeclared', () => {
  const manifest = {
    dependencies: ['plugin-a', { id: 'plugin-b' }],
    optionalDependencies: ['plugin-opt'],
    sharedDependencies: [{ id: 'vue' }]
  }

  function reference(specifier: string) {
    return { specifier, moduleId: specifier.split('/')[0], line: 1, typeOnly: false }
  }

  it('should collect dependencies, optional ones and shared libraries', () => {
    expect([...declaredIds(manifest)].sort())
      .toEqual(['plugin-a', 'plugin-b', 'plugin-opt', 'vue'])
  })

  it('should list only mandatory dependencies as required', () => {
    expect(requiredDependencyIds(manifest)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('should accept an import matching a declared module', () => {
    expect(isDeclared(reference('plugin-a'), declaredIds(manifest))).toBe(true)
    expect(isDeclared(reference('plugin-b'), declaredIds(manifest))).toBe(true)
    expect(isDeclared(reference('plugin-opt'), declaredIds(manifest))).toBe(true)
  })

  it('should accept a subpath import via its module or its library', () => {
    // 'tsm:my-app/vue' — the manifest may name either side
    expect(isDeclared(reference('my-app/vue'), declaredIds(manifest))).toBe(true)
    expect(isDeclared(reference('plugin-a/ui'), declaredIds(manifest))).toBe(true)
  })

  it('should reject an import nothing declares', () => {
    expect(isDeclared(reference('plugin-unknown'), declaredIds(manifest))).toBe(false)
    expect(isDeclared(reference('plugin-unknown/ui'), declaredIds(manifest))).toBe(false)
  })
})
