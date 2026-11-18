/**
 * Shared test scaffolding for the Tasting suites.
 *
 * `authValue(auth)` builds the `useAuth()` shape the module reads. `auth.role`
 * is one of 'member' | 'editor' | 'admin' (a signed-in person) or 'device' (a
 * shared device, which has no group role). `vi.mock(...)` lines must stay in
 * each test file (hoisting is per-file); import this from inside the factory:
 * `vi.mock(path, async () => { const { authValue } = await import('./helpers'); ... })`.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Routes } from 'react-router-dom';

export const authValue = (auth) => {
  const device = auth.role === 'device';
  return {
    kind: device ? 'device' : 'user',
    role: device ? null : auth.role,
    user: device ? null : (auth.user ?? { id: 'u-1', email: 'robin@example.test', display_name: 'Robin' }),
    group: { id: 1, name: 'Test Group', role: device ? null : auth.role, timezone: 'America/New_York' },
    loading: false,
    refresh: async () => {},
  };
};

export const renderAt = (path, routes) => render(
  <MemoryRouter initialEntries={[path]}><Routes>{routes}</Routes></MemoryRouter>,
);

// Coffee fixtures in the list shape GET /coffees returns.
export const guji = { id: 1, name: 'Guji Shakiso', roaster: 'Maple Roasters', kind: 'house', n: 11, basic_n: 11, cupping: null, avg_overall: 3.9, spread: 0.6, top_terms: [{ term: 'Fruity>Berry>blueberry', label: 'blueberry', pct: 64 }], tasted_by_me: true, archived_at: null };
export const winter = { id: 2, name: 'Winter Blend', roaster: 'Maple Roasters', kind: 'house', n: 2, basic_n: 2, cupping: null, avg_overall: null, top_terms: [], tasted_by_me: false, archived_at: null };
export const lot = { id: 3, name: 'Huila Sample 3', roaster: 'Harbor Roasters', kind: 'cupping_lot', n: 0, basic_n: 0, cupping: null, avg_overall: null, top_terms: [], tasted_by_me: false, archived_at: null };
