import { circleServiceForRequest } from '@/lib/circles/service-for-request';
import { parseInviteMember } from '@/lib/http/parsers';
import { handleTransition } from '@/lib/http/transition-route';

/**
 * Invites an existing account, and moves the circle draft -> inviting.
 *
 * Takes a userId, not a phone: resolving a phone to an account is a separate
 * read (find_profile_by_phone), so the invite screen looks the person up, shows
 * their name for confirmation, then invites a specific id. Inviting someone who
 * has no account yet is deferred (migration 0005).
 */
export async function POST(request: Request): Promise<Response> {
  const service = await circleServiceForRequest();
  return handleTransition(request, {
    parse: parseInviteMember,
    run: (input) => service.inviteMember(input),
  });
}
