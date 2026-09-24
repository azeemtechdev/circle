/**
 * A database error that kept its SQLSTATE.
 *
 * The ports used to throw a plain Error, which flattened everything into a
 * string. That was fine while the only caller was a test, but an HTTP layer has
 * to tell "you are not the owner" (403) from "no such circle" (404) from "the
 * round is not settled yet" (409), and the only reliable signal for that is the
 * SQLSTATE the transition functions raise with.
 *
 * Matching on message text instead would break the moment a message is reworded
 * — and the messages are written for humans, so they will be.
 */
export class DatabaseError extends Error {
  /** SQLSTATE, e.g. '42501'. Null when the driver gave us nothing. */
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

/** Reads a SQLSTATE off whatever the driver threw, without trusting its shape. */
export function sqlStateOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}
