/**
 * Money.
 *
 * The rule (CLAUDE.md, PLAN.md §4 invariant 4): money is an integer number of
 * kobo, held as a `bigint`. Never a `number` — a JS number is an IEEE-754
 * double, and the moment a fraction or a value above 2^53 appears, the amount
 * is quietly wrong. Never `parseFloat`.
 *
 * 100 kobo = ₦1. Formatting for humans happens only at the UI edge, via
 * `formatKoboAsNaira`.
 */

export type Kobo = bigint;

const KOBO_PER_NAIRA = 100n;

/** Matches an optionally-negative run of digits, and nothing else. */
const INTEGER_TEXT = /^-?\d+$/;

/**
 * Parses an exact integer string of kobo, as read from the database.
 *
 * BIGINT crosses the boundary as text precisely so that this is the only
 * conversion point. Anything that is not a plain integer — a decimal point,
 * exponent notation, whitespace, an empty string — is a bug upstream and
 * throws rather than being coerced.
 */
export function koboFromText(text: string): Kobo {
  if (!INTEGER_TEXT.test(text)) {
    throw new Error(
      `Not an exact integer number of kobo: ${JSON.stringify(text)}. ` +
        `Money must never pass through a float.`,
    );
  }
  return BigInt(text);
}

/** Serialises kobo for transport. JSON cannot encode a bigint. */
export function koboToText(kobo: Kobo): string {
  return kobo.toString();
}

/** Converts whole naira to kobo. */
export function nairaToKobo(naira: bigint): Kobo {
  return naira * KOBO_PER_NAIRA;
}

/**
 * Formats kobo as naira for display. UI edge only — never feed the result of
 * this back into a calculation.
 */
export function formatKoboAsNaira(kobo: Kobo): string {
  const negative = kobo < 0n;
  const absolute = negative ? -kobo : kobo;

  const naira = absolute / KOBO_PER_NAIRA;
  const remainder = absolute % KOBO_PER_NAIRA;

  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const kobopart = remainder.toString().padStart(2, '0');

  return `${negative ? '-' : ''}₦${grouped}.${kobopart}`;
}

/** Guards an amount before it reaches the ledger. */
export function assertPostableAmount(kobo: Kobo): void {
  if (kobo <= 0n) {
    throw new Error(`A posted amount must be positive kobo, got ${kobo.toString()}`);
  }
}
