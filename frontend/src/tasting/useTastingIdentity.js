/**
 * Who is using Tasting, derived from the session (`/api/auth/me`):
 *
 *   isPerson       a signed-in account: logs as itself, owns a palate
 *   canManage      group role editor or admin: coffee details, archive, paper sheets
 *   canCloseAny    group admin: close a flight one did not host
 *   isSharedDevice a shared tablet: the taster picks a name; it never sees a palate
 *                  or a label key
 *
 * Gating here only hides controls; the server enforces every one of these.
 */
import { useAuth } from '../auth/AuthContext';

export function useTastingIdentity() {
  const { kind, role, user, group } = useAuth();
  const isDevice = kind === 'device';
  return {
    isPerson: kind === 'user',
    canManage: kind === 'user' && (role === 'editor' || role === 'admin'),
    canCloseAny: kind === 'user' && role === 'admin',
    isSharedDevice: isDevice,
    user,
    timezone: group?.timezone ?? 'UTC',
  };
}
