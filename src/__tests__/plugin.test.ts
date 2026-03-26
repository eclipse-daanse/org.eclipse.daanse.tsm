import { describe, it, expect } from 'vitest'
import { transformTsmImports } from '../vite/plugin'

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
