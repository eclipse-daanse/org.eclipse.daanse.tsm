import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Nested too: examples carry their own dist/ and node_modules/
    ignores: ['**/dist/**', '**/node_modules/**']
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
  }
)
