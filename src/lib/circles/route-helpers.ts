import { NextResponse } from 'next/server';

import { CircleError } from '@/lib/circles/circles';
import { createServerSupabaseClient, type SupabaseCookieAdapter } from '@/lib/supabase/client';

export function getSupabaseCookieState(request?: Pick<Request, 'headers'> | Headers): SupabaseCookieAdapter {
  const headers = request instanceof Headers ? request : request?.headers ?? new Headers();
  const rawCookieHeader = headers.get('cookie') ?? '';

  return {
    getAll: () => rawCookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const equalsIndex = cookie.indexOf('=');
        const name = equalsIndex >= 0 ? cookie.slice(0, equalsIndex) : cookie;
        const value = equalsIndex >= 0 ? cookie.slice(equalsIndex + 1) : '';
        return { name, value };
      }),
    setAll: async () => undefined,
  };
}

export function getCircleRouteClient(request?: Pick<Request, 'headers'> | Headers) {
  const env = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }
    : undefined;

  return env ? createServerSupabaseClient({ ...env, cookies: getSupabaseCookieState(request) }) : null;
}

export function getIdempotencyKey(request: Request): string | null {
  return request.headers.get('Idempotency-Key');
}

export function circleErrorResponse(error: unknown): NextResponse {
  if (error instanceof CircleError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  const code = (error as { code?: string } | null)?.code;
  const status = {
    insufficient_privilege: 403,
    check_violation: 409,
    foreign_key_violation: 404,
    lock_not_available: 409,
  }[code ?? ''] ?? 500;

  return NextResponse.json({ error: message }, { status });
}
