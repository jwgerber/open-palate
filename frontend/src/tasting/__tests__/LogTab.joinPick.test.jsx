/**
 * A shared device joining a flight (link or invite card) must name its taster
 * before scoring; account sessions go straight to the entry screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: { getRecentFlights: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(), logTastings: vi.fn(), getMembers: vi.fn(), getReveal: vi.fn() },
  auth: { role: 'device' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LogTab from '../log/LogTab';
import { clearParkedDraft } from '../log/useFlightDraft';
import { guji } from './helpers';

const flight = {
  id: 9, name: 'Thursday cupping', is_open: true, is_shared: true, is_blind: false, is_host: false, you_logged: false,
  prep: 'drip', sheet: 'basic', host_name: 'Sam', roster: [], logged_count: 0, closes_at: null,
  cups: [{ position: 1, coffee_id: 1, name: 'Guji Shakiso', label: 'Guji Shakiso', roaster: 'Maple Roasters', kind: 'house' }],
};

const renderTab = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/log" element={<LogTab />} />
      <Route path="/f/:flightId" element={<LogTab />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin' } });
  api.getCoffees.mockResolvedValue({ coffees: [guji], roasters: [] });
  api.getFlight.mockResolvedValue(flight);
  api.getMembers.mockResolvedValue([{ id: 9, name: 'Maya Lin', first_name: 'Maya' }]);
  api.logTastings.mockResolvedValue({ ...flight, logged_count: 1, you_logged: true });
});

const tasteFromLink = async () => {
  renderTab('/f/9');
  const card = await screen.findByTestId('invite-9');
  fireEvent.click(within(card).getByRole('button', { name: 'Taste this flight' }));
  return screen.findByRole('dialog', { name: 'Tasting flight' });
};

describe('joining a shared flight', () => {
  it('a shared device is asked who is tasting, then lands on entry and logs with member_id', async () => {
    auth.role = 'device';
    const dialog = await tasteFromLink();
    expect(await within(dialog).findByText("Who's tasting?")).toBeInTheDocument();
    expect(within(dialog).queryByText('Guji Shakiso')).toBeNull();   // no coffee identity before the pick
    fireEvent.click(await within(dialog).findByText('Maya'));
    fireEvent.click(await within(dialog).findByRole('radio', { name: /^4 stars/ }));
    expect(within(dialog).queryByText("Who's tasting?")).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(api.logTastings).toHaveBeenCalledTimes(1));
    expect(api.logTastings.mock.calls[0][2]).toEqual({ memberId: 9 });
  });

  it('an account session goes straight to entry with no WhoScreen', async () => {
    auth.role = 'member';
    const dialog = await tasteFromLink();
    await within(dialog).findByRole('radio', { name: /^4 stars/ });
    expect(within(dialog).queryByText("Who's tasting?")).toBeNull();
    expect(api.getMembers).not.toHaveBeenCalled();
    auth.role = 'device';
  });
});
