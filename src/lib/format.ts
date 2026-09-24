import { formatKoboAsNaira, koboFromText } from '@/lib/money';

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

/** A date a person can read, without a library. */
export function shortDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
