import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseClaimContribution } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * "I've paid" — pending -> claimed, and the round open -> collecting.
 *
 * No money moves here. The transfer happened in a bank app, outside Circle;
 * this records the payer's claim so the recipient can confirm it
 * (ARCHITECTURE.md §3).
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseClaimContribution,
    run: (input) => service.claimContribution(input),
  });
}
