/**
 * A refresh mid-tasting: the page's memory is gone, so each test forgets the
 * parked draft and mounts the Log tab again from what the device saved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getRecentFlights: vi.fn(), getCoffees: vi.fn(), createFlight: vi.fn(), getFlight: vi.fn(),
    getReveal: vi.fn(), logTastings: vi.fn(), closeFlight: vi.fn(), getMembers: vi.fn(),
  },
  auth: { role: 'member', user: { id: 'u-1', email: 'robin@example.test' } },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LogTab from '../log/LogTab';
import { clearParkedDraft, forgetParkedDraft } from '../log/useFlightDraft';
import { loadDraft, saveDraft } from '../log/draftStorage';
import { initialDraft, reducer } from '../log/flightDraft';
import { guji, winter } from './helpers';

const renderTab = (path = '/log') => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/log" element={<LogTab />} />
      <Route path="/f/:flightId" element={<LogTab />} />
    </Routes>
  </MemoryRouter>,
);
const refresh = (path) => { cleanup(); forgetParkedDraft(); return renderTab(path); };
const flightDialog = () => screen.findByRole('dialog', { name: 'Tasting flight' });

const sharedFlight = (over = {}) => ({
  id: 9, name: 'Thursday cupping', is_open: true, is_shared: true, is_blind: false, is_host: false, you_logged: false,
  prep: 'drip', sheet: 'basic', host_name: 'Sam', roster: [], logged_count: 0, closes_at: null,
  cups: [{ position: 1, coffee_id: 1, name: 'Guji Shakiso', label: 'Guji Shakiso', roaster: 'Maple Roasters', kind: 'house' }],
  ...over,
});
const savedShared = (flight = sharedFlight(), owner = 'u-1') => {
  const draft = [
    { type: 'seedFromFlight', flight },
    { type: 'val', coffeeId: 1, attr: 'overall', value: 4 },
  ].reduce(reducer, initialDraft());
  saveDraft(owner, draft);
};

const soloLogged = {
  id: 1, is_open: false, is_shared: false, cups: [], roster: [], logged_count: 1, you_logged: true, is_host: true,
  reveal: {
    flight: { id: 1, is_open: false, roster: [] },
    cups: [{ coffee_id: 1, position: 1, name: 'Guji Shakiso', roaster: 'Maple Roasters', n: 1, consensus: null, yours: { overall: 4, sentence: '', defects: [] }, descriptors: [], verdict: null }],
  },
};

async function startSoloAndScore() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start a tasting' }));
  const dialog = await flightDialog();
  fireEvent.click(await within(dialog).findByText('Guji Shakiso'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Start tasting' }));
  fireEvent.click(await within(dialog).findByRole('radio', { name: /^4 stars/ }));
  return dialog;
}

beforeEach(() => {
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  auth.user = { id: 'u-1', email: 'robin@example.test' };
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin Host' } });
  api.getCoffees.mockResolvedValue({ coffees: [guji, winter], roasters: ['Maple Roasters'] });
});

describe('refreshing a solo flight', () => {
  it('reopens on the same cup, and the score still rides the one write', async () => {
    renderTab();
    await startSoloAndScore();
    refresh();

    const dialog = await flightDialog();
    expect(await within(dialog).findByRole('radio', { name: /^4 stars/ })).toBeChecked();

    api.createFlight.mockResolvedValue(soloLogged);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(api.createFlight).toHaveBeenCalledTimes(1));
    expect(api.createFlight.mock.calls[0][0].entries[0].overall).toBe(4);
  });

  it('keeps a note still being typed, before it has blurred', async () => {
    renderTab();
    const dialog = await startSoloAndScore();
    const note = within(dialog).getByLabelText('Note');
    note.focus();
    fireEvent.change(note, { target: { value: 'blueberry jam' } });
    await waitFor(() => expect(loadDraft('u-1').entries[1].note).toBe('blueberry jam'), { timeout: 2000 });
    refresh();
    expect(within(await flightDialog()).getByLabelText('Note')).toHaveValue('blueberry jam');
  });

  it('forgets the draft once it is logged', async () => {
    renderTab();
    const dialog = await startSoloAndScore();
    api.createFlight.mockResolvedValue(soloLogged);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(api.createFlight).toHaveBeenCalled());
    await waitFor(() => expect(loadDraft('u-1')).toBeNull());
    refresh();
    await screen.findByRole('button', { name: 'Start a tasting' });
    expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).toBeNull();
  });

  it('forgets the draft when the taster discards it', async () => {
    renderTab();
    const dialog = await startSoloAndScore();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(loadDraft('u-1')).toBeNull());
  });

  it('does not reopen for someone else signed in on the same device', async () => {
    renderTab();
    await startSoloAndScore();
    auth.user = { id: 'u-2', email: 'other@example.test' };
    refresh();
    await screen.findByRole('button', { name: 'Start a tasting' });
    expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).toBeNull();
  });
});

describe('refreshing a shared flight', () => {
  it('reopens with the scores and re-reads the flight once', async () => {
    savedShared();
    api.getFlight.mockResolvedValue(sharedFlight({ logged_count: 2 }));
    renderTab();
    const dialog = await flightDialog();
    expect(within(dialog).getByRole('radio', { name: /^4 stars/ })).toBeChecked();
    await waitFor(() => expect(api.getFlight).toHaveBeenCalledTimes(1));
    expect(api.getFlight.mock.calls[0][0]).toBe(9);
  });

  it('does not extend the time limit just by reloading or re-reading', async () => {
    savedShared();
    const key = localStorage.key(0);
    const before = localStorage.getItem(key);
    api.getFlight.mockResolvedValue(sharedFlight({ logged_count: 2 }));
    renderTab();
    await flightDialog();
    await waitFor(() => expect(api.getFlight).toHaveBeenCalled());
    await act(async () => {});
    expect(localStorage.getItem(key)).toBe(before);
  });

  it('commits a note still being typed when the host leaves for Share', async () => {
    savedShared(sharedFlight({ is_host: true }));
    api.getFlight.mockResolvedValue(sharedFlight({ is_host: true }));
    renderTab();
    const dialog = await flightDialog();
    const note = within(dialog).getByLabelText('Note');
    note.focus();
    fireEvent.change(note, { target: { value: 'basic thought' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share this flight' }));
    expect(loadDraft('u-1', { flightId: 9 }).entries[1].note).toBe('basic thought');
    expect(loadDraft('u-1', { flightId: 9 }).screen).toBe('share');
  });

  it('moves on to the wait when the read already went in before the refresh', async () => {
    savedShared();
    api.getFlight.mockResolvedValue(sharedFlight({ you_logged: true, logged_count: 1 }));
    renderTab();
    await waitFor(() => expect(loadDraft('u-1', { flightId: 9 })).toBeNull());
    expect(within(await flightDialog()).queryByRole('radio', { name: /^4 stars/ })).toBeNull();
  });

  it('says so when the flight was deleted meanwhile', async () => {
    savedShared();
    api.getFlight.mockRejectedValue({ response: { status: 404 } });
    renderTab();
    expect(await screen.findByText(/deleted/i)).toBeInTheDocument();
    await waitFor(() => expect(loadDraft('u-1', { flightId: 9 })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).toBeNull());
  });

  it('keeps the scores through a network failure on the re-read', async () => {
    savedShared();
    api.getFlight.mockRejectedValue(new Error('offline'));
    renderTab();
    const dialog = await flightDialog();
    await waitFor(() => expect(api.getFlight).toHaveBeenCalled());
    expect(within(dialog).getByRole('radio', { name: /^4 stars/ })).toBeChecked();
    expect(loadDraft('u-1', { flightId: 9 })).not.toBeNull();
  });
});

describe('a QR link to a different flight', () => {
  it('leaves a solo flight in progress to be picked back up by Start a tasting', async () => {
    saveDraft('u-1', [
      { type: 'togglePick', coffee: guji },
      { type: 'screen', screen: 'entry' },
      { type: 'val', coffeeId: 1, attr: 'overall', value: 4 },
    ].reduce(reducer, initialDraft()));
    api.getFlight.mockResolvedValue(sharedFlight({ id: 12, name: 'Second table' }));
    renderTab('/f/12');
    await screen.findByText('Second table');
    expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a tasting' }));
    expect(within(await flightDialog()).getByRole('radio', { name: /^4 stars/ })).toBeChecked();
  });

  it("opens that flight's invite and leaves the other flight's scores saved", async () => {
    savedShared();
    api.getFlight.mockResolvedValue(sharedFlight({ id: 12, name: 'Second table' }));
    renderTab('/f/12');
    await screen.findByText('Second table');
    expect(screen.queryByRole('dialog', { name: 'Tasting flight' })).toBeNull();
    expect(loadDraft('u-1', { flightId: 9 }).entries[1].vals.overall).toBe(4);
  });

  it('returns the saved scores when that other flight is reopened from its card', async () => {
    savedShared();
    const other = sharedFlight({ id: 12, name: 'Second table' });
    api.getFlight.mockResolvedValue(other);
    api.getRecentFlights.mockResolvedValue({ flights: [sharedFlight()], me: { name: 'Robin Host' } });
    renderTab('/f/12');
    const card = await screen.findByTestId('invite-9');
    fireEvent.click(within(card).getByRole('button', { name: 'Taste this flight' }));
    const dialog = await flightDialog();
    expect(within(dialog).getByRole('radio', { name: /^4 stars/ })).toBeChecked();
  });
});
