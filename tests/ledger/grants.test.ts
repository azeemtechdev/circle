import { beforeAll, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../support/pglite';

/**
 * Regression tests for the security defect fixed by migration 0002.
 *
 * An anonymous caller holding only the public anon key could invoke
 * post_double_entry and post_reversal against the live project and write real
 * entries into the append-only ledger. PostgreSQL grants EXECUTE on a new
 * function to PUBLIC by default, and 0001 never revoked it; because the
 * functions are SECURITY DEFINER, the revoked table grants gave no protection.
 *
 * On a SECURITY DEFINER function the EXECUTE grant is the only thing between
 * an anonymous request and the definer's privileges — so it gets a test.
 */

const WRITE_FUNCTIONS = [
  'post_double_entry(text, uuid, uuid, bigint, text, uuid, uuid)',
  'post_reversal(text, uuid, text, uuid)',
] as const;

const LEDGER_RELATIONS = [
  'accounts',
  'transfers',
  'ledger_entries',
  'events',
  'account_balances',
] as const;

describe('function EXECUTE grants', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  async function canExecute(role: string, signature: string): Promise<boolean> {
    const result = await db.query<{ allowed: boolean }>(
      `select has_function_privilege($1, $2, 'EXECUTE') as allowed`,
      [role, `public.${signature}`],
    );
    return result.rows[0]!.allowed;
  }

  it.each(WRITE_FUNCTIONS)('denies anon EXECUTE on %s', async (signature) => {
    expect(await canExecute('anon', signature)).toBe(false);
  });

  it.each(WRITE_FUNCTIONS)('denies PUBLIC EXECUTE on %s', async (signature) => {
    // 'public' is the implicit grantee that caused the defect.
    expect(await canExecute('public', signature)).toBe(false);
  });

  it.each(WRITE_FUNCTIONS)('still allows authenticated and the server on %s', async (signature) => {
    expect(await canExecute('authenticated', signature)).toBe(true);
    expect(await canExecute('service_role', signature)).toBe(true);
  });

  it('lets only the server reconcile', async () => {
    expect(await canExecute('anon', 'reconcile_ledger()')).toBe(false);
    expect(await canExecute('public', 'reconcile_ledger()')).toBe(false);
    expect(await canExecute('authenticated', 'reconcile_ledger()')).toBe(false);
    expect(await canExecute('service_role', 'reconcile_ledger()')).toBe(true);
  });

  it('denies anon the balance function', async () => {
    expect(await canExecute('anon', 'account_balance_kobo(uuid)')).toBe(false);
    expect(await canExecute('authenticated', 'account_balance_kobo(uuid)')).toBe(true);
  });
});

describe('table read grants', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  it.each(LEDGER_RELATIONS)('denies anon SELECT on %s', async (relation) => {
    // Reads will be scoped by Row Level Security once `memberships` exists in
    // Phase 2. Until then anon gets a closed door rather than every circle's
    // financial history.
    const result = await db.query<{ allowed: boolean }>(
      `select has_table_privilege('anon', $1, 'SELECT') as allowed`,
      [`public.${relation}`],
    );
    expect(result.rows[0]!.allowed).toBe(false);
  });

  it.each(LEDGER_RELATIONS)('still allows authenticated to read %s', async (relation) => {
    const result = await db.query<{ allowed: boolean }>(
      `select has_table_privilege('authenticated', $1, 'SELECT') as allowed`,
      [`public.${relation}`],
    );
    expect(result.rows[0]!.allowed).toBe(true);
  });

  it('never grants write access on ledger_entries to any application role', async () => {
    const result = await db.query<{ role: string; writes: boolean }>(
      `select r as role,
              (has_table_privilege(r, 'public.ledger_entries', 'INSERT')
               or has_table_privilege(r, 'public.ledger_entries', 'UPDATE')
               or has_table_privilege(r, 'public.ledger_entries', 'DELETE')) as writes
       from unnest(array['anon','authenticated','service_role']) as r`,
    );

    for (const row of result.rows) {
      expect(row.writes, `${row.role} must have no direct write on ledger_entries`).toBe(false);
    }
  });
});
