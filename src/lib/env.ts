/**
 * Environment configuration.
 *
 * Rules (see CLAUDE.md):
 * - Secrets live in `.env.local` (gitignored) or the host's env panel. Never here.
 * - Reads are explicit and validated, so a missing key fails loudly at the edge
 *   instead of producing a mysterious 500 deep inside a request.
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
 * Reads Supabase config without throwing.
 * Returns `null` when either value is missing or still a placeholder, so smoke
 * tests can skip themselves cleanly on a fresh clone.
 */
export function readSupabaseEnv(source: EnvSource = process.env): SupabaseEnv | null {
  const url = source[SUPABASE_ENV_KEYS.url];
  const anonKey = source[SUPABASE_ENV_KEYS.anonKey];

  if (!isConfigured(url) || !isConfigured(anonKey)) return null;

  return { url, anonKey };
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
