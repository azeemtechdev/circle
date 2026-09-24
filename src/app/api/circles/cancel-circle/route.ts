import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseCancelCircle } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * -> cancelled. Owner only, and only while no contribution has been claimed or
 * confirmed. Once money is in play a circle has to be settled, not deleted.
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseCancelCircle,
    run: (input) => service.cancelCircle(input),
  });
}
