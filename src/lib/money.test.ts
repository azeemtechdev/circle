import { describe, expect, it } from 'vitest';

import {
  assertPostableAmount,
  formatKoboAsNaira,
  koboFromText,
  koboToText,
  nairaToKobo,
} from '@/lib/money';

describe('koboFromText', () => {
  it('parses exact integers, including beyond 2^53', () => {
    expect(koboFromText('0')).toBe(0n);
    expect(koboFromText('-250000')).toBe(-250_000n);
    expect(koboFromText('9007199254740993')).toBe(9_007_199_254_740_993n);
  });

  it('refuses anything that is not a plain integer', () => {
    for (const bad of ['1.5', '1e3', '', ' 12', '12 ', 'abc', '0x10', '1_000', '+5']) {
      expect(() => koboFromText(bad), bad).toThrow(/exact integer number of kobo/);
    }
  });
});

describe('koboToText', () => {
  it('round-trips through text without loss', () => {
    const value = 9_007_199_254_740_993n;
    expect(koboFromText(koboToText(value))).toBe(value);
  });
});

describe('nairaToKobo', () => {
  it('multiplies by 100', () => {
    expect(nairaToKobo(1_000n)).toBe(100_000n);
  });
});

describe('formatKoboAsNaira', () => {
  it('formats with thousands separators and two decimal places', () => {
    expect(formatKoboAsNaira(0n)).toBe('₦0.00');
    expect(formatKoboAsNaira(5n)).toBe('₦0.05');
    expect(formatKoboAsNaira(100n)).toBe('₦1.00');
    expect(formatKoboAsNaira(123_456_789n)).toBe('₦1,234,567.89');
  });

  it('formats negative balances', () => {
    expect(formatKoboAsNaira(-250_000n)).toBe('-₦2,500.00');
  });

  it('does not lose precision on large amounts', () => {
    expect(formatKoboAsNaira(9_007_199_254_740_993n)).toBe('₦90,071,992,547,409.93');
  });
});

describe('assertPostableAmount', () => {
  it('accepts a positive amount', () => {
    expect(() => assertPostableAmount(1n)).not.toThrow();
  });

  it('rejects zero and negatives', () => {
    expect(() => assertPostableAmount(0n)).toThrow(/must be positive/);
    expect(() => assertPostableAmount(-1n)).toThrow(/must be positive/);
  });
});
