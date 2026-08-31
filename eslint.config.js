import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'release', 'coverage', 'node_modules'] },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat['recommended-latest'],

  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.webextensions },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The project defaults to `type`: almost everything is a union. `interface`
      // remains where a library requires it (idb DBSchema) or declaration merging is needed.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Floating promises in an extension are a source of silently lost errors.
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },

  {
    files: ['src/**/*.tsx'],
    ...reactRefresh.configs.vite,
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**/*'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  {
    // Playwright fixtures: the `use` parameter is not a React hook but the way a
    // fixture hands the environment to a test, and Playwright itself requires the
    // empty object pattern in fixture signatures.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },

  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },
)
