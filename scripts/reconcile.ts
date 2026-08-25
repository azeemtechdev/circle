/**
 * Reconciliation job v1 (PLAN.md §4 invariant 6, §7 Phase 1).
 *
 * Verifies that the ledger still tells the truth: sums to zero, every transfer
 * balanced, no orphans, every circle net zero, all amounts positive. Any drift
 * exits non-zero and names the failing check, so the GitHub Action turns red
 * rather than reporting a comfortable nothing.
 *
 *   npm run reconcile
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service
 * role key is required because reconcile_ledger() is deliberately not granted
 * to anon — an anonymous visitor has no business auditing the books.
 *
 * Run with Node's TypeScript support:
 *   node --experimental-strip-types scripts/reconcile.ts
 */

import { createClient } from '@supabase/supabase-js';

import { Ledger } from '../src/lib/ledger/ledger.ts';
import { SupabaseLedgerPort } from '../src/lib/ledger/supabase-port.ts';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('your-')) {
    console.error(`✗ ${name} is not set.`);
    console.error(
      '  Locally: add it to .env.local and run `npm run reconcile`.\n' +
        '  In CI: add it under Settings → Secrets and variables → Actions.',
    );
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const url = required('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ledger = new Ledger(new SupabaseLedgerPort(client));
  const startedAt = process.hrtime.bigint();
  const report = await ledger.reconcile();
  const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  console.log(`Reconciliation ran ${report.checks.length} checks in ${elapsedMs}ms\n`);
  for (const check of report.checks) {
    console.log(`${check.ok ? '✓' : '✗'} ${check.check_name} — ${check.detail}`);
  }

  if (report.ok) {
    console.log('\nLedger is sound.');
    return;
  }

  console.error(`\n${report.failures.length} check(s) FAILED:`);
  for (const failure of report.failures) {
    console.error(`  ✗ ${failure.check_name} — ${failure.detail}`);
  }
  console.error(
    '\nDo NOT edit ledger rows to fix this. Find the cause, fix the code, and\n' +
      'post reversing entries. See ARCHITECTURE.md §7.',
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error('Reconciliation could not run:', error instanceof Error ? error.message : error);
  process.exit(2);
});
