import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newAuthUser, newUserId, type TestDb } from '../support/pglite';

/**
 * Profile provisioning and member lookup (migration 0005).
 *
 * Before this migration `profiles` had no writer at all: a user could sign up
 * and still be impossible to find or invite. These tests prove the trigger
 * fills the gap, that the lookup used by the invite screen resolves a typed
 * phone number to a user id, and — most importantly — that the lookup cannot be
 * used by an anonymous caller to discover who is registered.
 */

async function profileOf(
  db: TestDb,
  id: string,
): Promise<{ display_name: string; email: string | null; phone: string | null } | undefined> {
  const result = await db.query<{ display_name: string; email: string | null; phone: string | null }>(
    `select display_name, email, phone from profiles where id = $1`,
    [id],
  );
  return result.rows[0];
}

describe('a profile is provisioned on signup', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('creates the profile row when a user signs up', async () => {
    const id = await newAuthUser(db, {
      email: 'ada@example.com',
      phone: '08031234567',
      displayName: 'Ada',
    });

    expect(await profileOf(db, id)).toEqual({
      display_name: 'Ada',
      email: 'ada@example.com',
      phone: '+2348031234567',
    });
  });

  it('falls back to the email local part when signup carries no name', async () => {
    const id = await newAuthUser(db, { email: 'grace@example.com' });
    expect((await profileOf(db, id))?.display_name).toBe('grace');
  });

  it('falls back to the phone when there is no name and no email', async () => {
    const id = await newAuthUser(db, { phone: '+2348039998888' });
    expect((await profileOf(db, id))?.display_name).toBe('+2348039998888');
  });

  it('never leaves display_name empty, which the CHECK would reject', async () => {
    const id = await newAuthUser(db, {});
    expect((await profileOf(db, id))?.display_name).toBe('Member');
  });

  it('does not clobber an edited display name if the trigger runs again', async () => {
    const id = await newAuthUser(db, { email: 'renamed@example.com' });
    await db.query(`update profiles set display_name = 'Chosen Name' where id = $1`, [id]);

    // Re-running provisioning for the same id must be a no-op, not an update.
    await db.query(
      `insert into profiles (id, display_name) values ($1, 'clobbered') on conflict (id) do nothing`,
      [id],
    );

    expect((await profileOf(db, id))?.display_name).toBe('Chosen Name');
  });
});

describe('phone normalisation', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  async function normalize(input: string | null): Promise<string | null> {
    const result = await db.query<{ v: string | null }>(`select normalize_phone($1) as v`, [input]);
    return result.rows[0]!.v;
  }

  it.each([
    ['08031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['+234 803 123 4567', '+2348031234567'],
    ['234-803-123-4567', '+2348031234567'],
    ['(0803) 123-4567', '+2348031234567'],
  ])('resolves %s to one canonical number', async (input, expected) => {
    expect(await normalize(input)).toBe(expected);
  });

  it.each([[null], [''], ['   '], ['not a phone'], ['123']])(
    'returns null for junk input %s',
    async (input) => {
      expect(await normalize(input)).toBeNull();
    },
  );

  it('keeps a non-Nigerian international number', async () => {
    expect(await normalize('+1 415 555 0134')).toBe('+14155550134');
  });

  it('refuses two profiles claiming the same phone in different spellings', async () => {
    await newAuthUser(db, { phone: '08035550001', email: 'first@example.com' });
    await expect(
      newAuthUser(db, { phone: '+2348035550001', email: 'second@example.com' }),
    ).rejects.toThrow(/profiles_phone_unique|duplicate key/i);
  });
});

