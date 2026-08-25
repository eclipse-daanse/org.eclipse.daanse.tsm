/**
 * TSM Vite Plugin - reading `@component()` declarations from source
 *
 * A component states what it offers on the class, which the loader reads at
 * runtime. Load order, satisfaction and a feature's completeness have to know it
 * *before* anything is imported, so the declaration is lifted out of the source
 * at build time — the job bnd does for OSGi with its generated descriptors.
 *
 * Uses the TypeScript AST rather than patterns: `@component({ … })` carries
 * nested object literals, and a regular expression cannot read those reliably.
 */

import ts from 'typescript'

/** A service a component declares */
export interface DeclaredService {
  id: string
  ranking?: number
  properties?: Record<string, string | number | boolean>
}

/** One `@component()` class found in a source file */
export interface DeclaredComponent {
  /** Class name, for messages */
  name: string
  /** 1-based line of the declaration */
  line: number
  /** Services in declaration order; the first is the primary one */
  services: DeclaredService[]
  /** Whether an `@activate` method makes it an immediate component */
  immediate: boolean

  /**
   * Whether the class is exported.
   *
   * The loader finds components in the module's namespace, so one that is not
   * exported is never registered — and nothing at runtime can report that,
   * because the class is simply not there to be found.
   */
  exported: boolean
}

/**
 * Resolves an import specifier to the source of that module, so a service id
 * held in an imported constant can be read. Return undefined when the file is
 * not available.
 */
export type ImportResolver = (specifier: string) => string | undefined

export class ComponentScanError extends Error {
  constructor(message: string, readonly line: number) {
    super(message)
    this.name = 'ComponentScanError'
  }
}

/** Find the `@component()` classes in a source file */
export function extractComponents(
  code: string,
  resolveImport: ImportResolver = () => undefined
): DeclaredComponent[] {
  if (!code.includes('@component')) return []

  const source = ts.createSourceFile('scan.ts', code, ts.ScriptTarget.Latest, true)
  const constants = collectStringConstants(source)
  const found: DeclaredComponent[] = []

  for (const statement of source.statements) {
    for (const declaration of classDeclarations(statement)) {
      const decorator = componentDecorator(declaration)
      if (!decorator) continue

      const line = lineOf(source, decorator)
      const options = decoratorOptions(decorator, line)

      found.push({
        name: declaration.name?.text ?? '(anonymous)',
        line,
        services: readServices(options, source, constants, resolveImport, line),
        immediate: hasActivateMethod(declaration) || options.get('immediate') !== undefined,
        exported: isExported(declaration)
      })
    }
  }

  return found
}

function isExported(declaration: ts.ClassDeclaration): boolean {
  const flags = ts.getCombinedModifierFlags(declaration)
  return (flags & ts.ModifierFlags.Export) !== 0
}

function classDeclarations(statement: ts.Statement): ts.ClassDeclaration[] {
  if (ts.isClassDeclaration(statement)) return [statement]
  return []
}

function componentDecorator(declaration: ts.ClassDeclaration): ts.CallExpression | undefined {
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    const call = decorator.expression
    if (!ts.isCallExpression(call)) continue
    if (!ts.isIdentifier(call.expression)) continue
    if (call.expression.text !== 'component') continue
    return call
  }
  return undefined
}

function hasActivateMethod(declaration: ts.ClassDeclaration): boolean {
  return declaration.members.some(member =>
    (ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []).some(decorator => {
      const call = decorator.expression
      return ts.isCallExpression(call)
        && ts.isIdentifier(call.expression)
        && call.expression.text === 'activate'
    })
  )
}

/** The properties of the object literal passed to `@component()` */
function decoratorOptions(
  call: ts.CallExpression,
  line: number
): Map<string, ts.Expression> {
  const options = new Map<string, ts.Expression>()
  const [argument] = call.arguments
  if (argument === undefined) return options

  if (!ts.isObjectLiteralExpression(argument)) {
    throw new ComponentScanError(
      '@component() must be given an object literal to be readable at build time',
      line
    )
  }

  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = propertyName(property.name)
    if (name !== undefined) options.set(name, property.initializer)
  }

  return options
}

function readServices(
  options: Map<string, ts.Expression>,
  source: ts.SourceFile,
  constants: Map<string, string>,
  resolveImport: ImportResolver,
  line: number
): DeclaredService[] {
  const serviceExpression = options.get('service')
  if (serviceExpression === undefined) return []

  if (!ts.isArrayLiteralExpression(serviceExpression)) {
    throw new ComponentScanError('`service` must be an array literal', line)
  }

  const ranking = numberValue(options.get('ranking'))
  const shared = objectValue(options.get('properties'), source, constants, resolveImport)
  const perId = options.get('propertiesById')
  const byId = perId !== undefined && ts.isObjectLiteralExpression(perId)
    ? perId.properties
    : []

  return serviceExpression.elements.map(element => {
    const id = stringValue(element, source, constants, resolveImport)
    if (id === undefined) {
      throw new ComponentScanError(
        `service id ${element.getText(source)} cannot be read at build time — ` +
        `use a string literal, or a const declared in this file or an imported module`,
        line
      )
    }

    const own = byId.find(property =>
      ts.isPropertyAssignment(property)
      && resolveKey(property.name, source, constants, resolveImport) === id
    )
    const properties = own !== undefined && ts.isPropertyAssignment(own)
      ? objectValue(own.initializer, source, constants, resolveImport)
      : shared

    return { id, ...(ranking === undefined ? {} : { ranking }), ...(properties ? { properties } : {}) }
  })
}

