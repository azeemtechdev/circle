import { describe, expect, it } from 'vitest';

import { cadence, nairaClean, potNaira, whenAgo } from './format';

describe('nairaClean', () => {
  it('drops .00 on a whole-naira amount', () => {
    expect(nairaClean('5000000')).toBe('₦50,000');
  });

  it('keeps a real kobo remainder rather than hiding it', () => {
    expect(nairaClean('5000050')).toBe('₦50,000.50');
  });
});

describe('potNaira', () => {
  it('counts every member, recipient included (open_round, migration 0003)', () => {
    // 5 members × ₦50,000 = ₦250,000, not 4 × ₦50,000.
    expect(potNaira('5000000', 5)).toBe('₦250,000');
  });

  it('stays exact beyond 2^53 kobo, where a float would not', () => {
    // 2^53 + 1 kobo, times 2.
    expect(potNaira('9007199254740993', 2)).toBe('₦180,143,985,094,819.86');
  });
});

describe('whenAgo', () => {
  const now = new Date(2026, 9, 21, 15, 0, 0); // Wed 21 Oct 2026, 3pm local

  it('says just now inside ninety seconds', () => {
    expect(whenAgo(new Date(2026, 9, 21, 14, 59, 30).toISOString(), now)).toBe('Just now');
  });

  it('says yesterday for yesterday', () => {
    expect(whenAgo(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toBe('Yesterday');
  });

  it('falls back to a date beyond a week', () => {
    expect(whenAgo(new Date(2026, 8, 28, 9, 0).toISOString(), now)).toMatch(/28/);
  });
});

describe('cadence', () => {
  it('names the common periods in plain words', () => {
    expect(cadence(30)).toBe('monthly');
    expect(cadence(7)).toBe('weekly');
    expect(cadence(10)).toBe('every 10 days');
  });
});
