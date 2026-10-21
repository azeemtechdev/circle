'use client';

import { useSyncExternalStore } from 'react';

/**
 * A strip across the top while the phone has no connection.
 *
 * Says what still holds: the buttons keep their idempotency key across a
 * retry, so pressing again once the signal is back is safe and cannot record
 * a payment twice — the thing a person on flaky mobile data worries about.
 */
function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  if (online) return null;
  return (
    <div className="offline" role="status">
      You are offline. This page may be out of date. Anything you press is safe to press again
      once you are back.
    </div>
  );
}
