import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Atlas round-trips are slower than a local mongod — give hooks room to connect.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The test database is shared state; running suites concurrently would have them
    // clearing collections out from under each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Excluded because coverage over them measures nothing useful: the scripts are
      // operator tools run by hand, and the type-only files emit no statements.
      exclude: ['src/scripts/**', 'src/types/**', 'src/**/*.d.ts'],
      // A ratchet against regression, not a target to chase.
      //
      // PROVISIONAL: these were set without a measured baseline — the environment they
      // were added in had no reachable Atlas cluster, so only the two DB-free suites
      // could run. Calibrate on the first full run (`npm run test:coverage` against a
      // real MONGODB_URI_TEST) and pin them just under the real numbers.
      //
      // Deliberately conservative until then: a threshold nobody has verified should
      // fail late rather than block a build that was fine.
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },
  },
});
