/**
 * Deleting an in-process (open, shared) flight from its card on the Log tab.
 * Mirrors the server's delete_flight gate: the host while nobody else has
 * logged, an editor or admin always; never on the shared device.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: { getRecentFlights: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(), deleteFlight: vi.fn() },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LogTab from '../log/LogTab';
import { clearParkedDraft } from '../log/useFlightDraft';

const openFlight = (over = {}) => ({
  id: 7, name: 'Test cupping', title: 'Test cupping', cup_count: 1, prep: 'cupping', sheet: 'advanced',
  is_shared: true, is_open: true, is_host: true, host_name: 'Robin',
  logged_count: 0, you_logged: false, cups: [{ position: 1, label: 'Cup A' }],
  roster: [{ taster_key: 'user:u-1', name: 'Robin', is_host: true, status: 'tasting' }],
  ...over,
});

const renderTab = () => render(
  <MemoryRouter initialEntries={['/log']}>
    <Routes><Route path="/log" element={<LogTab />} /></Routes>
  </MemoryRouter>,
);
const card = () => screen.findByTestId('invite-7');
const DELETE = 'Delete flight Test cupping';

beforeEach(() => {
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  auth.role = 'member';
});

describe('LogTab — delete an open flight from its card', () => {
  it('the host deletes an open flight nobody else has logged, after a confirm, and the list refreshes', async () => {
    api.getRecentFlights
      .mockResolvedValueOnce({ flights: [openFlight()], me: { name: 'Robin' } })
      .mockResolvedValueOnce({ flights: [], me: { name: 'Robin' } });
    api.deleteFlight.mockResolvedValue({ deleted: 0, flight_deleted: true });
    renderTab();
    fireEvent.click(within(await card()).getByRole('button', { name: DELETE }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flight?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteFlight).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByTestId('invite-7')).toBeNull());
    expect(api.getRecentFlights).toHaveBeenCalledTimes(2);
  });

  it('cancelling the confirm deletes nothing', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight()], me: { name: 'Robin' } });
    renderTab();
    fireEvent.click(within(await card()).getByRole('button', { name: DELETE }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flight?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(api.deleteFlight).not.toHaveBeenCalled();
  });

  it('the host who only logged their own read may still delete it', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight({ logged_count: 1, you_logged: true })], me: { name: 'Robin' } });
    renderTab();
    expect(within(await card()).getByRole('button', { name: DELETE })).toBeInTheDocument();
  });

  it('a staff host gets no delete once someone else has logged', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight({ logged_count: 1, you_logged: false })], me: { name: 'Robin' } });
    renderTab();
    expect(within(await card()).queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('a staff member who is not the host gets no delete', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight({ is_host: false, host_name: 'Sam' })], me: { name: 'Robin' } });
    renderTab();
    expect(within(await card()).queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('an editor may delete any open flight, and the confirm says everyone\'s reads go', async () => {
    auth.role = 'editor';
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight({ is_host: false, host_name: 'Sam', logged_count: 3 })], me: { name: 'Robin' } });
    renderTab();
    fireEvent.click(within(await card()).getByRole('button', { name: DELETE }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flight?' });
    expect(within(confirm).getByText(/3 people's reads go with it/)).toBeInTheDocument();
  });

  it('a refused delete shows the server message above the cards and refreshes the list', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight()], me: { name: 'Robin' } });
    api.deleteFlight.mockRejectedValue({ response: { status: 403, data: { error: 'Only the host can delete this flight, and only before anyone else logs' } } });
    renderTab();
    fireEvent.click(within(await card()).getByRole('button', { name: DELETE }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this flight?' })).getByRole('button', { name: 'Delete' }));
    const alert = await screen.findByText('Only the host can delete this flight, and only before anyone else logs');
    // Shown before the first card, not down in the recent-flights list.
    expect(alert.compareDocumentPosition(screen.getByTestId('invite-7')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('invite-7')).toBeInTheDocument();
    await waitFor(() => expect(api.getRecentFlights).toHaveBeenCalledTimes(2));
  });

  it('the shared device never gets the delete', async () => {
    auth.role = 'device';
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight()], me: { name: 'Robin' } });
    api.getFlight.mockResolvedValue(openFlight());
    render(
      <MemoryRouter initialEntries={['/f/7']}>
        <Routes><Route path="/f/:flightId" element={<LogTab />} /></Routes>
      </MemoryRouter>,
    );
    expect(within(await card()).queryByRole('button', { name: DELETE })).toBeNull();
  });

  it('a host who logged plus one other person gets no delete', async () => {
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight({ logged_count: 2, you_logged: true })], me: { name: 'Robin' } });
    renderTab();
    expect(within(await card()).queryByRole('button', { name: DELETE })).toBeNull();
  });

  it.each([
    [{ logged_count: 0 }, 'Nobody has logged yet.'],
    [{ logged_count: 1, you_logged: true }, 'Your read goes with it.'],
    [{ logged_count: 1, you_logged: false }, "1 person's read goes with it."],
  ])('the confirm says whose reads go (%o)', async (over, text) => {
    auth.role = 'editor';
    api.getRecentFlights.mockResolvedValue({ flights: [openFlight(over)], me: { name: 'Robin' } });
    renderTab();
    fireEvent.click(within(await card()).getByRole('button', { name: DELETE }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flight?' });
    expect(within(confirm).getByText(new RegExp(text.replace(/[.']/g, '.')))).toBeInTheDocument();
  });
});
