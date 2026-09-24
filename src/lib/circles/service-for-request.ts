import { CircleService } from '@/lib/circles/circles';
import { SupabaseCirclePort } from '@/lib/circles/supabase-port';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * A CircleService bound to the caller's session.
 *
 * Built per request, never cached: the client carries this user's JWT, and a
 * shared instance on a warm serverless instance would hand one person's
 * identity to the next request. The actor is then derived inside the SQL from
 * auth.uid(), so a route has no way to act as anyone else.
 *
 * A signed-out caller is not rejected here. current_actor() raises
 * insufficient_privilege, which the route layer maps to 403 — one check, in
 * the place that is authoritative, instead of a second one here that could
 * drift out of step with it.
 */
export async function circleServiceForRequest(): Promise<CircleService> {
  const client = await createSupabaseServerClient();
  return new CircleService(new SupabaseCirclePort(client));
}
