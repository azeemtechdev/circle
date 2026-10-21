'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};

function byHour(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Uses the reader's clock, not the server's (which runs in UTC). */
export function Greeting({ name }: { name: string }) {
  const hello = useSyncExternalStore(noop, byHour, () => 'Hello');
  return (
    <span>
      {hello}, {name}
    </span>
  );
}
