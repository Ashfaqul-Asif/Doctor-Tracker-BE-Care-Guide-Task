import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The server's second static gate, alongside `npm run typecheck`.
 *
 * `recommendedTypeChecked` rather than `strictTypeChecked`: the type-aware rules that
 * earn their runtime here are the ones tsc cannot express — a floating promise, a
 * misused async handler, an `await` on a non-thenable. The strict tier adds mostly
 * stylistic opinions (`Array<T>` vs `T[]`, template-literal narrowing), which would
 * mean rewriting working code to satisfy a preference rather than fixing a defect.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // The typecheck config rather than tsconfig.json, so `tests/` is linted with
        // types too — otherwise every type-aware rule silently skips the test suite.
        project: ['./tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Match the client: `_` marks an intentionally unused binding. Express forces this
      // — an error handler must declare all four of `(err, _req, res, _next)` for
      // Express to recognise it as one.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    // This file is not in the TS program, so type-aware parsing has nothing to read.
    files: ['eslint.config.mjs', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    // Supertest types `res.body` as `any` by design — the response shape is the thing
    // under test, so asserting against it is the point. Enforcing the unsafe-* rules
    // here would mean casting every assertion and asserting against the cast.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // Test doubles are written `async` to match the signature they stand in for, and
      // often have nothing to await. That is the point of the double, not an oversight.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    // The CLI scripts are the one place stdout *is* the interface.
    files: ['src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