describe('member lookup', () => {
  let db: TestDb;
  let callerId: string;
  let targetId: string;

  beforeAll(async () => {
    db = await createTestDb();
    callerId = await newAuthUser(db, { email: 'caller@example.com', displayName: 'Caller' });
    targetId = await newAuthUser(db, {
      email: 'Target@Example.com',
      phone: '08037654321',
      displayName: 'Target',
    });
  });

  beforeEach(async () => {
    await actAs(db, callerId);
  });

  it('finds a member by the phone as they typed it', async () => {
    const result = await db.query<{ id: string; display_name: string }>(
      `select * from find_profile_by_phone($1)`,
      ['0803 765 4321'],
    );
    expect(result.rows).toEqual([{ id: targetId, display_name: 'Target' }]);
  });

  it('finds a member by email regardless of case', async () => {
    const result = await db.query<{ id: string }>(`select * from find_profile_by_email($1)`, [
      'target@example.com',
    ]);
    expect(result.rows.map((r) => r.id)).toEqual([targetId]);
  });

  it('returns only the id and display name, never the whole profile', async () => {
    const result = await db.query(`select * from find_profile_by_phone($1)`, ['08037654321']);
    expect(result.fields.map((f) => f.name).sort()).toEqual(['display_name', 'id']);
  });

  it('returns nothing for an unknown number rather than erroring', async () => {
    const result = await db.query(`select * from find_profile_by_phone($1)`, ['08000000000']);
    expect(result.rows).toHaveLength(0);
  });

  it('returns nothing for junk input', async () => {
    const result = await db.query(`select * from find_profile_by_email($1)`, ['   ']);
    expect(result.rows).toHaveLength(0);
  });

  it('refuses an anonymous caller, so registration cannot be probed', async () => {
    await actAs(db, null);
    await expect(
      db.query(`select * from find_profile_by_phone($1)`, ['08037654321']),
    ).rejects.toThrow(/requires a signed-in user/);
  });
});

describe('lookup grants', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  // The 0002 defect — EXECUTE defaulting to PUBLIC on a SECURITY DEFINER
  // function — would be an enumeration hole here, not just a write hole.
  it.each([
    ['find_profile_by_phone(text)', 'anon'],
    ['find_profile_by_phone(text)', 'public'],
    ['find_profile_by_email(text)', 'anon'],
    ['find_profile_by_email(text)', 'public'],
    ['handle_new_user()', 'anon'],
    ['handle_new_user()', 'public'],
    ['handle_new_user()', 'authenticated'],
  ])('%s is not executable by %s', async (signature, role) => {
    const result = await db.query<{ ok: boolean }>(
      `select has_function_privilege($1, $2, 'execute') as ok`,
      [role, `public.${signature}`],
    );
    expect(result.rows[0]!.ok).toBe(false);
  });

  it.each([
    ['find_profile_by_phone(text)'],
    ['find_profile_by_email(text)'],
  ])('%s is executable by authenticated', async (signature) => {
    const result = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', $1, 'execute') as ok`,
      [`public.${signature}`],
    );
    expect(result.rows[0]!.ok).toBe(true);
  });
});

describe('invite by phone, end to end', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('turns a typed phone number into a real membership', async () => {
    const ownerId = await newAuthUser(db, { email: 'owner@example.com', displayName: 'Owner' });
    const inviteeId = await newAuthUser(db, { phone: '08051112222', displayName: 'Invitee' });

    await actAs(db, ownerId);
    const circle = await db.query<{ v: string }>(
      `select create_circle($1,$2,$3::bigint,$4,$5) as v`,
      ['p-create', 'Phone circle', '100000', 30, 2],
    );
    const circleId = circle.rows[0]!.v;

    // What the invite screen will do: resolve, then invite.
    const found = await db.query<{ id: string }>(`select id from find_profile_by_phone($1)`, [
      '0805 111 2222',
    ]);
    expect(found.rows[0]!.id).toBe(inviteeId);

    const membership = await db.query<{ v: string }>(
      `select invite_member($1,$2,$3,$4) as v`,
      ['p-invite', circleId, found.rows[0]!.id, 2],
    );

    const row = await db.query<{ user_id: string; status: string }>(
      `select user_id, status from memberships where id = $1`,
      [membership.rows[0]!.v],
    );
    expect(row.rows[0]).toEqual({ user_id: inviteeId, status: 'invited' });
  });

  it('still works for a user with no profile, since invite takes an id', async () => {
    // Guards the deferral: bare ids keep working, so existing fixtures and the
    // lifecycle tests are unaffected by profile provisioning.
    const ownerId = await newAuthUser(db, { email: 'owner2@example.com' });
    const bareId = await newUserId(db);

    await actAs(db, ownerId);
    const circle = await db.query<{ v: string }>(
      `select create_circle($1,$2,$3::bigint,$4,$5) as v`,
      ['p2-create', 'Bare circle', '100000', 30, 2],
    );

    await expect(
      db.query(`select invite_member($1,$2,$3,$4) as v`, [
        'p2-invite',
        circle.rows[0]!.v,
        bareId,
        2,
      ]),
    ).resolves.toBeDefined();
  });
});
