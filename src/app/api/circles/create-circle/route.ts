import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseCreateCircle } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/** [*] -> draft. The caller becomes the owner. */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseCreateCircle,
    run: (input) => service.createCircle(input),
  });
}
