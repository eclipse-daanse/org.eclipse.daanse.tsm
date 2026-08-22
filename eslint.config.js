import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Nested too: examples carry their own dist/ and node_modules/
    // Build output too: the examples emit bundles next to their sources
    ignores: ['**/dist/**', '**/dist-bundles/**', '**/node_modules/**']
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'examples/**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      }
    },
    rules: {
      /*
       * A missing `type` turns a type import into a value import, and the bundler
       * follows it: the file is pulled in, with everything *it* imports. For a
       * bare interface nothing happens today, but a contract module grows — an
       * enum, a constant, a helper — and then the same line starts copying code
       * across a bundle boundary. `verbatimModuleSyntax` in tsconfig makes the
       * distinction meaningful; this makes it visible.
       */
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        /*
         * `separate`, not `inline`, and the difference is not cosmetic. Under
         * `verbatimModuleSyntax`:
         *
         *   import { type Thing } from './dep.js'   →  import {} from './dep.js'
         *   import type { Thing } from './dep.js'   →  (nothing)
         *
         * The inline form leaves a side-effect import behind, so the bundler
         * still pulls the file in — which is the very thing being guarded
         * against. Only the separate form disappears.
         *
         * A genuinely mixed import stays as it is either way: the module is
         * needed at runtime for its value, so `import { ID, type Contract }`
         * costs nothing and keeps a contract on one line.
         */
        fixStyle: 'separate-type-imports',
        disallowTypeAnnotations: false
      }]
    }
  },
  {
    // Tests reach into globals and fake containers, where loose typing is the point
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Type-level tests declare values only to take `typeof` of them; nothing here
    // runs, so an unused binding is the normal case rather than a mistake
    files: ['src/__tests__/**/*.test-d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
)
