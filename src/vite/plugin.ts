/**
 * TSM Vite Plugin
 *
 * Provides build support for TSM (TypeScript Module System) modules.
 *
 * Features:
 * - Transforms `tsm:module/namespace` imports to `__tsm__.require()` calls
 * - Handles import aliasing (e.g., `import { ref as ref$1 }`)
 * - Injects CSS loader code for extracted CSS files
 *
 * Usage in vite.config.ts:
 *   import { tsmPlugin } from 'tsm/vite'
 *   export default defineConfig({
 *     plugins: [tsmPlugin()]
 *   })
 *
 * Usage in source files:
 *   import { ref, computed } from 'tsm:my-app/vue'
 *   import { Button } from 'tsm:my-app/ui'
 */

import type { Plugin } from 'vite'

const TSM_PREFIX = 'tsm:'

export interface TsmPluginOptions {
  /**
   * Whether to use renderChunk (for production builds) or transform (for dev)
   * Default: true
   */
  useRenderChunk?: boolean

  /**
   * Shared modules whose bare imports should also be transformed.
   * This is needed for Vue SFC support, where the compiler generates
   * bare imports like `import { openBlock } from 'vue'`.
   *
   * Example: ['vue', 'vue-router', 'primevue']
   *
   * Default: [] (only tsm: prefixed imports are transformed)
   */
  sharedModules?: string[]
}

/**
 * Convert import specifiers to valid destructuring syntax
 * Handles: "x", "x as y" -> proper destructuring with colon syntax
 * Filters out type imports (e.g., "type Ref", "type Ref as R")
 */
function convertImports(importList: string, moduleId: string): string {
  const specifiers = importList.split(',').map(s => s.trim()).filter(s => s)

  // Filter out inline type imports (e.g., "type Ref", "type Ref as R")
  const valueSpecifiers = specifiers.filter(s => !s.startsWith('type '))

  // If only type imports were present, return empty string
  if (valueSpecifiers.length === 0) return ''

  const destructured: string[] = []
  for (const spec of valueSpecifiers) {
    // Convert "foo as bar" to "foo: bar" for destructuring
    const converted = spec.replace(/^(\w+)\s+as\s+(\S+)$/, '$1: $2')
    destructured.push(converted)
  }
  return `const { ${destructured.join(', ')} } = __tsm__.require('${moduleId}');`
}

/**
 * Transform tsm: imports in code
 * @internal Exported for testing
 */
export function transformTsmImports(code: string, sharedModules: string[] = []): string | null {
  const hasTsmImports = code.includes(TSM_PREFIX)
  const hasSharedImports = sharedModules.some(m =>
    code.includes(`from '${m}'`) || code.includes(`from "${m}"`) ||
    code.includes(`from '${m}/`) || code.includes(`from "${m}/`)
  )

  if (!hasTsmImports && !hasSharedImports) return null

  let transformed = code

  // ============================================================
  // Transform tsm: prefixed imports
  // ============================================================

  // Remove: import type { ... } from 'tsm:module' (type-only imports)
  transformed = transformed.replace(
    /import\s+type\s*\{[^}]*\}\s*from\s*['"]tsm:[^'"]+['"]\s*;?/g,
    ''
  )

  // Transform: import { x, y as z } from 'tsm:module' or 'tsm:module/subpath'
  transformed = transformed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, imports, moduleId) => convertImports(imports, moduleId)
  )

  // Transform: import * as X from 'tsm:module'
  transformed = transformed.replace(
    /import\s*\*\s*as\s*(\w+)\s*from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, alias, moduleId) =>
      `const ${alias} = __tsm__.require('${moduleId}');`
  )

  // Transform: import X from 'tsm:module'
  transformed = transformed.replace(
    /import\s+(\w+)\s+from\s*['"]tsm:([^'"]+)['"]\s*;?/g,
    (_, name, moduleId) =>
      `const ${name} = __tsm__.require('${moduleId}').default;`
  )

  // ============================================================
  // Transform bare imports from shared modules (for SFC support)
  // ============================================================

  for (const moduleId of sharedModules) {
    // Escape special regex characters in module name
    const escaped = moduleId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // Remove: import type { ... } from 'module' (type-only imports)
    transformed = transformed.replace(
      new RegExp(`import\\s+type\\s*\\{[^}]*\\}\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      ''
    )

    // Transform: import { x, y as z } from 'module' or 'module/sub'
    transformed = transformed.replace(
      new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, imports, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return convertImports(imports, fullModule)
      }
    )

    // Transform: import * as X from 'module'
    transformed = transformed.replace(
      new RegExp(`import\\s*\\*\\s*as\\s*(\\w+)\\s*from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, alias, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return `const ${alias} = __tsm__.require('${fullModule}');`
      }
    )

    // Transform: import X from 'module'
    transformed = transformed.replace(
      new RegExp(`import\\s+(\\w+)\\s+from\\s*['"]${escaped}(/[^'"]*)?['"]\\s*;?`, 'g'),
      (_, name, subpath) => {
        const fullModule = subpath ? `${moduleId}${subpath}` : moduleId
        return `const ${name} = __tsm__.require('${fullModule}').default;`
      }
    )
  }

  return transformed !== code ? transformed : null
}

