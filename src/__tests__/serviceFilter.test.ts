import { describe, it, expect } from 'vitest'
import { createServiceFilter } from '../serviceFilter'

describe('createServiceFilter', () => {
  const chart = { kind: 'chart', label: 'chart-widget', 'service.ranking': 10, experimental: false }

  function matches(
    expression: string,
    properties: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>> = chart
  ) {
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

  describe('OSGi semantics', () => {
    it('should match attribute names case-insensitively', () => {
      expect(matches('(KIND=chart)')).toBe(true)
      expect(matches('(Service.Ranking>=10)')).toBe(true)
    })

    it('should compare by the type of the property, not by the filter text', () => {
      // A string property compares lexically even though both sides parse as numbers:
      // '9' >= '10' holds lexically, 9 >= 10 does not
      expect(matches('(version>=10)', { version: '9' })).toBe(true)
      expect(matches('(version>=10)', { version: 9 })).toBe(false)
      expect(matches('(version<=10)', { version: 9 })).toBe(true)
    })

    it('should give booleans no ordering', () => {
      expect(matches('(experimental=false)', { experimental: false })).toBe(true)
      expect(matches('(experimental>=false)', { experimental: false })).toBe(false)
      expect(matches('(experimental<=true)', { experimental: true })).toBe(false)
    })

    it('should match an array property when any element matches', () => {
      const properties = { kinds: ['chart', 'table'], sizes: [1, 5] }

      expect(matches('(kinds=chart)', properties)).toBe(true)
      expect(matches('(kinds=table)', properties)).toBe(true)
      expect(matches('(kinds=map)', properties)).toBe(false)
      expect(matches('(sizes>=5)', properties)).toBe(true)
      expect(matches('(sizes>=6)', properties)).toBe(false)
      expect(matches('(kinds=cha*)', properties)).toBe(true)
      expect(matches('(kinds=*)', properties)).toBe(true)
    })

    it('should ignore whitespace and case for approximate match', () => {
      expect(matches('(kind~=CHART)')).toBe(true)
      expect(matches('(label~=chart - widget)', { label: 'Chart-Widget' })).toBe(true)
      expect(matches('(kind~=table)')).toBe(false)
    })

    it('should apply approximate match to numbers as text', () => {
      expect(matches('(service.ranking~=10)')).toBe(true)
      expect(matches('(service.ranking~=11)')).toBe(false)
    })

    it('should not match a missing property with any operator', () => {
      expect(matches('(missing=x)')).toBe(false)
      expect(matches('(missing>=1)')).toBe(false)
      expect(matches('(missing~=x)')).toBe(false)
      expect(matches('(missing=*)')).toBe(false)
    })

    it('should trim the filter value for numeric comparison', () => {
      expect(matches('(service.ranking>= 10 )')).toBe(true)
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
      expect(() => createServiceFilter('(kind=chart)(x=y)')).toThrow('trailing input')
    })

    it('should include the expression in the message', () => {
      expect(() => createServiceFilter('(kind')).toThrow("'(kind'")
    })
  })
})
