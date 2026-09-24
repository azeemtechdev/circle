import { beforeAll, describe, expect, it } from 'vitest';

import { actAs, createTestDb, newAuthUser, type TestDb } from '../support/pglite';

/**
 * Profile self-service (migration 0007).
 *
 * 0005 provisioned profiles from auth.users.phone, which is only populated for
 * SMS signups. Circle signs people up with email and password, so every
 * profile was created with a null phone and find_profile_by_phone could never
 * locate anyone — the invite flow 0005 existed to unblock still did not work.
 * And nothing could edit a profile afterwards, so there was no way to recover.
 */

async function phoneOf(db: TestDb, id: string): Promise<string | null> {
  const result = await db.query<{ phone: string | null }>(
    `select phone from profiles where id = $1`,
    [id],
  );
  return result.rows[0]!.phone;
}

async function nameOf(db: TestDb, id: string): Promise<string> {
  const result = await db.query<{ display_name: string }>(
    `select display_name from profiles where id = $1`,
    [id],
  );
  return result.rows[0]!.display_name;
}

/** Signs up the way the signup form does: email, password, phone in metadata. */
async function signUpWithMetadata(
  db: TestDb,
  opts: { email: string; displayName?: string; phone?: string },
): Promise<string> {
  const meta: Record<string, string> = {};
  if (opts.displayName) meta['display_name'] = opts.displayName;
  if (opts.phone) meta['phone'] = opts.phone;

  const result = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [opts.email, JSON.stringify(meta)],
  );
  return result.rows[0]!.id;
}

describe('signup metadata carries the phone', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('provisions the phone from metadata on an email signup', async () => {
    const id = await signUpWithMetadata(db, {
      email: 'meta@example.com',
      displayName: 'Meta',
      phone: '0803 111 2222',
    });

    expect(await phoneOf(db, id)).toBe('+2348031112222');
  });

  it('makes that user findable, which is the whole point', async () => {
    const id = await signUpWithMetadata(db, {
      email: 'findable@example.com',
      displayName: 'Findable',
      phone: '08033334444',
    });

    await actAs(db, id);
    const found = await db.query<{ id: string }>(`select id from find_profile_by_phone($1)`, [
      '+234 803 333 4444',
    ]);
    expect(found.rows[0]!.id).toBe(id);
  });

  it('still prefers auth.users.phone when an SMS signup sets it', async () => {
    const id = await newAuthUser(db, { phone: '08055556666', email: 'sms@example.com' });
    expect(await phoneOf(db, id)).toBe('+2348055556666');
  });
});

describe('update_my_profile', () => {
  let db: TestDb;
  let userId: string;

  beforeAll(async () => {
    db = await createTestDb();
    userId = await signUpWithMetadata(db, { email: 'editor@example.com', displayName: 'Before' });
    await actAs(db, userId);
  });

  it('sets a phone on a profile that had none', async () => {
    await db.query(`select update_my_profile(null, $1)`, ['08061112222']);
    expect(await phoneOf(db, userId)).toBe('+2348061112222');
  });

  it('changes the display name without touching the phone', async () => {
    await db.query(`select update_my_profile($1, null)`, ['After']);
    expect(await nameOf(db, userId)).toBe('After');
    expect(await phoneOf(db, userId)).toBe('+2348061112222');
  });

  it('clears the phone when given an empty string', async () => {
    await db.query(`select update_my_profile(null, $1)`, ['']);
    expect(await phoneOf(db, userId)).toBeNull();
    // Restore for the tests below.
    await db.query(`select update_my_profile(null, $1)`, ['08061112222']);
  });

  it('rejects a blank display name rather than storing one', async () => {
    await expect(db.query(`select update_my_profile($1, null)`, ['   '])).rejects.toThrow(
      /display name cannot be blank/,
    );
    expect(await nameOf(db, userId)).toBe('After');
  });

  it('rejects an unrecognisable phone instead of silently clearing it', async () => {
    // The dangerous alternative: normalize_phone returns null for junk, so a
    // typo would wipe the number and the user would quietly stop being
    // findable.
    await expect(db.query(`select update_my_profile(null, $1)`, ['12'])).rejects.toThrow(
      /is not a phone number/,
    );
    expect(await phoneOf(db, userId)).toBe('+2348061112222');
  });

  it('refuses a phone already registered to someone else', async () => {
    const other = await signUpWithMetadata(db, {
      email: 'other@example.com',
      phone: '08077778888',
    });
    expect(other).toBeTruthy();

    await expect(db.query(`select update_my_profile(null, $1)`, ['08077778888'])).rejects.toThrow(
      /already registered to another account/,
    );
  });

  it('only ever edits the caller’s own row', async () => {
    const victim = await signUpWithMetadata(db, {
      email: 'victim@example.com',
      displayName: 'Victim',
    });

    // There is no user-id parameter to pass — that was the 0004 defect. The
    // most an attacker can do is change their own name.
    await actAs(db, userId);
    await db.query(`select update_my_profile($1, null)`, ['Attacker']);

    expect(await nameOf(db, victim)).toBe('Victim');
    expect(await nameOf(db, userId)).toBe('Attacker');
  });

  it('refuses an anonymous caller', async () => {
    await actAs(db, null);
    await expect(db.query(`select update_my_profile($1, null)`, ['Nobody'])).rejects.toThrow(
      /requires a signed-in user/,
    );
  });
});

describe('update_my_profile grants', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it.each([['anon'], ['public']])('is not executable by %s', async (role) => {
    const result = await db.query<{ ok: boolean }>(
      `select has_function_privilege($1, 'public.update_my_profile(text, text)', 'execute') as ok`,
      [role],
    );
    expect(result.rows[0]!.ok).toBe(false);
  });

  it('is executable by authenticated', async () => {
    const result = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'public.update_my_profile(text, text)', 'execute') as ok`,
    );
    expect(result.rows[0]!.ok).toBe(true);
  });
});
