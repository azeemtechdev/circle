import { describe, expect, it } from 'vitest';

import { countdown, isOverdue, naira, shortDate } from '@/lib/format';
import { koboFromNairaInput, koboToText } from '@/lib/money';

const nairaInputToKoboText = (input: string): string => koboToText(koboFromNairaInput(input));

/**
 * The UI edge.
 *
 * nairaInputToKoboText is the riskiest function in the interface: it is where a
 * human types money. The obvious implementation is `Math.round(Number(input) *
 * 100)`, and `2000.10 * 100` is 200010.00000000003 in JavaScript. CLAUDE.md
 * bans a float anywhere in a money path, so this converts with string
 * arithmetic and BigInt instead — and these cases are what prove it.
 */
describe('naira input becomes exact kobo', () => {
  it.each([
    ['5000', '500000'],
    ['5000.50', '500050'],
    // The case a float gets wrong.
    ['2000.10', '200010'],
    ['0.01', '1'],
    ['0', '0'],
    ['0.1', '10'],
    ['1234.5', '123450'],
    // Formatting people actually type.
    ['₦5,000', '500000'],
    [' 5000 ', '500000'],
  ])('converts %s to %s kobo', (input, expected) => {
    expect(nairaInputToKoboText(input)).toBe(expected);
  });

  it('stays exact far above what a double can hold', () => {
    // 90071992547409.93 naira in kobo is above 2^53.
    expect(nairaInputToKoboText('90071992547409.93')).toBe('9007199254740993');
  });

  it.each([['abc'], [''], ['5000.123'], ['-100'], ['1e5'], ['5,00.0.1'], ['.']])(
    'rejects %s rather than guessing',
    (input) => {
      expect(() => nairaInputToKoboText(input)).toThrow(/Enter an amount/);
    },
  );
});

describe('naira formatting', () => {
  it.each([
    ['500000', '₦5,000.00'],
    ['1', '₦0.01'],
    ['0', '₦0.00'],
    ['9007199254740993', '₦90,071,992,547,409.93'],
  ])('formats %s kobo as %s', (kobo, expected) => {
    expect(naira(kobo)).toBe(expected);
  });

  it('refuses a value that has been through a float', () => {
    expect(() => naira('1000.5')).toThrow(/never pass through a float/);
  });
});

describe('countdown', () => {
  const today = new Date(2026, 2, 15); // 15 March 2026, local time.

  it.each([
    ['2026-03-15', 'due today'],
    ['2026-03-16', 'due tomorrow'],
    ['2026-03-18', 'due in 3 days'],
    ['2026-03-14', '1 day late'],
    ['2026-03-10', '5 days late'],
  ])('describes %s as "%s"', (date, expected) => {
    expect(countdown(date, today)).toBe(expected);
  });

  it('does not call a due date late on the day it is due', () => {
    expect(isOverdue('2026-03-15', today)).toBe(false);
    expect(isOverdue('2026-03-14', today)).toBe(true);
  });

  it('counts whole days, not hours', () => {
    // Late in the evening, tomorrow is still tomorrow.
    const evening = new Date(2026, 2, 15, 23, 30);
    expect(countdown('2026-03-16', evening)).toBe('due tomorrow');
  });
});

describe('shortDate', () => {
  it('renders a date without shifting it across a timezone', () => {
    // Parsed as local midnight, not UTC — otherwise a date west of UTC renders
    // as the day before.
    expect(shortDate('2026-03-01')).toMatch(/1 Mar 2026/);
  });
});
