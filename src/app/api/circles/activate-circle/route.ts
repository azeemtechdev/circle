import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseActivateCircle } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * inviting -> active. Owner only.
 *
 * Locks the rotation order, creates the virtual accounts and opens round 1 in
 * one transaction, so a circle can never be active without its accounts.
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseActivateCircle,
    run: (input) => service.activateCircle(input),
  });
}
