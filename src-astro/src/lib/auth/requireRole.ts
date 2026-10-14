import { AuthError, requireSession } from './session';
import type { SessionUser } from './session';

/**
 * Session check plus role check. Throws AuthError(403) when the signed-in user's role
 * is not in `allowedRoles`. Used on writes that only the owner may perform (settings,
 * menu prices, categories). Staff keep orders, tables and daily stock counts.
 */
export function requireRole(
  locals: Record<string, unknown> | App.Locals | undefined,
  allowedRoles: string[],
): SessionUser {
  const user = requireSession(locals);
  if (!allowedRoles.includes(user.role)) {
    throw new AuthError(`Role ${user.role} is not permitted for this action`, 403);
  }
  return user;
}
