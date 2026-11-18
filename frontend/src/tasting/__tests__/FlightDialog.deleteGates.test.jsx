/**
 * Which delete a CLOSED flight offers in its dialog. "Delete this tasting"
 * removes only the caller's own read, so it shows only when the server says
 * they logged one (`you_logged`) — a host who typed paper sheets in has no
 * read of their own. "Delete this flight" on a closed flight is an editor or admin
 * (editor or admin), mirroring the server's delete_flight gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useReducer } from 'react';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getCoffees: vi.fn(), getFlight: vi.fn(), getFlightResult: vi.fn(), getMembers: vi.fn(),
    deleteTastings: vi.fn(), deleteFlight: vi.fn(), logTastings: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import FlightDialog from '../log/FlightDialog';
import { reducer, initialDraft } from '../log/flightDraft';

const closedFlight = (over = {}) => ({
  id: 9, name: 'Thursday cupping', title: 'Thursday cupping', is_open: false, is_shared: true, is_host: true,
  // One read in it, so "revealed to the room" (logged_count > 1) never hides "Delete this tasting".
  host_name: 'Robin', logged_count: 1, you_logged: false, roster: [],
  ...over,
});
const advancedFlight = (over = {}) => closedFlight({ sheet: 'advanced', prep: 'cupping', cups: [{ position: 1, label: 'Cup A', blind: false }], ...over });
const basicFlight = (over = {}) => closedFlight({ sheet: 'basic', prep: 'pourover', cups: [{ position: 1, label: 'Guji', coffee_id: 1 }], ...over });

const advancedResult = (f) => ({ flight: f, named: true, coffees: [] });
const basicResult = (f) => ({
  flight: f,
  cups: [{ position: 1, coffee_id: 1, name: 'Guji', roaster: 'Maple Roasters', n: 1, consensus: null, yours: null }],
});

function renderOpened(f, result, onDone = () => {}) {
  function Harness() {
    const [draft, dispatch] = useReducer(reducer, null, () => [
      { type: 'seedFromFlight', flight: f },
      { type: 'logged', flight: f },
      { type: 'revealed', result },
    ].reduce(reducer, initialDraft()));
    return <FlightDialog draft={draft} dispatch={dispatch} onDone={onDone} />;
  }
  return render(<Harness />);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  auth.role = 'member';
});

describe('FlightDialog — deleting from a closed flight', () => {
  it('hides "Delete this tasting" when the caller logged no read of their own', async () => {
    const f = advancedFlight({ you_logged: false });
    renderOpened(f, advancedResult(f));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Delete this tasting' })).toBeNull();
  });

  it('offers "Delete this tasting" when the caller did log a read', async () => {
    const f = advancedFlight({ you_logged: true });
    renderOpened(f, advancedResult(f));
    expect(await screen.findByRole('button', { name: 'Delete this tasting' })).toBeInTheDocument();
  });

  it('hides it on a closed basic reveal the caller never logged', async () => {
    const f = basicFlight({ you_logged: false });
    renderOpened(f, basicResult(f));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Delete this tasting' })).toBeNull();
  });

  it('gives a staff host no "Delete this flight" on a closed flight someone else logged', async () => {
    const f = advancedFlight({ you_logged: true, logged_count: 2 });
    renderOpened(f, advancedResult(f));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Delete this flight' })).toBeNull();
  });

  it('a staff host alone on a closed flight may still delete it, as the server allows', async () => {
    const f = advancedFlight({ you_logged: true, logged_count: 1 });
    renderOpened(f, advancedResult(f));
    expect(await screen.findByRole('button', { name: 'Delete this flight' })).toBeInTheDocument();
  });

  it('gives a staff non-host no "Delete this flight" on a closed flight', async () => {
    const f = advancedFlight({ is_host: false, you_logged: true });
    renderOpened(f, advancedResult(f));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Delete this flight' })).toBeNull();
  });

  it('lets an editor delete a closed cupping behind a confirm, then leaves the dialog', async () => {
    auth.role = 'editor';
    api.deleteFlight.mockResolvedValue({ deleted: 2, flight_deleted: true });
    const onDone = vi.fn();
    const f = advancedFlight({ is_host: false, you_logged: false });
    renderOpened(f, advancedResult(f), onDone);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this flight' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this flight?' });
    expect(within(confirm).getByText(/The flight and every read in it go/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteFlight).toHaveBeenCalledWith(9));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.deleteTastings).not.toHaveBeenCalled();
  });

  it('a closed solo flight offers one delete, not two, even to an editor', async () => {
    auth.role = 'editor';
    const f = basicFlight({ is_shared: false, you_logged: true });
    renderOpened(f, basicResult(f));
    expect(await screen.findByRole('button', { name: 'Delete this tasting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this flight' })).toBeNull();
  });

  it('lets an editor delete a closed basic flight from its reveal', async () => {
    auth.role = 'editor';
    const f = basicFlight({ is_host: false });
    renderOpened(f, basicResult(f));
    expect(await screen.findByRole('button', { name: 'Delete this flight' })).toBeInTheDocument();
  });
});

describe('FlightDialog — a double-tapped Log on a shared flight', () => {
  it('a 409 already_logged still offers "Delete this tasting", though the flight we held said not logged', async () => {
    const open = basicFlight({ is_open: true, is_host: false, logged_count: 1, you_logged: false });
    api.logTastings.mockRejectedValue({ response: { status: 409, data: { error: 'already_logged', message: 'You already logged this flight' } } });
    api.getFlight.mockResolvedValue(open);
    function Harness() {
      const [draft, dispatch] = useReducer(reducer, null, () => [
        { type: 'seedFromFlight', flight: open },
        { type: 'val', coffeeId: 1, attr: 'overall', value: 4 },
        { type: 'screen', screen: 'review' },
      ].reduce(reducer, initialDraft()));
      return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
    }
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log flight' }));
    expect(await screen.findByRole('button', { name: 'Delete this tasting' })).toBeInTheDocument();
  });
});
