import { beforeAll, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newUserId, type TestDb } from '../support/pglite';

/**
 * Idempotency keys must match on payload, not just on the key (migration 0006).
 *
 * The rule in CLAUDE.md is "same key + same payload -> return the original
 * result, do nothing". Before 0006 the claim matched on the key alone and did
 * not even compare the operation it was already recording, so a key reused for
 * a different request handed back the wrong entity's id and looked like a
 * successful replay while doing it.
 *
 * The replay tests elsewhere prove the "do nothing" half. These prove the
 * "same payload" half, which is the half that was missing.
 */
describe('an idempotency key is bound to its request', () => {
  let db: TestDb;
  let ownerId: string;

  beforeAll(async () => {
    db = await createTestDb();
    ownerId = await newUserId(db);
    await actAs(db, ownerId);
  });

  async function createCircle(key: string, name: string, memberTarget = 3): Promise<string> {
    const result = await db.query<{ v: string }>(
      `select create_circle($1,$2,$3::bigint,$4,$5) as v`,
      [key, name, '100000', 30, memberTarget],
    );
    return result.rows[0]!.v;
  }

  it('still returns the original id for the same key and the same payload', async () => {
    const first = await createCircle('same-payload', 'Unchanged');
    const second = await createCircle('same-payload', 'Unchanged');

    expect(second).toBe(first);

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from circles where name = 'Unchanged'`,
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it('refuses the same key with a different payload instead of returning a stale id', async () => {
    await createCircle('changed-payload', 'Original');

    await expect(createCircle('changed-payload', 'Different name')).rejects.toThrow(
      /different arguments/,
    );
  });

  it('notices a payload difference in any argument, not just the first', async () => {
    await createCircle('changed-target', 'Target test', 3);

    await expect(createCircle('changed-target', 'Target test', 4)).rejects.toThrow(
      /different arguments/,
    );
  });

  it('refuses the same key under a different operation', async () => {
    const circleId = await createCircle('crossed-operation', 'Crossed');

    // This is the defect in its sharpest form: before 0006 this call returned
    // the CIRCLE's id from a function whose contract is to return a membership
    // id, and the caller had no way to tell.
    const inviteeId = await newUserId(db);
    await expect(
      db.query(`select invite_member($1,$2,$3,$4) as v`, [
        'crossed-operation',
        circleId,
        inviteeId,
        2,
      ]),
    ).rejects.toThrow(/already used for create_circle/);
  });

  it('writes nothing when it refuses', async () => {
    await createCircle('refusal-is-clean', 'Clean');

    await expect(createCircle('refusal-is-clean', 'Dirty')).rejects.toThrow();

    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from circles where name = 'Dirty'`,
    );
    expect(count.rows[0]!.n).toBe(0);
  });

  it('still requires a key at all', async () => {
    await expect(createCircle('   ', 'Blank key')).rejects.toThrow(/idempotency key is required/);
  });

  it('records the hash alongside the key', async () => {
    await createCircle('hash-recorded', 'Recorded');

    const row = await db.query<{ operation: string; payload_hash: string | null }>(
      `select operation, payload_hash from idempotency_keys where key = 'hash-recorded'`,
    );
    expect(row.rows[0]!.operation).toBe('create_circle');
    expect(row.rows[0]!.payload_hash).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('payload hashing', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  async function hash(parts: (string | null)[]): Promise<string> {
    const placeholders = parts.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query<{ v: string }>(
      `select idempotency_payload_hash(${placeholders}) as v`,
      parts,
    );
    return result.rows[0]!.v;
  }

  it('does not let a boundary shift collide', async () => {
    // ('ab','c') and ('a','bc') must differ, or two different requests could
    // be mistaken for a replay of one another.
    expect(await hash(['ab', 'c'])).not.toBe(await hash(['a', 'bc']));
  });

  it('distinguishes a null argument from an empty one', async () => {
    expect(await hash(['x', null])).not.toBe(await hash(['x', '']));
  });

  it('is stable for identical input', async () => {
    expect(await hash(['x', 'y'])).toBe(await hash(['x', 'y']));
  });
});

describe('idempotency internals stay locked down', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  // claim_idempotency_key was dropped and recreated, which discards its grants.
  // A recreated function defaults to PUBLIC execute -- the 0002 defect coming
  // back through the back door.
  it.each([
    ['claim_idempotency_key(text, text, text)', 'public'],
    ['claim_idempotency_key(text, text, text)', 'anon'],
    ['claim_idempotency_key(text, text, text)', 'authenticated'],
    ['idempotency_payload_hash(text[])', 'public'],
    ['idempotency_payload_hash(text[])', 'anon'],
    ['idempotency_payload_hash(text[])', 'authenticated'],
  ])('%s is not executable by %s', async (signature, role) => {
    const result = await db.query<{ ok: boolean }>(
      `select has_function_privilege($1, $2, 'execute') as ok`,
      [role, `public.${signature}`],
    );
    expect(result.rows[0]!.ok).toBe(false);
  });

  it('leaves no two-argument version callable', async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_idempotency_key'
          and p.pronargs = 2`,
    );
    expect(result.rows[0]!.n).toBe(0);
  });
});
