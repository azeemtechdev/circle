import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseAcceptInvite } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/** invited -> joined. Only the invited person may accept. */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseAcceptInvite,
    run: (input) => service.acceptInvite(input),
  });
}
