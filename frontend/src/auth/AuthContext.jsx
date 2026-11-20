/**
 * Who is signed in, from GET /api/auth/me. `kind` is 'user' (a person), 'device'
 * (a shared tablet), or null (signed out). This also plants the CSRF cookie, so
 * it runs before any page that POSTs.
 *
 * Only a 401 means signed out. Any other failure (network down, 5xx) sets
 * `error: true` and keeps what was known: a shared tablet must never be bounced
 * to a sign-in page it cannot use, because its device code is single-use.
 * `setup` is the setup status (`{needed: true, open, password, email}`, `{needed: false, email}`, or
 * `{failed: true}`); it is only asked of a signed-out visitor, and a signed-in user is
 * known to be past setup. Null until known.
 * `refresh()` never rejects; it reports through the state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setLastKind } from '../api';
import { setGroupTimezone } from '../time';

const AuthContext = createContext(null);

const SIGNED_OUT = { kind: null, user: null, group: null, role: null, error: false, setup: null };

/**
 * First-run setup status: the server's `{needed, email, open?, password?}`, or `{ failed: true }`
 * when the call fails. A failure must not lock the app out, so it never counts as needed.
 */
async function loadSetupStatus() {
  try {
    const res = await api.get('/auth/setup-status');
    return res.data ?? { failed: true };
  } catch (err) {
    console.warn('Could not check setup status', err);
    return { failed: true };
  }
}

function fromMe(body) {
  const group = body.groups?.[0] ?? null;
  setGroupTimezone(group?.timezone);
  setLastKind(body.kind);
  return { kind: body.kind, user: body.user, group, role: group?.role ?? null, setup: { needed: false } };
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...SIGNED_OUT, loading: true });

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setState({ ...fromMe(res.data), error: false, loading: false });
    } catch (err) {
      if (err.response?.status === 401) {
        // Only a signed-out visitor can be mid-setup, so ask then, before `loading` ends.
        const setup = await loadSetupStatus();
        setState({ ...SIGNED_OUT, setup, loading: false });
        return;
      }
      console.error('Could not load the session', err);
      setState((prev) => ({ ...prev, error: true, loading: false }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
