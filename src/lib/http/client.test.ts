import { afterEach, describe, expect, it, vi } from 'vitest';

import { callTransition, newIdempotencyKey, TransitionError } from '@/lib/http/client';

/**
 * The browser side of a transition.
 *
 * The header is the whole point: a person on a slow phone taps "I've paid",
 * sees nothing, and taps again. That second tap must carry the SAME key, so the
 * server recognises a replay instead of recording a second payment. This file
 * proves the key reaches the wire untouched and that a dropped connection is
 * reported as retryable rather than as failure.
 */

const calls: Array<{ url: string; init: RequestInit }> = [];

function stubFetch(reply: { status: number; body: unknown } | 'network-error') {
  calls.length = 0;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callTransition', () => {
  it('sends the idempotency key exactly as given', async () => {
    stubFetch({ status: 200, body: { id: 'circle-1' } });

    await callTransition('/api/circles/create-circle', { name: 'Family' }, 'key-abc');

    const init = calls[0]!.init;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('key-abc');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Family' });
  });

  it('sends the same key on a retry, which is what makes a replay a replay', async () => {
    stubFetch({ status: 200, body: { id: 'circle-1' } });
    const key = 'stable-key';

    await callTransition('/api/x', { a: 1 }, key);
    await callTransition('/api/x', { a: 1 }, key);

    const sent = calls.map((c) => new Headers(c.init.headers).get('Idempotency-Key'));
    expect(sent).toEqual([key, key]);
  });

  it('returns the id on success', async () => {
    stubFetch({ status: 200, body: { id: 'round-9' } });
    await expect(callTransition('/api/x', {}, 'k')).resolves.toBe('round-9');
  });

  it('surfaces the server message and status on a refusal', async () => {
    stubFetch({ status: 403, body: { error: 'only the circle owner may invite members' } });

    const error = await callTransition('/api/x', {}, 'k').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransitionError);
    expect((error as TransitionError).status).toBe(403);
    expect((error as TransitionError).message).toBe('only the circle owner may invite members');
  });

  it('falls back to a plain message when the body has no error field', async () => {
    stubFetch({ status: 500, body: { unexpected: true } });

    await expect(callTransition('/api/x', {}, 'k')).rejects.toThrow('Something went wrong.');
  });

  it('reports a dropped connection as retryable, not as failure', async () => {
    stubFetch('network-error');

    const error = await callTransition('/api/x', {}, 'k').catch((e: unknown) => e);

    // Status 0 marks "never reached the server", so the same key is safe to
    // resend — and the message says to try again rather than implying the
    // action did not happen.
    expect((error as TransitionError).status).toBe(0);
    expect((error as TransitionError).message).toMatch(/No connection/);
  });
});

describe('newIdempotencyKey', () => {
  it('gives a different key each time it is called', () => {
    const keys = new Set([newIdempotencyKey(), newIdempotencyKey(), newIdempotencyKey()]);
    expect(keys.size).toBe(3);
  });

  it('is a uuid', () => {
    expect(newIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
