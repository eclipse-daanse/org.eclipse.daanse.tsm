/**
 * TSM - TypeScript Module System
 * LDAP-style service filters
 *
 * The syntax is the one OSGi uses (RFC 1960), so a filter reads the same here
 * as in a Java `@Reference(target = "...")`:
 *
 *   (kind=chart)
 *   (&(kind=chart)(service.ranking>=10))
 *   (|(kind=chart)(kind=table))
 *   (!(experimental=true))
 *   (kind=*)          — property is present
 *   (label=chart*)    — substring match
 *
 * Supported: `&` `|` `!`, `=`, `>=`, `<=`, `~=`, presence and `*` wildcards.
 *
 * Semantics follow OSGi's `FilterImpl`:
 * - attribute names match case-insensitively (`cn` and `CN` are the same attribute)
 * - comparison is driven by the type of the *property value*, not by what the
 *   filter value looks like, so a string property compares lexically even when
 *   both sides happen to parse as numbers
 * - a property holding an array matches when any element matches
 * - `~=` removes whitespace and compares case-insensitively, the minimum the
 *   OSGi spec allows
 */

import type { ServiceProperties, ServicePropertyValue } from './types.js'

export type { ServiceProperties, ServicePropertyValue }

/** A parsed filter */
export type ServiceFilter = (properties: ServiceProperties) => boolean

class FilterParser {
  private position = 0

  constructor(
    private readonly source: string,
    private readonly read: PropertyLookup
  ) {}

  parse(): ServiceFilter {
    const filter = this.parseFilter()
    this.skipWhitespace()
    if (this.position < this.source.length) {
      throw this.error(`unexpected trailing input`)
    }
    return filter
  }

  private parseFilter(): ServiceFilter {
    this.skipWhitespace()
    this.expect('(')
    this.skipWhitespace()

    const operator = this.source[this.position]
    let filter: ServiceFilter

    // '&', '|' and '!' introduce an operator only when a nested filter follows.
    // Otherwise they are the first character of an attribute name — '(&=c)' asks
    // about an attribute literally called '&'.
    if ((operator === '&' || operator === '|') && this.filterFollows(1)) {
      this.position++
      const operands = this.parseOperands()
      filter = operator === '&'
        ? properties => operands.every(operand => operand(properties))
        : properties => operands.some(operand => operand(properties))
    } else if (operator === '!' && this.filterFollows(1)) {
      this.position++
      const operand = this.parseFilter()
      filter = properties => !operand(properties)
    } else {
      filter = this.parseItem()
    }

    this.skipWhitespace()
    this.expect(')')
    return filter
  }

  /** Whether the next non-whitespace character after an offset opens a filter */
  private filterFollows(offset: number): boolean {
    let lookahead = this.position + offset
    while (lookahead < this.source.length && /\s/.test(this.source[lookahead])) {
      lookahead++
    }
    return this.source[lookahead] === '('
  }

  private parseOperands(): ServiceFilter[] {
    const operands: ServiceFilter[] = []
    this.skipWhitespace()
    while (this.source[this.position] === '(') {
      operands.push(this.parseFilter())
      this.skipWhitespace()
    }
    if (operands.length === 0) {
      throw this.error('operator without operands')
    }
    return operands
  }

  private parseItem(): ServiceFilter {
    const attribute = this.readAttribute()
    const operator = this.readOperator()
    const { parts, wildcards } = this.readValue()

    if (operator === '~=') {
      const approximate = approximately(parts.join(''))
      return properties => matches(
        this.read(properties, attribute),
        actual => typeof actual === 'string' || typeof actual === 'number'
          ? approximately(String(actual)) === approximate
          : false
      )
    }

    if (operator === '=' && wildcards) {
      // (attr=*) asks whether the property is there at all
      if (parts.every(part => part.length === 0)) {
        return properties => this.read(properties, attribute) !== undefined
      }

      const pattern = substringPattern(parts)
      return properties => matches(
        this.read(properties, attribute),
        // A wildcard is a string operation: OSGi does not apply it to numbers
        // or booleans, so (intvalue=100*) does not match 1000
        actual => typeof actual === 'string' && pattern.test(actual)
      )
    }

    const value = parts.join('')
    if (operator === '=') {
      return properties => matches(
        this.read(properties, attribute),
        actual => equals(actual, value)
      )
    }

    return properties => matches(
      this.read(properties, attribute),
      actual => compare(actual, value, operator)
    )
  }

  private readAttribute(): string {
    const start = this.position
    // '~' stops here as well, so (attr~=value) reaches the operator check
    // instead of being read as an attribute named 'attr~'
    while (this.position < this.source.length && !'=<>()~'.includes(this.source[this.position])) {
      this.position++
    }
    const attribute = this.source.slice(start, this.position).trim()
    if (attribute.length === 0) {
      throw this.error('missing attribute name')
    }
    return attribute
  }

