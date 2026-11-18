/**
 * Who is signed in, from GET /api/auth/me. `kind` is 'user' (a person), 'device'
 * (a shared tablet), or null (signed out). This also plants the CSRF cookie, so
 * it runs before any page that POSTs.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { setGroupTimezone } from '../time';

const AuthContext = createContext(null);

const SIGNED_OUT = { kind: null, user: null, group: null, role: null };

function fromMe(body) {
  const group = body.groups?.[0] ?? null;
  setGroupTimezone(group?.timezone);
  return { kind: body.kind, user: body.user, group, role: group?.role ?? null };
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({ ...SIGNED_OUT, loading: true });

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setState({ ...fromMe(res.data), loading: false });
    } catch (err) {
      if (err.response?.status !== 401) console.error('Could not load the session', err);
      setState({ ...SIGNED_OUT, loading: false });
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
