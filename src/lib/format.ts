import { formatKoboAsNaira, koboFromText, koboToText } from '@/lib/money';

/**
 * Display helpers. The UI edge, and nothing beyond it — a value formatted here
 * must never be parsed back into a calculation.
 */

/** Formats a `..._kobo_text` column straight from a view. */
export function naira(koboText: string): string {
  return formatKoboAsNaira(koboFromText(koboText));
}

/**
 * "in 3 days" / "today" / "5 days ago".
 *
 * Whole days only, compared at midnight, because "in 23 hours" reads as
 * tomorrow to a person looking at a due date.
 */
export function countdown(isoDate: string, now: Date = new Date()): string {
  const due = new Date(`${isoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days === -1) return '1 day late';
  if (days > 1) return `due in ${days} days`;
  return `${-days} days late`;
}

export function isOverdue(isoDate: string, now: Date = new Date()): boolean {
  const due = new Date(`${isoDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return due.getTime() < today.getTime();
}

/**
 * "₦50,000" for a whole-naira amount, "₦50,000.50" otherwise.
 *
 * The big hero numbers read better without ".00", but a real kobo remainder is
 * never hidden — rounding it away would show a payer the wrong amount to send.
 */
export function nairaClean(koboText: string): string {
  return naira(koboText).replace(/\.00$/, '');
}

/**
 * The whole pot for a round: every member's share, recipient included.
 *
 * open_round (migration 0003) creates a contribution for every joined member,
 * the recipient too, so the pot is amount × members — not amount × (members −
 * 1). BigInt throughout; the result is only ever displayed.
 */
export function potNaira(amountKoboText: string, members: number): string {
  return nairaClean(koboToText(koboFromText(amountKoboText) * BigInt(members)));
}

/** "Wed 28 Oct" — for due dates inside the current year's rotation. */
export function dayMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "Just now", "9:12am", "Yesterday", "Tuesday", "28 Sep" — for the activity feed. */
export function whenAgo(isoTimestamp: string, now: Date = new Date()): string {
  const then = new Date(isoTimestamp);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (seconds < 90) return 'Just now';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (then.getTime() >= startOfToday) {
    return then
      .toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s/g, '')
      .toLowerCase();
  }
  if (then.getTime() >= startOfToday - dayMs) return 'Yesterday';
  if (then.getTime() >= startOfToday - 6 * dayMs) {
    return then.toLocaleDateString('en-NG', { weekday: 'long' });
  }
  return then.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/** "every month" / "every week" / "every 10 days". */
export function cadence(periodDays: number): string {
  if (periodDays === 7) return 'weekly';
  if (periodDays === 14) return 'every two weeks';
  if (periodDays === 30 || periodDays === 31) return 'monthly';
  return `every ${periodDays} days`;
}

/** A date a person can read, without a library. */
export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