/**
 * TSM Vite Plugin for development and production builds
 */
export function tsmPlugin(options: TsmPluginOptions = {}): Plugin {
  const { useRenderChunk = true, sharedModules = [] } = options

  return {
    name: 'tsm-plugin',
    enforce: 'pre',

    // Mark tsm: imports and shared modules as external
    resolveId(source: string) {
      if (source.startsWith(TSM_PREFIX)) {
        return { id: source, external: true }
      }
      // Mark shared modules as external too
      for (const mod of sharedModules) {
        if (source === mod || source.startsWith(mod + '/')) {
          return { id: source, external: true }
        }
      }
      return null
    },

    // For development: transform during build
    transform(code: string, id: string) {
      if (useRenderChunk) return null
      if (!id.match(/\.(ts|js|tsx|jsx|vue)$/)) return null
      if (id.includes('node_modules')) return null

      const transformed = transformTsmImports(code, sharedModules)
      return transformed ? { code: transformed, map: null } : null
    },

    // For production: transform final output
    renderChunk(code: string) {
      if (!useRenderChunk) return null

      const transformed = transformTsmImports(code, sharedModules)
      return transformed ? { code: transformed, map: null } : null
    }
  }
}

/**
 * Generate CSS loader code that injects a stylesheet link
 *
 * @param cssUrl - URL to the CSS file
 * @returns JavaScript code that injects the CSS
 */
export function generateCssLoader(cssUrl: string): string {
  return `(function(){` +
    `var l=document.createElement('link');` +
    `l.rel='stylesheet';` +
    `l.href='${cssUrl}';` +
    `document.head.appendChild(l);` +
    `})();`
}

export interface CreateExternalsOptions {
  /** Modules that provide libraries (won't externalize their deps) */
  libraryProviders?: string[]
  /** Additional packages to always externalize */
  alwaysExternal?: string[]
  /** Packages to externalize for non-library-providers */
  sharedPackages?: string[]
}

/**
 * Create external function for TSM module builds
 *
 * Library providers bundle shared libraries (Vue, UI frameworks, etc.)
 * Other modules mark them as external and load from library providers at runtime.
 *
 * @param moduleId - The ID of the module being built
 * @param options - Configuration options
 */
export function createTsmExternals(moduleId: string, options: CreateExternalsOptions = {}) {
  const {
    libraryProviders = [],
    alwaysExternal = ['vue', 'vue-router', 'tsm'],
    sharedPackages = ['primevue', '@primevue', 'primeicons']
  } = options

  const isLibraryProvider = libraryProviders.includes(moduleId)

  return (id: string): boolean => {
    // Always external packages
    for (const pkg of alwaysExternal) {
      if (id === pkg || id.startsWith(pkg + '/')) return true
    }

    // Library providers bundle everything else
    if (isLibraryProvider) {
      return false
    }

    // Other modules: shared packages are external
    for (const pkg of sharedPackages) {
      if (id === pkg || id.startsWith(pkg + '/') || id.startsWith(pkg)) return true
    }

    return false
  }
}
