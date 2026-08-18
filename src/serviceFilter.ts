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
 * Supported: `&` `|` `!`, `=`, `>=`, `<=`, presence and `*` wildcards.
 * Not supported: approximate match (`~=`), which has no defined semantics here.
 */

/** Values a service property may carry */
export type ServicePropertyValue = string | number | boolean

/** Properties a registration is matched against */
export type ServiceProperties = Record<string, ServicePropertyValue | undefined>

/** A parsed filter */
export type ServiceFilter = (properties: ServiceProperties) => boolean

class FilterParser {
  private position = 0

  constructor(private readonly source: string) {}

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

    if (operator === '&' || operator === '|') {
      this.position++
      const operands = this.parseOperands()
      filter = operator === '&'
        ? properties => operands.every(operand => operand(properties))
        : properties => operands.some(operand => operand(properties))
    } else if (operator === '!') {
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

    if (operator === '=' && wildcards) {
      // (attr=*) asks whether the property is there at all
      if (parts.length === 2 && parts.every(part => part.length === 0)) {
        return properties => properties[attribute] !== undefined
      }

      const pattern = substringPattern(parts)
      return properties => {
        const actual = properties[attribute]
        return actual !== undefined && pattern.test(String(actual))
      }
    }

    const value = parts.join('')
    if (operator === '=') {
      return properties => equals(properties[attribute], value)
    }

    return properties => compare(properties[attribute], value, operator)
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

  private readOperator(): '=' | '>=' | '<=' {
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
      throw this.error('approximate match (~=) is not supported')
    }
    throw this.error('expected =, >= or <=')
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

function equals(actual: ServicePropertyValue | undefined, expected: string): boolean {
  if (actual === undefined) return false
  if (typeof actual === 'boolean') return String(actual) === expected
  if (typeof actual === 'number') return Number(expected) === actual
  return actual === expected
}

function compare(
  actual: ServicePropertyValue | undefined,
  expected: string,
  operator: '>=' | '<='
): boolean {
  if (actual === undefined) return false

  const actualNumber = typeof actual === 'number' ? actual : Number(actual)
  const expectedNumber = Number(expected)
  const numeric = !Number.isNaN(actualNumber) && !Number.isNaN(expectedNumber)

  const left = numeric ? actualNumber : String(actual)
  const right = numeric ? expectedNumber : expected

  return operator === '>=' ? left >= right : left <= right
}

/**
 * Parse a filter expression. Throws on invalid syntax, naming the position —
 * a silently non-matching filter would be worse than a rejected one.
 */
export function createServiceFilter(expression: string): ServiceFilter {
  return new FilterParser(expression).parse()
}