/** `export const X = 'value'` and `const X = 'value'` in this file */
function collectStringConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>()

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue

      const value = constantString(declaration.initializer)
      if (value !== undefined) {
        constants.set(declaration.name.text, value)
      }
    }
  }

  return constants
}

/**
 * The string a constant declaration amounts to.
 *
 * A plain literal, or a literal wrapped in an identity call. The wrapped form is
 * how a typed service id is declared — `serviceId<TileService>('demo.tiles')` —
 * and it is the *usual* form now, not an edge case: reading only bare literals
 * meant that adopting a typed id silently cost the build-time declaration, and a
 * component's `provides` entry with it.
 *
 * Only the argument is read; what the function does is not this scan's business.
 * That is sound for an identity function and wrong for anything else, so the call
 * has to be one the scan knows by name.
 */
function constantString(initializer: ts.Expression | undefined): string | undefined {
  if (initializer === undefined) return undefined
  if (ts.isStringLiteral(initializer)) return initializer.text

  // `as const`, `satisfies`, or a cast around the literal
  if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) {
    return constantString(initializer.expression)
  }

  if (!ts.isCallExpression(initializer)) return undefined

  const callee = initializer.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined

  if (name === undefined || !IDENTITY_CALLS.has(name)) return undefined
  return constantString(initializer.arguments[0])
}

/**
 * Calls that stand for their first argument.
 *
 * `serviceId` is tsm's own; `Symbol.for` appears where a project used the global
 * symbol registry for ids before typed ones existed, and its key is the id.
 */
const IDENTITY_CALLS = new Set(['serviceId', 'for'])

/** Which import a name came from, so its value can be looked up there */
function importSourceOf(source: ts.SourceFile, name: string): string | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const clause = statement.importClause
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue

    for (const element of clause.namedBindings.elements) {
      if (element.name.text !== name) continue
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      return statement.moduleSpecifier.text
    }
  }
  return undefined
}

function stringValue(
  expression: ts.Expression,
  source: ts.SourceFile,
  constants: Map<string, string>,
  resolveImport: ImportResolver
): string | undefined {
  if (ts.isStringLiteral(expression)) return expression.text
  if (!ts.isIdentifier(expression)) return undefined

  const local = constants.get(expression.text)
  if (local !== undefined) return local

  // Declared in another module: read that file and look for the constant
  const specifier = importSourceOf(source, expression.text)
  if (specifier === undefined) return undefined

  const imported = resolveImport(specifier)
  if (imported === undefined) return undefined

  const importedSource = ts.createSourceFile(specifier, imported, ts.ScriptTarget.Latest, true)
  return collectStringConstants(importedSource).get(expression.text)
}

function resolveKey(
  name: ts.PropertyName,
  source: ts.SourceFile,
  constants: Map<string, string>,
  resolveImport: ImportResolver
): string | undefined {
  if (ts.isComputedPropertyName(name)) {
    return stringValue(name.expression, source, constants, resolveImport)
  }
  return propertyName(name)
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

function numberValue(expression: ts.Expression | undefined): number | undefined {
  if (expression === undefined) return undefined
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)) {
    return -Number(expression.operand.text)
  }
  return undefined
}

function objectValue(
  expression: ts.Expression | undefined,
  source: ts.SourceFile,
  constants: Map<string, string>,
  resolveImport: ImportResolver
): Record<string, string | number | boolean> | undefined {
  if (expression === undefined || !ts.isObjectLiteralExpression(expression)) return undefined

  const value: Record<string, string | number | boolean> = {}
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    // Through a constant as well: a property name held in the contract module is
    // the same practice as the service id being there, and `propertiesById`
    // already resolved its keys that way
    const name = resolveKey(property.name, source, constants, resolveImport)
    if (name === undefined) continue

    const initializer = property.initializer
    if (ts.isStringLiteral(initializer)) value[name] = initializer.text
    else if (ts.isNumericLiteral(initializer)) value[name] = Number(initializer.text)
    else if (initializer.kind === ts.SyntaxKind.TrueKeyword) value[name] = true
    else if (initializer.kind === ts.SyntaxKind.FalseKeyword) value[name] = false
    else {
      const negative = numberValue(initializer)
      if (negative !== undefined) value[name] = negative
    }
  }

  return Object.keys(value).length > 0 ? value : undefined
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}