  private readOperator(): FilterOperator {
    if (this.source.startsWith('>=', this.position)) {
      this.position += 2
      return '>='
    }
    if (this.source.startsWith('<=', this.position)) {
      this.position += 2
      return '<='
    }
    if (this.source[this.position] === '=') {
      this.position++
      return '='
    }
    if (this.source.startsWith('~=', this.position)) {
      this.position += 2
      return '~='
    }
    throw this.error('expected =, >=, <= or ~=')
  }

  /**
   * Read a value as literal segments split at unescaped wildcards.
   *
   * Splitting while reading is what keeps `\*` apart from `*`: once the escape
   * is dropped, a literal asterisk is indistinguishable from a wildcard.
   */
  private readValue(): { parts: string[]; wildcards: boolean } {
    const parts: string[] = ['']
    let wildcards = false

    while (this.position < this.source.length) {
      const character = this.source[this.position]
      if (character === ')') break

      if (character === '\\') {
        const escaped = this.source[this.position + 1]
        if (escaped === undefined) {
          throw this.error('trailing escape character')
        }
        parts[parts.length - 1] += escaped
        this.position += 2
        continue
      }

      if (character === '*') {
        wildcards = true
        parts.push('')
        this.position++
        continue
      }

      parts[parts.length - 1] += character
      this.position++
    }

    return { parts, wildcards }
  }

  private skipWhitespace(): void {
    while (this.position < this.source.length && /\s/.test(this.source[this.position])) {
      this.position++
    }
  }

  private expect(character: string): void {
    if (this.source[this.position] !== character) {
      throw this.error(`expected '${character}'`)
    }
    this.position++
  }

  private error(message: string): Error {
    return new Error(
      `Invalid service filter at position ${this.position}: ${message} — '${this.source}'`
    )
  }
}

function substringPattern(parts: string[]): RegExp {
  const escaped = parts
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`)
}

type FilterOperator = '=' | '>=' | '<=' | '~='

/** A single, non-array property value */
type ScalarValue = string | number | boolean

/**
 * How a filter looks an attribute up.
 *
 * Two ways, because the specifications differ: service properties are matched
 * ignoring case (Core 5.8, and Config Admin keys are case insensitive too), while
 * a requirement's filter locates capability attributes "in a case sensitive
 * manner" (Core 3.3.6).
 */
type PropertyLookup = (
  properties: ServiceProperties,
  attribute: string
) => ServicePropertyValue | undefined

/** `(CN=x)` and `(cn=x)` address the same service property, as in OSGi */
const ignoringCase: PropertyLookup = (properties, attribute) => {
  const direct = properties[attribute]
  if (direct !== undefined) return direct

  const wanted = attribute.toLowerCase()
  for (const [key, value] of Object.entries(properties)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

/** For capability attributes, where Core 3.3.6 asks for exact names */
const exactly: PropertyLookup = (properties, attribute) => properties[attribute]

/**
 * Apply a test to a property value. An array matches when any element does.
 */
function matches(
  actual: ServicePropertyValue | undefined,
  test: (value: ScalarValue) => boolean
): boolean {
  if (actual === undefined) return false
  if (Array.isArray(actual)) return actual.some(element => test(element))
  return test(actual as ScalarValue)
}

function equals(actual: ScalarValue, expected: string): boolean {
  if (typeof actual === 'boolean') return String(actual) === expected.trim()
  if (typeof actual === 'number') return numeric(expected) === actual
  return actual === expected
}

/**
 * The filter value as a number, or NaN when it is not one.
 *
 * `Number('')` is 0, which would make `(count=)` match a property of 0 —
 * OSGi rejects a value its type cannot parse, so an empty string must not
 * become a number here.
 */
function numeric(value: string): number {
  const trimmed = value.trim()
  return trimmed.length === 0 ? Number.NaN : Number(trimmed)
}

/**
 * Ordering comparison. The type of the property value decides how to compare:
 * a numeric property compares numerically, a string lexically. Deriving it from
 * the filter text instead would make `(v>=10)` mean different things depending
 * on what the provider happens to store.
 */
function compare(actual: ScalarValue, expected: string, operator: '>=' | '<='): boolean {
  if (typeof actual === 'boolean') {
    // Booleans have no ordering; OSGi compares them for equality only
    return false
  }

  if (typeof actual === 'number') {
    const expectedNumber = numeric(expected)
    if (Number.isNaN(expectedNumber)) return false
    return operator === '>=' ? actual >= expectedNumber : actual <= expectedNumber
  }

  return operator === '>=' ? actual >= expected : actual <= expected
}

/** Whitespace removed, lower-cased — the minimum `~=` the OSGi spec allows */
function approximately(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * Parse a filter expression. Throws on invalid syntax, naming the position —
 * a silently non-matching filter would be worse than a rejected one.
 */
/**
 * Parse an LDAP-style filter (Core 3.2.7).
 *
 * @param options.caseSensitive Match attribute names exactly, as a requirement's
 *   filter does against capability attributes. Off by default, which is what
 *   service properties call for.
 */
export function createServiceFilter(
  expression: string,
  options: { caseSensitive?: boolean } = {}
): ServiceFilter {
  return new FilterParser(
    expression,
    options.caseSensitive === true ? exactly : ignoringCase
  ).parse()
}
