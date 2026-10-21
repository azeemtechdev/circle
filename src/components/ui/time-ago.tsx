'use client';

import { useSyncExternalStore } from 'react';

import { whenAgo } from '@/lib/format';

const noop = () => () => {};

/**
 * "9:12am" / "Yesterday" in the reader's own timezone.
 *
 * The server runs in UTC; formatting there would put every Lagos timestamp an
 * hour out. The server renders the plain date, the browser swaps in the
 * relative form once it is running.
 */
export function TimeAgo({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noop,
    () => whenAgo(iso),
    () => new Date(iso).toISOString().slice(0, 10),
  );
  return <time dateTime={iso}>{text}</time>;
}
