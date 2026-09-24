import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { readSupabaseEnv } from '@/lib/env';

/**
 * Session refresh, and nothing more.
 *
 * This file is `proxy.ts`, not `middleware.ts`: Next.js 16 deprecated the
 * `middleware` convention and renamed it to `proxy` (same behaviour, different
 * file and export name). Every Supabase SSR guide still says `middleware.ts`,
 * which in this version does nothing at all — silently.
 *
 * What it does: Supabase access tokens are short-lived, and a Server Component
 * cannot set cookies. Calling getUser() here refreshes an expired token and
 * writes the new cookie onto a response that is actually sent, so pages can
 * read the session without every one of them needing to refresh it.
 *
 * What it deliberately does NOT do: authorize anything. Next's own guidance is
 * that proxy is for optimistic checks, not authorization, and that matches this
 * system — the real boundary is in Postgres, where every write goes through a
 * SECURITY DEFINER function that derives the actor from auth.uid() and every
 * read is scoped by RLS (ARCHITECTURE.md §1, migration 0004). The redirect
 * below is a courtesy so a signed-out visitor sees the login page instead of an
 * empty dashboard. Removing it would leak no data.
 */

/** Paths a signed-out visitor may see. Everything else redirects to /login. */
const PUBLIC_PREFIXES = ['/login', '/signup', '/auth'];

function isPublic(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * The API is never redirected, signed in or not.
 *
 * A redirect to /login answers a JSON request with 307 and an HTML page, which
 * a fetch() caller cannot act on — and worse, a client following redirects
 * would see a 200 and read a login page as if it were a result. The routes
 * return a JSON error with the right status instead: the SQL raises
 * insufficient_privilege for a caller with no session, which becomes 403.
 */
function isApi(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // A clone that carries the request through; cookies set below land on it.
  let response = NextResponse.next({ request });

  const env = readSupabaseEnv();
  // A fresh clone with no Supabase project configured should still serve pages
  // rather than crashing on every request.
  if (!env) return response;

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not remove: this call is what refreshes the token. getUser() rather than
  // getSession() because getSession() trusts the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isApi(request.nextUrl.pathname) && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // So login can send them back where they were heading.
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image files. Matching those would
    // refresh the session dozens of times per page load for no benefit.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
