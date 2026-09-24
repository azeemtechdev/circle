import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseConfirmContribution } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * "Received" — claimed -> confirmed. Only this round's recipient may call it.
 *
 * This is where value enters the ledger: the double-entry posting and the
 * status change commit in the same transaction, so the books can never
 * disagree with the state machine. A replay posts nothing a second time.
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseConfirmContribution,
    run: (input) => service.confirmContribution(input),
  });
}
