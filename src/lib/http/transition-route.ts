import { CircleError } from '@/lib/circles/circles';
import { DatabaseError } from '@/lib/db-error';

/**
 * The one place a transition becomes an HTTP endpoint.
 *
 * Every mutating route is the same four steps — require an idempotency key,
 * read the body, call one state machine function, turn a Postgres error into a
 * status code — so they share this instead of each route growing its own
 * slightly different version of the rule. Eight copies of an idempotency check
 * is eight chances for one of them to be missing.
 *
 * Note what is NOT here: no authorization, no status writes, no business rules.
 * The actor comes from the session cookie and is derived inside the SQL by
 * auth.uid(); a route cannot name a different one even if it tried. This layer
 * translates, and nothing else.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Postgres SQLSTATE to HTTP status.
 *
 * Matching on SQLSTATE, not on message text: the messages are written to be
 * read by people and will be reworded.
 */
const STATUS_BY_SQLSTATE: Record<string, number> = {
  // raise ... using errcode = 'insufficient_privilege' — not the owner, not the
  // payer, not the recipient, or not signed in at all.
  '42501': 403,
  // 'check_violation' — the request was well formed but the state machine says
  // no: wrong status for this transition, member target exceeded, blank key.
  // 409 rather than 400; the payload is fine, the world is not in the right
  // shape yet, and retrying later can succeed.
  '23514': 409,
  // 'foreign_key_violation' — every "no such circle/round/contribution" raises
  // with this.
  '23503': 404,
  // 'unique_violation' — already invited, position taken, phone registered.
  '23505': 409,
  // 'lock_not_available' — claim_idempotency_key found a request with this key
  // still in flight. The client should retry, not treat it as failure.
  '55P03': 409,
  // 'no_data_found'
  P0002: 404,
};

export interface TransitionResult {
  /** The entity the transition returned: circle, membership, round, or contribution. */
  id: string;
}

export interface TransitionHandler<TInput> {
  /**
   * Turns the parsed JSON body plus the header key into service input.
   * Throw CircleError for anything malformed — it becomes a 400.
   */
  parse: (body: Record<string, unknown>, idempotencyKey: string) => TInput;
  run: (input: TInput) => Promise<string>;
}

export async function handleTransition<TInput>(
  request: Request,
  handler: TransitionHandler<TInput>,
): Promise<Response> {
  const idempotencyKey = request.headers.get(IDEMPOTENCY_HEADER)?.trim() ?? '';

  // CLAUDE.md: every mutating route requires an idempotency key. Rejecting
  // before the body is even read makes it impossible for a route to do the work
  // first and check afterwards.
  if (idempotencyKey === '') {
    return problem(400, `An ${IDEMPOTENCY_HEADER} header is required for every mutating request.`);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return problem(400, 'The request body must be a JSON object.');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return problem(400, 'The request body must be valid JSON.');
  }

  let input: TInput;
  try {
    input = handler.parse(body, idempotencyKey);
  } catch (error) {
    if (error instanceof CircleError) return problem(400, error.message);
    throw error;
  }

  try {
    const id = await handler.run(input);
    // 200, not 201: a replay returns the original id and creates nothing, and
    // the caller cannot tell the two apart — which is the entire point of an
    // idempotent endpoint. Claiming 201 on a replay would be a lie.
    return Response.json({ id } satisfies TransitionResult, { status: 200 });
  } catch (error) {
    // Service-level validation the SQL would also reject.
    if (error instanceof CircleError) return problem(400, error.message);

    if (error instanceof DatabaseError) {
      const status = error.code ? STATUS_BY_SQLSTATE[error.code] : undefined;
      // Only messages behind a status we chose deliberately are surfaced. An
      // unmapped error is a bug, and its text could be anything — a constraint
      // name, a function signature, a fragment of SQL.
      if (status) return problem(status, cleanMessage(error.message));
      console.error('Unmapped database error', { code: error.code, message: error.message });
      return problem(500, 'Something went wrong. Nothing was changed.');
    }

    throw error;
  }
}

/**
 * Turns a database message into something worth showing a caller.
 *
 * Two kinds of 42501 reach here. A `raise ... using errcode =
 * 'insufficient_privilege'` in a transition function carries a sentence written
 * for a person ("only the circle owner may invite members") and is passed
 * through. A GRANT refusal carries "permission denied for function
 * create_circle" — Postgres internals, and the one a signed-out caller hits,
 * because anon holds no EXECUTE on the transition functions and never reaches
 * current_actor() at all. That one is replaced.
 */
function cleanMessage(message: string): string {
  const withoutPrefix = message.replace(/^\w+ failed: /, '');

  if (/permission denied for (function|relation|table|schema)/i.test(withoutPrefix)) {
    return 'You need to be signed in to do that.';
  }

  // A unique violation reaches here as "duplicate key value violates unique
  // constraint "memberships_one_per_position"" — a constraint name is not
  // something to show a person. Each of these is a thing they can actually
  // understand and act on.
  for (const [constraint, explanation] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (withoutPrefix.includes(constraint)) return explanation;
  }

  if (/duplicate key value violates/i.test(withoutPrefix)) {
    return 'That has already been added.';
  }

  return withoutPrefix;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  memberships_one_per_user_per_circle: 'That person is already in this circle.',
  memberships_one_per_position: 'Somebody already has that position in the rotation.',
  contributions_one_per_payer_per_round: 'That payment has already been recorded for this round.',
  rounds_one_payout_per_member: 'That member is already due to collect in another round.',
  profiles_phone_unique: 'That phone number is already registered to another account.',
};

function problem(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Reads a required string field, with a message a person could act on. */
export function requiredString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CircleError(`"${field}" is required.`);
  }
  return value.trim();
}

/** Reads an optional string field; absent, null and empty all mean "not given". */
export function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new CircleError(`"${field}" must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Reads a required whole number. Rejects the string "3" — a typo, not a number. */
export function requiredInteger(
  body: Record<string, unknown>,
  field: string,
): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new CircleError(`"${field}" must be a whole number.`);
  }
  return value;
}

/**
 * Reads an amount in kobo.
 *
 * Accepts a string of digits or a safe integer, and returns bigint. A JSON
 * number above 2^53 has already lost precision by the time it reaches here, so
 * anything that large must arrive as a string — CLAUDE.md forbids a float
 * anywhere in a money path, and a JSON number is a double.
 */
export function requiredKobo(body: Record<string, unknown>, field: string): bigint {
  const value = body[field];

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new CircleError(`"${field}" must be a whole number of kobo.`);
    }
    return BigInt(value.trim());
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new CircleError(`"${field}" must be a whole number of kobo, not a decimal.`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new CircleError(
        `"${field}" is too large to be exact as a JSON number; send it as a string.`,
      );
    }
    return BigInt(value);
  }

  throw new CircleError(`"${field}" is required and must be a whole number of kobo.`);
}
