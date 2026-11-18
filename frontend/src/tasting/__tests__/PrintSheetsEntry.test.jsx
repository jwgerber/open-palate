/** The two ways into the print sheets: host setup (a flight) and the Log tab (blank). Links to a new tab, except on the shared device. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: { getRecentFlights: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(), getMembers: vi.fn() },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import HostSetupScreen from '../advanced/host/HostSetupScreen';
import LogTab from '../log/LogTab';

const CUPS = Array.from({ length: 3 }, (_, i) => ({ position: i + 1, label: `Cup ${String.fromCharCode(65 + i)}`, blind: true, coffee_id: null }));
const hostFlight = (over = {}) => ({
  id: 9, name: 'Fall importer samples', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: true, is_host: true,
  is_open: true, created_via: 'account', opened_at: '2026-10-21T15:00:00', roster: [], logged_count: 0, cups: CUPS, ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin', created_via: 'account' } });
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
  auth.role = 'member';
});

describe('HostSetupScreen print entry', () => {
  const setup = (f) => render(<HostSetupScreen flight={f} onBack={() => {}} onOpenTimer={() => {}} />);

  it('links Print sheets to the flight print route in a new tab', () => {
    setup(hostFlight());
    const link = screen.getByRole('link', { name: 'Print sheets' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/print\/sheets\/9$/));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the in-app dialog on a shared device', async () => {
    auth.role = 'device';
    setup(hostFlight());
    expect(screen.queryByRole('link', { name: 'Print sheets' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Print sheets' }));
    expect(await screen.findByRole('dialog', { name: 'Print sheets' })).toBeInTheDocument();
    expect(document.querySelectorAll('.advanced-print-page').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cup A').length).toBeGreaterThan(0);
  });

  it('hides Print sheets once the cupping is closed', () => {
    setup(hostFlight({ is_open: false }));
    expect(screen.queryByRole('link', { name: 'Print sheets' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print sheets' })).toBeNull();
  });
});

describe('LogTab blank sheet', () => {
  const renderLog = () => render(
    <MemoryRouter initialEntries={['/log']}>
      <Routes><Route path="/log" element={<LogTab />} /></Routes>
    </MemoryRouter>,
  );

  it('links the blank sheet to the print route in a new tab', async () => {
    renderLog();
    const link = await screen.findByRole('link', { name: 'Print a blank cupping sheet' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/print\/sheets\/blank$/));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('opens the blank sheet in-app on a shared device, with Cup ___ columns and no QR', async () => {
    auth.role = 'device';
    renderLog();
    expect(screen.queryByRole('link', { name: 'Print a blank cupping sheet' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Print a blank cupping sheet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Print a blank sheet' });
    expect(within(dialog).getAllByText('Cup ___')).toHaveLength(6);
    expect(screen.queryByText(/^flight \d+/)).toBeNull();
  });
});
