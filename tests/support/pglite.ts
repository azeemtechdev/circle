import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

/**
 * Test database.
 *
 * PGlite is PostgreSQL compiled to WebAssembly, running in-process — real
 * Postgres semantics (plpgsql, triggers, roles, generated columns, BIGINT)
 * with no Docker and no network. Each call gets a fresh in-memory database, so
 * tests cannot leak state into one another.
 *
 * The migrations applied here are the same files deployed to Supabase, so the
 * invariants are tested against the SQL that actually runs in production.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

export type TestDb = PGlite;

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create();

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (cause) {
      throw new Error(`Migration ${file} failed: ${(cause as Error).message}`, { cause });
    }
  }

  return db;
}

/** Inserts a circle's accounts: one per member plus the clearing account. */
export async function seedCircleAccounts(
  db: TestDb,
  memberCount: number,
): Promise<{ circleId: string; memberAccountIds: string[]; clearingAccountId: string }> {
  const circle = await db.query<{ circle_id: string }>('select gen_random_uuid() as circle_id');
  const circleId = circle.rows[0]!.circle_id;

  const memberAccountIds: string[] = [];
  for (let i = 0; i < memberCount; i += 1) {
    const inserted = await db.query<{ id: string }>(
      `insert into accounts (circle_id, membership_id, kind)
       values ($1, gen_random_uuid(), 'member')
       returning id`,
      [circleId],
    );
    memberAccountIds.push(inserted.rows[0]!.id);
  }

  const clearing = await db.query<{ id: string }>(
    `insert into accounts (circle_id, membership_id, kind)
     values ($1, null, 'clearing')
     returning id`,
    [circleId],
  );

  return { circleId, memberAccountIds, clearingAccountId: clearing.rows[0]!.id };
}

/**
 * Reads the signed sum of the whole ledger as an exact integer.
 * BIGINT crosses the boundary as text: a JS number is a double, and CLAUDE.md
 * forbids floats in a money path.
 */
export async function ledgerNet(db: TestDb): Promise<bigint> {
  const result = await db.query<{ net: string }>(
    `select coalesce(sum(signed_amount_kobo), 0)::text as net from ledger_entries`,
  );
  return BigInt(result.rows[0]!.net);
}

export async function accountBalance(db: TestDb, accountId: string): Promise<bigint> {
  const result = await db.query<{ balance: string }>(
    `select balance_kobo::text as balance from account_balances where account_id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No account ${accountId}`);
  return BigInt(row.balance);
}
