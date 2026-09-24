'use client';

/**
 * Calling a transition endpoint from the browser.
 *
 * The idempotency key is the point of this file. A person on a slow phone taps
 * "I've paid", sees nothing happen, and taps again — that is the normal case,
 * not the edge case. So the key is generated once when an action begins and
 * reused for every retry of that same action: the second request is recognised
 * as a replay, returns the original id, and changes nothing.
 *
 * A new key per attempt would defeat the entire mechanism, which is why
 * `newIdempotencyKey` is separate from `callTransition` and never called
 * inside it.
 */

export class TransitionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TransitionError';
    this.status = status;
  }
}

/** One key per logical action. Hold on to it across retries. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function callTransition(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Mobile data dropping out. Safe to retry with the same key, and worth
    // saying so — the alternative is someone assuming it failed and redoing it.
    throw new TransitionError('No connection. Check your network and try again.', 0);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'Something went wrong.';
    throw new TransitionError(message, response.status);
  }

  return String((payload as { id: string }).id);
}
