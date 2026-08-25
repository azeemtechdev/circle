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

/**
 * Signs the session in as a given user.
 *
 * Migration 0004 derives the actor from `auth.uid()`, which reads the request
 * JWT's `sub` claim. Setting that claim is how a test says who is calling — the
 * same mechanism PostgREST uses in production, so the authorization checks
 * under test are the real ones.
 *
 * Pass null to become anonymous.
 */
export async function actAs(db: TestDb, userId: string | null): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
}

/** Creates a user id and returns it. There is no auth.users in PGlite. */
export async function newUserId(db: TestDb): Promise<string> {
  const result = await db.query<{ id: string }>('select gen_random_uuid() as id');
  return result.rows[0]!.id;
}

/**
 * Seeds a circle with real rows and returns its accounts: one per member plus
 * the clearing account.
 *
 * Since migration 0003 gave `accounts` foreign keys onto `circles` and
 * `memberships`, the circle and its memberships have to genuinely exist — a
 * fabricated uuid is rejected, which is the point of the constraint.
 *
 * This writes the rows directly rather than going through create_circle /
 * invite_member on purpose: these are the *ledger* fixtures, and they should
 * not depend on the Phase 2 state machine being correct.
 */
export async function seedCircleAccounts(
  db: TestDb,
  memberCount: number,
): Promise<{
  circleId: string;
  membershipIds: string[];
  memberAccountIds: string[];
  clearingAccountId: string;
}> {
  const circle = await db.query<{ id: string }>(
    `insert into circles (name, amount_kobo, period_days, member_target)
     values ('ledger fixture', 100000, 30, $1)
     returning id`,
    // member_target has a CHECK of 2..50; ledger fixtures sometimes want one
    // account, which is fine — nothing here activates the circle.
    [Math.min(50, Math.max(2, memberCount))],
  );
  const circleId = circle.rows[0]!.id;

  const membershipIds: string[] = [];
  const memberAccountIds: string[] = [];

  for (let i = 0; i < memberCount; i += 1) {
    const membership = await db.query<{ id: string }>(
      `insert into memberships (circle_id, user_id, payout_position, status)
       values ($1, gen_random_uuid(), $2, 'joined')
       returning id`,
      [circleId, i + 1],
    );
    const membershipId = membership.rows[0]!.id;
    membershipIds.push(membershipId);

    const account = await db.query<{ id: string }>(
      `insert into accounts (circle_id, membership_id, kind)
       values ($1, $2, 'member')
       returning id`,
      [circleId, membershipId],
    );
    memberAccountIds.push(account.rows[0]!.id);
  }

  const clearing = await db.query<{ id: string }>(
    `insert into accounts (circle_id, membership_id, kind)
     values ($1, null, 'clearing')
     returning id`,
    [circleId],
  );

  return { circleId, membershipIds, memberAccountIds, clearingAccountId: clearing.rows[0]!.id };
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
