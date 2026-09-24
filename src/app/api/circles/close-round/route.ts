import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseCloseRound } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * settled -> closed. Pays the pot to the recipient, then opens the next round,
 * or completes the circle on the last one.
 *
 * Any member may close a settled round, so a silent recipient cannot stall the
 * rotation — the money still only ever goes to the recipient's account.
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseCloseRound,
    run: (input) => service.closeRound(input),
  });
}
