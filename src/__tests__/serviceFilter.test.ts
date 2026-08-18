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
      // '&' without a nested filter is an attribute name, so what is missing is the operator
      expect(() => createServiceFilter('(&)')).toThrow('expected =')
      expect(() => createServiceFilter('(&(a=1)')).toThrow("expected ')'")
      expect(() => createServiceFilter('(kind=chart)(x=y)')).toThrow('trailing input')
    })

    it('should include the expression in the message', () => {
      expect(() => createServiceFilter('(kind')).toThrow("'(kind'")
    })
  })
})

/**
 * Cases taken from the OSGi framework TCK, org.osgi.test.cases.framework
 * junit/filter/AbstractFilterTests.java (Apache-2.0), so conformance is checked
 * against the reference suite rather than against my reading of the spec.
 *
 * Left out are property types this registry has no equivalent for: Character,
 * BigInteger/BigDecimal as distinct types, Version, arbitrary Comparable, and a
 * property holding an opaque object. Everything expressible with string, number,
 * boolean and arrays of those is kept verbatim.
 */
describe('OSGi TCK filter cases', () => {
  // Mirrors AbstractFilterTests.getProperties(), reduced to representable types
  const props: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>> = {
    room: 'bedroom',
    channel: [34, '101'],
    status: '(on\\)*',
    'max record time': [150, '100'],
    canrecord: 'true(x)',
    shortvalue: 1000,
    intvalue: 100000,
    longvalue: 10000000000,
    bytevalue: 10,
    floatvalue: 1.01,
    doublevalue: 2.01,
    booleanvalue: true,
    primintarrayvalue: [1, 2, 3],
    primlongarrayvalue: [1, 2, 3],
    primbytearrayvalue: [1, 2, 3],
    primshortarrayvalue: [1, 2, 3],
    primfloatarrayvalue: [1.1, 2.2, 3.3],
    primdoublearrayvalue: [1.1, 2.2, 3.3],
    primbooleanarrayvalue: [false],
    bigintvalue: 4123456,
    bigdecvalue: 4.123456,
    '*': 'foo',
    '!  ab': 'b',
    '|   ab': 'b',
    '&    ab': 'b',
    '!': 'c',
    '|': 'c',
    '&': 'c',
    empty: '',
    space: ' '
  }

  function matches(expression: string): boolean {
    return createServiceFilter(expression)(props)
  }

  describe('matching (testCaseInsensitive / testCaseSensitive)', () => {
    const shouldMatch = [
      '(room=*)',
      '(room=bedroom)',
      '(room~= B E D R O O M )',
      ' ( room >=aaaa)',
      '  ( room =b*) ',
      '  ( room =*m) ',
      '(room=bed*room)',
      '  ( room =b*oo*m) ',
      '  ( room =*b*oo*m*) ',
      '  (& (room =bedroom) (channel ~= 34))',
      '(| (room =bed*)(channel=222)) ',
      '(| (room =boom*)(channel=101)) ',
      '  (! (room =ab*b*oo*m*) ) ',
      '  (status =\\(o*\\\\\\)\\*) ',
      '  (canRecord =true\\(x\\)) ',
      '(max Record Time <=140) ',
      '(shortValue >= 100) ',
      '(intValue <= 100001) ',
      '(longValue >= 10000000000 ) ',
      '  (  &  (  byteValue <= 100  )  (  byteValue >= 10  )  )  ',
      '(bigIntValue =4123456) ',
      '(bigDecValue =4.123456) ',
      '(floatValue >= 1.0) ',
      '(doubleValue <= 2.011) ',
      '(booleanValue = true) ',
      '(primIntArrayValue = 1) ',
      '(primLongArrayValue = 2) ',
      '(primByteArrayValue = 3) ',
      '(primShortArrayValue = 1) ',
      '(primFloatArrayValue = 1.1) ',
      '(primDoubleArrayValue = 2.2) ',
      '(primBooleanArrayValue = false ) ',
      '(& (| (room =d*m) (room =bed*) (room=abc)) (! (channel=999)))',
      '(*=foo)',
      '(!  ab=b)',
      '(|   ab=b)',
      '(&=c)',
      '(!=c)',
      '(|=c)',
      '(&    ab=b)',
      '(empty=)',
      '(empty=*)',
      '(space= )',
      '(space=*)'
    ]

    const shouldNotMatch = [
      '(room=abc)',
      '(room <=aaaa)',
      '  ( room =b*b*  *m*) ',
      '  (&  (room =b*)  (room =*x) (channel=34))',
      '(!ab=*)',
      '(|ab=*)',
      '(&ab=*)'
    ]

    it.each(shouldMatch)('should match %s', expression => {
      expect(matches(expression)).toBe(true)
    })

    it.each(shouldNotMatch)('should not match %s', expression => {
      expect(matches(expression)).toBe(false)
    })
  })

  describe('invalid values (testInvalidValues)', () => {
    const present = ['intvalue', 'longvalue', 'shortvalue', 'bytevalue', 'floatvalue', 'doublevalue', 'booleanvalue']

    it.each(present)('should report %s as present', attribute => {
      expect(matches(`(${attribute}=*)`)).toBe(true)
    })

    it.each(present)('should not match %s against a non-value', attribute => {
      expect(matches(`(${attribute}=b)`)).toBe(false)
      expect(matches(`(${attribute}=)`)).toBe(false)
    })
  })

  describe('substring against non-strings (testScalarSubstring)', () => {
    const cases = [
      '(shortvalue =100*) ',
      '(intvalue =100*) ',
      '(longvalue =100*) ',
      '(  bytevalue =1*00  )',
      '(bigintvalue =4*23456) ',
      '(bigdecvalue =4*123456) ',
      '(floatvalue =1*0) ',
      '(doublevalue =2*011) ',
      '(booleanvalue =t*ue) '
    ]

    it.each(cases)('should not apply a wildcard to %s', expression => {
      expect(matches(expression)).toBe(false)
    })
  })

  describe('invalid filters (testInvalidFilter)', () => {
    const invalid = [
      '',
      '()',
      '(=foo)',
      '(',
      '(abc = ))',
      '(& (abc = xyz) (& (345))',
      '  (room = b**oo!*m*) ) ',
      '  (room = b**oo)*m*) ) ',
      '  (room = *=b**oo*m*) ) ',
      '  (room = =b**oo*m*) ) '
    ]

    it.each(invalid)('should reject %s', expression => {
      expect(() => createServiceFilter(expression)).toThrow()
    })
  })
})
