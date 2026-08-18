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
