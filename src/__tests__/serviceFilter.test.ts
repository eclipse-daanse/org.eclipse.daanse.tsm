import { describe, it, expect } from 'vitest'
import { createServiceFilter } from '../serviceFilter'

describe('createServiceFilter', () => {
  const chart = { kind: 'chart', label: 'chart-widget', 'service.ranking': 10, experimental: false }

  function matches(expression: string, properties: Record<string, string | number | boolean> = chart) {
    return createServiceFilter(expression)(properties)
  }

  describe('simple items', () => {
    it('should match equality on strings', () => {
      expect(matches('(kind=chart)')).toBe(true)
      expect(matches('(kind=table)')).toBe(false)
    })

    it('should match equality on numbers and booleans', () => {
      expect(matches('(service.ranking=10)')).toBe(true)
      expect(matches('(service.ranking=5)')).toBe(false)
      expect(matches('(experimental=false)')).toBe(true)
      expect(matches('(experimental=true)')).toBe(false)
    })

    it('should treat a missing property as no match', () => {
      expect(matches('(missing=anything)')).toBe(false)
    })

    it('should test presence with =*', () => {
      expect(matches('(kind=*)')).toBe(true)
      expect(matches('(missing=*)')).toBe(false)
    })

    it('should match substrings', () => {
      expect(matches('(label=chart*)')).toBe(true)
      expect(matches('(label=*widget)')).toBe(true)
      expect(matches('(label=*art-wid*)')).toBe(true)
      expect(matches('(label=table*)')).toBe(false)
    })

    it('should compare numerically with >= and <=', () => {
      expect(matches('(service.ranking>=10)')).toBe(true)
      expect(matches('(service.ranking>=11)')).toBe(false)
      expect(matches('(service.ranking<=10)')).toBe(true)
      expect(matches('(service.ranking<=9)')).toBe(false)
    })

    it('should compare strings lexically when they are not numbers', () => {
      expect(matches('(kind>=chart)')).toBe(true)
      expect(matches('(kind>=table)')).toBe(false)
    })
  })

  describe('operators', () => {
    it('should support and', () => {
      expect(matches('(&(kind=chart)(service.ranking>=10))')).toBe(true)
      expect(matches('(&(kind=chart)(service.ranking>=11))')).toBe(false)
    })

    it('should support or', () => {
      expect(matches('(|(kind=table)(kind=chart))')).toBe(true)
      expect(matches('(|(kind=table)(kind=map))')).toBe(false)
    })

    it('should support not', () => {
      expect(matches('(!(kind=table))')).toBe(true)
      expect(matches('(!(kind=chart))')).toBe(false)
    })

    it('should nest operators', () => {
      expect(matches('(&(|(kind=chart)(kind=table))(!(experimental=true)))')).toBe(true)
    })

    it('should ignore whitespace between parts', () => {
      expect(matches('( & (kind=chart) (experimental=false) )')).toBe(true)
    })
  })

  describe('escaping', () => {
    it('should take an escaped character literally', () => {
      expect(matches('(label=chart\\*widget)', { label: 'chart*widget' })).toBe(true)
      expect(matches('(label=chart\\*widget)', { label: 'chart-widget' })).toBe(false)
    })

    it('should allow escaped parentheses in a value', () => {
      expect(matches('(label=a\\(b\\))', { label: 'a(b)' })).toBe(true)
    })
  })

  describe('rejecting invalid input', () => {
    it('should name the problem instead of matching nothing', () => {
      expect(() => createServiceFilter('kind=chart')).toThrow("expected '('")
      expect(() => createServiceFilter('(kind=chart')).toThrow("expected ')'")
      expect(() => createServiceFilter('(=chart)')).toThrow('missing attribute name')
      expect(() => createServiceFilter('(&)')).toThrow('operator without operands')
      expect(() => createServiceFilter('(kind~=chart)')).toThrow('approximate match')
      expect(() => createServiceFilter('(kind=chart)(x=y)')).toThrow('trailing input')
    })

    it('should include the expression in the message', () => {
      expect(() => createServiceFilter('(kind')).toThrow("'(kind'")
    })
  })
})
