import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the `@/*` alias straight from tsconfig.json — one source of truth.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Free-tier awareness: smoke tests hit a remote Supabase instance that may
    // be cold-starting, so give network-bound tests room to breathe.
    testTimeout: 20_000,
    // Ledger tests boot a fresh PGlite (PostgreSQL as WebAssembly) per suite,
    // which takes seconds and competes with the other suites for CPU. The
    // default 10s hook timeout is not enough once files run in parallel.
    hookTimeout: 120_000,

    // CLAUDE.md targets ~100% coverage on the ledger and state machines. That
    // was an unmeasured claim until now: there was no provider installed and
    // nothing produced a report.
    //
    // The thresholds cover only the money and lifecycle code. Coverage of the
    // UI would be a vanity number, and a repo-wide threshold drops every time
    // a screen is added, which trains everyone to lower it. The rules that
    // actually matter live in SQL, and these are the modules that call it.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: [
        'src/lib/ledger/**/*.ts',
        'src/lib/circles/**/*.ts',
        // The HTTP layer enforces the idempotency-key rule and maps every
        // Postgres error to a status code, so it belongs with the money code
        // rather than with the UI.
        'src/lib/http/**/*.ts',
        'src/lib/money.ts',
        'src/lib/format.ts',
        'src/lib/db-error.ts',
      ],
      exclude: [
        '**/*.test.ts',
        // These two import next/headers, which a node test cannot load. They
        // hold no rules of their own — one builds a service, the other is
        // select statements against the views from 0008, and those views are
        // tested directly in tests/lifecycle/read-views.test.ts.
        'src/lib/circles/service-for-request.ts',
        'src/lib/circles/queries.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
