/**
 * Environment configuration.
 *
 * Rules (see CLAUDE.md):
 * - Secrets live in `.env.local` (gitignored) or the host's env panel. Never here.
 * - Reads are explicit and validated, so a missing key fails loudly at the edge
 *   instead of producing a mysterious 500 deep inside a request.
 *
 * Absent config and *malformed* config are treated differently on purpose:
 * absent returns `null` (a fresh clone is allowed to have no Supabase project),
 * malformed throws with the exact fix. Silently returning `null` for a typo'd
 * URL would make the smoke test skip and read as "not set up yet".
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * The shape we read env from. Deliberately looser than `NodeJS.ProcessEnv`
 * (which Next augments with required fields) so tests can pass plain objects.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Env var names, in one place so tests and docs can reference them. */
export const SUPABASE_ENV_KEYS = {
  url: 'NEXT_PUBLIC_SUPABASE_URL',
  anonKey: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
} as const;

/**
 * Reads Supabase config without requiring it to be present.
 *
 * @returns config, or `null` when either value is missing or still an unedited
 *   `.env.example` placeholder.
 * @throws if a value IS present but malformed — a typo must never masquerade as
 *   "not configured yet".
 */
export function readSupabaseEnv(source: EnvSource = process.env): SupabaseEnv | null {
  const rawUrl = source[SUPABASE_ENV_KEYS.url];
  const rawAnonKey = source[SUPABASE_ENV_KEYS.anonKey];

  if (!isConfigured(rawUrl) || !isConfigured(rawAnonKey)) return null;

  return {
    url: normalizeSupabaseUrl(rawUrl),
    anonKey: normalizeAnonKey(rawAnonKey),
  };
}

/**
 * Reads Supabase config, throwing a message that says exactly what to do.
 * Use this in app code; use `readSupabaseEnv` where absence is acceptable.
 */
export function requireSupabaseEnv(source: EnvSource = process.env): SupabaseEnv {
  const env = readSupabaseEnv(source);
  if (env) return env;

  throw new Error(
    `Supabase is not configured. Copy .env.example to .env.local and set ` +
      `${SUPABASE_ENV_KEYS.url} and ${SUPABASE_ENV_KEYS.anonKey} ` +
      `(Supabase dashboard → Project Settings → API).`,
  );
}

/** A value counts as configured only if it is present and not a placeholder. */
function isConfigured(value: string | undefined): value is string {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !trimmed.startsWith('your-');
}

const EXPECTED_URL_EXAMPLE = 'https://abcdefgh.supabase.co';

/**
 * Returns the bare project origin.
 *
 * The dashboard shows several URLs and it is easy to copy the wrong one — a REST
 * endpoint (`.../rest/v1/`) looks plausible but breaks every request, because
 * supabase-js appends `/rest/v1` itself and PostgREST answers the doubled path
 * with `PGRST125 Invalid path specified in request URL`. So a URL carrying any
 * path, query or fragment is rejected by name rather than quietly accepted.
 */
function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `${SUPABASE_ENV_KEYS.url} is not a valid URL: "${trimmed}". ` +
        `Expected the Project URL from Supabase dashboard → Project Settings → API, ` +
        `e.g. ${EXPECTED_URL_EXAMPLE}`,
    );
  }

  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    const extra = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/^\//, '');
    throw new Error(
      `${SUPABASE_ENV_KEYS.url} must be the project origin with no path: got "${trimmed}". ` +
        `Remove the trailing "${extra}" — supabase-js appends /rest/v1 itself, and the ` +
        `doubled path fails with PGRST125. Expected e.g. ${EXPECTED_URL_EXAMPLE}`,
    );
  }

  // http is allowed only for a local `supabase start` stack (Phase 1 onwards).
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !isLocal) {
    throw new Error(
      `${SUPABASE_ENV_KEYS.url} must use https: got "${trimmed}". ` +
        `Expected e.g. ${EXPECTED_URL_EXAMPLE}`,
    );
  }

  return parsed.origin;
}

/**
 * Trims the key and rejects one that contains inner whitespace — the signature
 * of a paste that wrapped across lines and lost characters.
 */
function normalizeAnonKey(raw: string): string {
  const trimmed = raw.trim();

  if (/\s/.test(trimmed)) {
    throw new Error(
      `${SUPABASE_ENV_KEYS.anonKey} contains whitespace, so it was probably pasted ` +
        `across multiple lines. Re-copy it as a single line from Supabase dashboard → ` +
        `Project Settings → API.`,
    );
  }

  return trimmed;
}
