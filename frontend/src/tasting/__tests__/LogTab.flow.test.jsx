/**
 * The solo flight end to end: landing → pick 2 → enter both → review → ONE
 * POST → reveal → Done → recent flights refetched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getRecentFlights: vi.fn(), getCoffees: vi.fn(), createFlight: vi.fn(), getFlight: vi.fn(),
    getReveal: vi.fn(), logTastings: vi.fn(), closeFlight: vi.fn(), matchCoffee: vi.fn(),
    createCoffee: vi.fn(), getMembers: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LogTab from '../log/LogTab';
import { clearParkedDraft } from '../log/useFlightDraft';
import { guji, winter, lot } from './helpers';

const renderTab = (path = '/log') => render(
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
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin Host', created_via: 'account' } });
  api.getCoffees.mockResolvedValue({ coffees: [guji, winter, lot], roasters: ['Maple Roasters', 'Harbor Roasters'] });
});

describe('LogTab solo flight', () => {
  it('picks two coffees, enters both, reviews, logs once and reveals', async () => {
    api.createFlight.mockResolvedValue({
      id: 42, is_open: false, is_shared: false, cups: [], roster: [], logged_count: 1, you_logged: true, is_host: true,
      reveal: {
        flight: { id: 42, is_open: false, roster: [] },
        cups: [
          { coffee_id: 2, position: 1, name: 'Winter Blend', roaster: 'Maple Roasters', n: 1, consensus: null, yours: { overall: 3, sentence: '', defects: [] }, descriptors: [], verdict: null },
          { coffee_id: 1, position: 2, name: 'Guji Shakiso', roaster: 'Maple Roasters', n: 12, consensus: { n: 12, avg_overall: 3.9, spread: 0.6, histogram: [0, 1, 3, 5, 3] },
            yours: { overall: 4, acidity: 5, sweetness: null, body: 3, balance: null, sentence: 'Mostly blueberry.', defects: [], note: '' },
            descriptors: [{ term: 'Fruit>Berry>blueberry', label: 'blueberry', family: 'fruit', kind: 'shared', pct: 64 }], verdict: 'You landed with the room.' },
        ],
      },
    });
    renderTab();
    await screen.findByText(/Logged in as Robin Host/);
    expect(screen.getByText('Nothing logged yet — your flights will show up here.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    await within(dialog).findByText('Guji Shakiso');
    expect(within(dialog).getByText('On bar')).toBeInTheDocument();
    expect(within(dialog).getByText('Recent cupping lots')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Pick at least one coffee' })).toBeDisabled();

    fireEvent.click(within(dialog).getByText('Winter Blend'));
    fireEvent.click(within(dialog).getByText('Guji Shakiso'));
    expect(within(dialog).getByText('2 selected')).toBeInTheDocument();
    expect(within(dialog).getByTestId('pick-box-2')).toHaveTextContent('1');
    expect(within(dialog).getByTestId('pick-box-1')).toHaveTextContent('2');
    expect(within(dialog).getByText('Pour order — hold the handle and drag to reorder')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start flight · 2 coffees' }));

    // Entry: cup 1 of 2 is Winter (pour order), stars required, defects hidden (drip).
    await within(dialog).findByText('Maple Roasters · cup 1 of 2');
    expect(within(dialog).getByText('required')).toBeInTheDocument();
    expect(within(dialog).queryByText('Defects')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: /^3 stars/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guji Shakiso' }));
    await within(dialog).findByText('Maple Roasters · cup 2 of 2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Fruit' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Open Berry' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'blueberry' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'blueberry, picked' }));   // strong
    expect(within(dialog).getByTestId('auto-sentence')).toHaveTextContent('Mostly blueberry.');
    fireEvent.click(within(dialog).getByRole('radio', { name: /^4 stars/ }));
    // The note is local until it commits on blur — Review blurs first, so the
    // pending text still rides the ONE write.
    const note = within(dialog).getByLabelText('Note');
    note.focus();
    fireEvent.change(note, { target: { value: 'wow' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review' }));

    await within(dialog).findByText('Last look');
    expect(within(dialog).getByText('One write for the whole flight')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log flight' }));

    await waitFor(() => expect(api.createFlight).toHaveBeenCalledTimes(1));
    expect(api.createFlight.mock.calls[0][0]).toEqual({
      coffee_ids: [2, 1], prep: 'drip',
      entries: [
        { position: 1, coffee_id: 2, overall: 3, tags: {}, defects: [], note: '' },
        { position: 2, coffee_id: 1, overall: 4, tags: { 'Fruit>Berry>blueberry': 3 }, defects: [], note: 'wow' },
      ],
    });
    await within(dialog).findByText("You're one of the first.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guji Shakiso' }));
    await within(dialog).findByText('You landed with the room.');
    expect(within(dialog).getByText('3.9')).toBeInTheDocument();
    expect(within(dialog).getByText('Mostly blueberry.')).toBeInTheDocument();
    const mine = within(dialog).getByTestId('your-read');
    expect(within(mine).getByRole('img', { name: '4 of 5 stars' })).toBeInTheDocument();
    expect(within(mine).getByText('searing')).toBeInTheDocument();      // acidity 5
    expect(within(mine).getByText('medium')).toBeInTheDocument();       // body 3

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.getRecentFlights).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).not.toBeInTheDocument());
  });

  it('a flight of one logs straight from the entry screen and shows the failure inline', async () => {
    api.createFlight.mockRejectedValue({ response: { status: 500, data: { error: 'Failed to log flight' } } });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    expect(within(dialog).getByText('A flight of one — no review step')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cupping' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start tasting' }));
    await within(dialog).findByText('Harbor Roasters');
    expect(within(dialog).getByRole('button', { name: 'Log it' })).toBeDisabled();
    expect(within(dialog).getByText('Defects')).toBeInTheDocument();          // cupping unlocks defects
    fireEvent.click(within(dialog).getByRole('radio', { name: /^5 stars/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await within(dialog).findByText('Failed to log flight');
    expect(within(dialog).getByText('Harbor Roasters')).toBeInTheDocument();      // draft kept
  });

  it('the store shared device names a taster first and sends member_id', async () => {
    auth.role = 'device';
    api.getMembers.mockResolvedValue([{ id: 9, name: 'Maya Lin', first_name: 'Maya' }]);
    api.createFlight.mockResolvedValue({ id: 5, is_open: false, cups: [], roster: [], reveal: { flight: {}, cups: [{ coffee_id: 1, position: 1, name: 'Guji Shakiso', n: 1, consensus: null, yours: { overall: 4 }, descriptors: [] }] } });
    renderTab();
    await screen.findByText(/Shared device · pick your name to taste/);
    fireEvent.click(screen.getByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Maya'));
    fireEvent.click(await within(dialog).findByText('Guji Shakiso'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start tasting' }));
    fireEvent.click(await within(dialog).findByRole('radio', { name: /^4 stars/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(api.createFlight).toHaveBeenCalled());
    expect(api.createFlight.mock.calls[0][0].member_id).toBe(9);
    auth.role = 'member';
  });

  it('the picker always offers the score sheet; Advanced switches prep to Cupping and explains itself', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Drip' }));
    expect(within(dialog).getByRole('group', { name: 'Score sheet' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Advanced is a cupping sheet/)).toBeNull();
    // The sheet is chosen first: Advanced decides the prep, so it sits above it.
    const sheetGroup = within(dialog).getByRole('group', { name: 'Score sheet' });
    const prepGroup = within(dialog).getByRole('group', { name: 'Prep' });
    expect(sheetGroup.compareDocumentPosition(prepGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Advanced' }));
    expect(within(dialog).getByRole('button', { name: 'Cupping' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText(/Advanced is a cupping sheet\./)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Share this flight' })).toBeNull();
  });

  it('Advanced: Set up cupping goes to Share; the create POST carries sheet advanced + shared; the sheet reads as a label', async () => {
    api.createFlight.mockResolvedValue({
      id: 77, is_open: true, is_shared: true, is_host: true, sheet: 'advanced', adv_step: 0.5, cups: [], roster: [], logged_count: 0,
    });
    api.getFlight.mockResolvedValue({ id: 77, logged_count: 0, roster: [] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    fireEvent.click(within(dialog).getByText('Guji Shakiso'));
    fireEvent.click(within(dialog).getByText('Winter Blend'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Advanced' }));
    expect(within(dialog).queryByRole('button', { name: /Start flight/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set up cupping · 3 coffees' }));
    expect(await within(dialog).findByText('Share this flight')).toBeInTheDocument();
    // No toggle on Share: a read-only label plus the Steps control.
    expect(within(dialog).queryByRole('group', { name: 'Score sheet' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Basic read' })).toBeNull();
    expect(within(dialog).getByText('Advanced')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '0.1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Open the flight/ }));
    await waitFor(() => expect(api.createFlight).toHaveBeenCalledTimes(1));
    expect(api.createFlight.mock.calls[0][0]).toMatchObject({ prep: 'cupping', shared: true, sheet: 'advanced', adv_step: 0.1 });
    await within(dialog).findByTestId('flight-link');
    expect(within(dialog).getByRole('button', { name: '0.1' })).toBeDisabled();
  });

  it('a basic flight shows nothing about the sheet on the Share screen', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share this flight' }));
    await within(dialog).findByText('Flight name');
    expect(within(dialog).queryByText('Score sheet')).toBeNull();
    expect(within(dialog).queryByText('Steps')).toBeNull();
  });

  it('the host of a blind shared flight sees Cup A on the entry screen, not the coffee name', async () => {
    api.createFlight.mockResolvedValue({
      id: 78, is_open: true, is_shared: true, is_blind: true, is_host: true, cups: [
        { position: 1, label: 'Cup A', blind: true, coffee_id: null, name: null },
      ], roster: [], logged_count: 0,
    });
    api.getFlight.mockResolvedValue({ id: 78, logged_count: 0, roster: [] });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share this flight' }));
    fireEvent.click(await within(dialog).findByRole('switch'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Open the flight/ }));
    await within(dialog).findByTestId('flight-link');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to tasting' }));
    expect(await within(dialog).findByRole('heading', { name: 'Cup A' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/Huila/)).toBeNull();
  });

  it('Set up cupping -> Back keeps Advanced; a non-cupping prep then resets to the basic sheet and Start flight', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tasting flight' });
    fireEvent.click(await within(dialog).findByText('Huila Sample 3'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Advanced' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Set up cupping/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Back to the flight/ }));
    // Back keeps the choice in the picker.
    expect(within(dialog).getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: /Set up cupping/ })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Drip' }));
    expect(within(dialog).getByRole('button', { name: 'Basic read' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByTestId('pick-box-1'));
    expect(within(dialog).getByRole('button', { name: 'Start flight · 2 coffees' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId('pick-box-1'));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Start tasting/ }));
    expect(await within(dialog).findByText(/Overall/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('advanced-slider-aroma')).toBeNull();
  });
});

describe('LogTab open-flight card closing time', () => {
  const open = (id, closes_at) => ({
    id, name: `F${id}`, title: `F${id}`, cup_count: 1, prep: 'cupping', sheet: 'advanced', is_shared: true, is_open: true,
    is_host: true, host_name: 'Robin', logged_count: 0, you_logged: false,
    cups: [{ position: 1, label: 'Cup A' }], roster: [], opened_at: '2030-01-08T20:00:00', closes_at,
  });

  it('reads the real closes_at, so a 24h and a 48h flight each say their own time', async () => {
    api.getRecentFlights.mockResolvedValue({
      flights: [open(1, '2030-01-09T20:00:00'), open(2, '2030-01-10T20:00:00')], me: { name: 'Robin Host', created_via: 'account' },
    });
    renderTab();
    expect(await screen.findByTestId('invite-1')).toHaveTextContent('Wed, Jan 9 at 3:00pm');
    expect(screen.getByTestId('invite-2')).toHaveTextContent('Thu, Jan 10 at 3:00pm');
    expect(document.body.textContent).not.toMatch(/in 24h/);
  });
});
