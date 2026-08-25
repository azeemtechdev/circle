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
  },
});
