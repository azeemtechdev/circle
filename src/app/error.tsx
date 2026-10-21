'use client';

import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';

import { Icon } from '@/components/ui/icon';

const noop = () => () => {};

/**
 * Any screen that failed to load.
 *
 * The usual cause on a phone is the connection, so that is said first when the
 * browser knows it is offline. Server errors arrive here with their message
 * stripped in production (Next does that on purpose), so the copy is generic
 * and the digest is shown for matching against the server logs.
 *
 * `retry` (Next 16.2+) re-fetches the segment, not just re-renders it.
 */
export default function ErrorScreen({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const offline = useSyncExternalStore(
    noop,
    () => !navigator.onLine,
    () => false,
  );

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="done" role="alert">
      <div className="tick" style={{ background: 'var(--bad-bg)', color: 'var(--bad)' }}>
        <Icon name={offline ? 'wifiOff' : 'alert'} size={40} />
      </div>
      <h1>{offline ? 'No connection' : 'This did not load'}</h1>
      <p className="mute" style={{ margin: '10px 0 22px' }}>
        {offline
          ? 'Check your data or Wi-Fi, then try again. Nothing you did was lost.'
          : 'Something went wrong on our side. Try again in a moment. Nothing you did was lost.'}
      </p>
      <button type="button" className="btn" onClick={() => retry()}>
        Try again
      </button>
      <Link href="/dashboard" className="btn btn--outline" style={{ marginTop: 10 }}>
        Back to home
      </Link>
      {error.digest ? (
        <p className="mute small" style={{ marginTop: 16 }}>
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
