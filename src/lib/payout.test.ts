import { describe, expect, it } from 'vitest';

import { changedRecently, daysSinceChange, groupAccountNumber, type PayoutAccount } from './payout';

function account(created: string, updated: string): PayoutAccount {
  return {
    user_id: 'u',
    bank_name: 'GTBank',
    account_number: '0123456789',
    account_name: 'Ada Obi',
    created_at: created,
    updated_at: updated,
  };
}

const NOW = new Date('2026-10-21T12:00:00Z');

describe('changedRecently', () => {
  it('does not warn about details that were never edited', () => {
    expect(changedRecently(account('2026-10-20T12:00:00Z', '2026-10-20T12:00:00Z'), NOW)).toBe(false);
  });

  it('warns about an edit inside the window', () => {
    expect(changedRecently(account('2026-01-01T00:00:00Z', '2026-10-19T12:00:00Z'), NOW)).toBe(true);
  });

  it('stops warning once the edit is older than the window', () => {
    expect(changedRecently(account('2026-01-01T00:00:00Z', '2026-10-13T12:00:00Z'), NOW)).toBe(false);
  });

  it('treats the same instant written two ways as unedited', () => {
    expect(
      changedRecently(account('2026-10-20T12:00:00+00:00', '2026-10-20T12:00:00.000Z'), NOW),
    ).toBe(false);
  });
});

describe('daysSinceChange', () => {
  it('counts whole days', () => {
    expect(daysSinceChange(account('2026-01-01T00:00:00Z', '2026-10-19T11:00:00Z'), NOW)).toBe(2);
  });
});

describe('groupAccountNumber', () => {
  it('groups ten digits and keeps the leading zero', () => {
    expect(groupAccountNumber('0123456789')).toBe('0123 456 789');
  });

  it('leaves anything else untouched rather than mangling it', () => {
    expect(groupAccountNumber('12345')).toBe('12345');
  });
});
