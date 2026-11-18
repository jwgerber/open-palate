/**
 * The shared device names whose sheet is on screen, and the next person can
 * take over with "Not you?" without inheriting the last taster's scores.
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

beforeEach(() => {
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  auth.role = 'device';
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin' } });
  api.getCoffees.mockResolvedValue({ coffees: [guji], roasters: [] });
  api.getFlight.mockResolvedValue(flight);
  api.getMembers.mockResolvedValue([
    { id: 9, name: 'Maya Lin', first_name: 'Maya' },
    { id: 12, name: 'Alex Ruiz', first_name: 'Alex' },
  ]);
  api.logTastings.mockResolvedValue({ ...flight, logged_count: 1, you_logged: true });
});

const openFromLink = async () => {
  render(
    <MemoryRouter initialEntries={['/f/9']}>
      <Routes>
        <Route path="/log" element={<LogTab />} />
        <Route path="/f/:flightId" element={<LogTab />} />
      </Routes>
    </MemoryRouter>,
  );
  const card = await screen.findByTestId('invite-9');
  fireEvent.click(within(card).getByRole('button', { name: 'Taste this flight' }));
  return screen.findByRole('dialog', { name: 'Tasting flight' });
};

const pick = async (dialog, first) => fireEvent.click(await within(dialog).findByText(first));
const fourStars = (dialog) => within(dialog).findByRole('radio', { name: /^4 stars/ });

describe('the shared device names its taster', () => {
  it('shows whose sheet it is, and "Not you?" with nothing scored goes straight to the picker', async () => {
    const dialog = await openFromLink();
    await pick(dialog, 'Maya');
    expect(await within(dialog).findByText('Tasting as Maya Lin')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not you?' }));
    expect(await within(dialog).findByText("Who's tasting?")).toBeInTheDocument();
    await pick(dialog, 'Alex');
    expect(await within(dialog).findByText('Tasting as Alex Ruiz')).toBeInTheDocument();
  });

  it('asks before clearing the last taster\'s scores, then logs a clean sheet as the new taster', async () => {
    const dialog = await openFromLink();
    await pick(dialog, 'Maya');
    fireEvent.click(await fourStars(dialog));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not you?' }));
    const confirm = await screen.findByRole('dialog', { name: 'Switch taster?' });
    expect(within(confirm).getByText(/Maya Lin's scores on this flight are cleared/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Switch' }));
    await pick(dialog, 'Alex');
    const stars = await fourStars(dialog);
    expect(stars).not.toBeChecked();
    fireEvent.click(stars);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(api.logTastings).toHaveBeenCalledTimes(1));
    expect(api.logTastings.mock.calls[0][2]).toEqual({ memberId: 12 });
  });

  it('keeps the scores when the switch is cancelled', async () => {
    const dialog = await openFromLink();
    await pick(dialog, 'Maya');
    fireEvent.click(await fourStars(dialog));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not you?' }));
    const confirm = await screen.findByRole('dialog', { name: 'Switch taster?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch taster?' })).toBeNull());
    expect(within(dialog).getByText('Tasting as Maya Lin')).toBeInTheDocument();
    expect(await fourStars(dialog)).toBeChecked();
  });

  it('an account session shows no taster line', async () => {
    auth.role = 'member';
    const dialog = await openFromLink();
    await fourStars(dialog);
    expect(within(dialog).queryByText(/Tasting as/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Not you?' })).toBeNull();
  });
});
