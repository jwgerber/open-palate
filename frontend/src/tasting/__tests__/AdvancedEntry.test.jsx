/**
 * Advanced entry: a 3-cup blind shared cupping seeded the way a joiner gets it,
 * rendered through FlightDialog so the log path is the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useReducer } from 'react';

const { api, auth } = vi.hoisted(() => ({
  api: { logTastings: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(), getReveal: vi.fn(), getMembers: vi.fn() },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import FlightDialog from '../log/FlightDialog';
import { reducer, initialDraft } from '../log/flightDraft';

const FLIGHT = {
  id: 9, name: 'Thursday cupping', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: true, is_host: false, is_open: true,
  roster: [], logged_count: 0,
  cups: [1, 2, 3].map((p) => ({ position: p, label: `Cup ${String.fromCharCode(64 + p)}`, blind: true, name: 'Guji Shakiso', roaster: 'Maple Roasters' })),
};

function Harness() {
  const [draft, dispatch] = useReducer(reducer, null, () => reducer(initialDraft(), { type: 'seedFromFlight', flight: FLIGHT }));
  return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
}

const score = (cat, v) => fireEvent.keyDown(screen.getByTestId(`advanced-slider-${cat}`), { key: v });
// Keyboard: ArrowRight from untouched lands on 8.5 (8.0 + one step), so every score is 8.5.
const scoreAll = (cats) => cats.forEach((c) => score(c, 'ArrowRight'));
const ALL = ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance'];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
  api.logTastings.mockResolvedValue({ id: 9, is_open: true, logged_count: 1, you_logged: true, roster: [], cups: [] });
});

const named = (id, name) => ({ id, name, roaster: 'Maple Roasters', kind: 'house' });
const HOSTED = { ...FLIGHT, is_host: true, cups: FLIGHT.cups.map(({ position, label, blind }) => ({ position, label, blind, coffee_id: null, name: null })) };

function HostHarness() {
  const [draft, dispatch] = useReducer(reducer, null, () => [
    { type: 'togglePick', coffee: named(1, 'Guji Shakiso') }, { type: 'togglePick', coffee: named(2, 'Winter Blend') },
    { type: 'togglePick', coffee: named(3, 'Decaf Huila') }, { type: 'sheet', sheet: 'advanced' },
    { type: 'sharedCreated', flight: HOSTED }, { type: 'screen', screen: 'entry' },
  ].reduce(reducer, initialDraft()));
  return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
}

describe('AdvancedEntryScreen', () => {
  it('the host of a blind cupping sees Cup A, never the coffee name', () => {
    render(<HostHarness />);
    expect(screen.getByRole('heading', { name: 'Cup A' })).toBeInTheDocument();
    expect(screen.queryByText(/Guji|Shakiso|Winter|Decaf|Huila|Maple Roasters/)).toBeNull();
  });

  it('shows the blind cup header and hint, with no coffee name', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Cup A' })).toBeInTheDocument();
    expect(screen.getByText('Start at 8 (clean). Go up for good things, down for faults.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Balance' })).toBeInTheDocument();
    // The seeded cups carry real names; a blind screen must not render them.
    expect(screen.queryByText(/Guji|Shakiso|Maple Roasters/)).toBeNull();
  });

  it('updates the footer and the Taste pill as scores land', () => {
    render(<Harness />);
    expect(screen.getByText(/so far · 0 of 10 scored/)).toBeInTheDocument();
    score('acidity', 'ArrowRight');
    expect(screen.getByText(/so far · 1 of 10 scored/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taste 1/3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aromatic 0/3' })).toBeInTheDocument();
  });

  it('blocks Log on a half-done cup until it is cleared, then logs one cup with bar_vote', async () => {
    render(<Harness />);
    scoreAll(ALL);
    expect(screen.getByText(/\/ 100 · All 10 scored ✓/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    expect(screen.getByRole('heading', { name: 'Cup B' })).toBeInTheDocument();
    scoreAll(['aroma', 'flavour']);

    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(await screen.findByText(/Cup B is half-done\. Finish it, or clear it to skip/)).toBeInTheDocument();
    const logBtn = screen.getByRole('button', { name: 'Log 1 cup' });
    expect(logBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Cup B' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByText(/half-done\. Finish/)).toBeNull());
    expect(await screen.findByRole('button', { name: 'Log 1 cup' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Log 1 cup' }));
    await waitFor(() => expect(api.logTastings).toHaveBeenCalledTimes(1));
    const [id, entries] = api.logTastings.mock.calls[0];
    expect(id).toBe(9);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ position: 1, bar_vote: 'yes', aroma: 8.5, balance: 8.5 });
  });

  it('a 409 flight_closed on Log says the host closed it and keeps the draft', async () => {
    api.logTastings.mockRejectedValue({ response: { status: 409, data: { error: 'flight_closed', message: 'This flight is already closed' } } });
    render(<Harness />);
    scoreAll(ALL);
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Log 1 cup' }));
    expect((await screen.findAllByText('The host closed this cupping.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('flight_closed')).toBeNull();
    // Still on the sheet with the scores in hand (no jump to the reveal).
    expect(screen.getByRole('button', { name: 'Log 1 cup' })).toBeInTheDocument();
  });

  it('pluralises the Log button for more than one cup', async () => {
    render(<Harness />);
    scoreAll(ALL);
    fireEvent.click(screen.getByRole('radio', { name: /Maybe/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    scoreAll(ALL);
    fireEvent.click(screen.getByRole('radio', { name: /No/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(await screen.findByRole('button', { name: 'Log 2 cups' })).toBeEnabled();
    expect(within(screen.getByLabelText('All cups')).getByText('Skipping cups is fine. Nothing is shared until the host closes.')).toBeInTheDocument();
  });

  it('Next on the last cup opens the All cups sheet', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup C' }));
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    const sheet = await screen.findByLabelText('All cups');
    expect(sheet).toBeInTheDocument();
  });

  it('stacks the All cups sheet above the dialog and announces tile contents', async () => {
    render(<Harness />);
    scoreAll(ALL);
    score('aroma', 'Home'); // 7.5
    fireEvent.click(screen.getByTestId('advanced-value-aroma').parentElement.querySelector('button[aria-pressed]'));
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    const tile = await screen.findByRole('button', { name: /^Cup A, done, \d+\.\d, Yes, D\/Q$/ });
    expect(tile).toBeInTheDocument();
    const root = document.querySelector('.MuiDrawer-root');
    expect(Number(getComputedStyle(root).zIndex)).toBeGreaterThan(1300);
  });

  it('Clear asks first, naming the score count; cancelling keeps the scores', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    scoreAll(['aroma', 'flavour', 'balance']);
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Cup B' }));
    const dialog = await screen.findByRole('dialog', { name: "Clear Cup B's 3 scores?" });
    expect(Number(getComputedStyle(dialog.closest('.MuiDialog-root')).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(document.querySelector('.MuiDrawer-root')).zIndex),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Clear Cup B/ })).toBeNull());
    expect(screen.getByText(/Cup B is half-done/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Cup B' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.queryByText(/Cup B is half-done/)).toBeNull());
  });

  it('warns that a cup with notes but no scores will not be logged, without blocking Log', async () => {
    render(<Harness />);
    scoreAll(ALL);
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    fireEvent.click(screen.getByRole('button', { name: /Defects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'musty' }));
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    expect(await screen.findByText("Cup B has notes or flavors but no scores — they won't be logged.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log 1 cup' })).toBeEnabled();
  });

  it('shows no notes-only warning when nothing is stranded', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    await screen.findByLabelText('All cups');
    expect(screen.queryByText(/no scores — they won't be logged/)).toBeNull();
  });

  it('marks the sheet a modal dialog and the current tile aria-current, with a caption when half-done', async () => {
    render(<Harness />);
    scoreAll(['aroma']);
    fireEvent.click(screen.getByRole('button', { name: 'All 3' }));
    const sheet = await screen.findByLabelText('All cups');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    const tile = within(sheet).getByRole('button', { name: /^Cup A, half-done/ });
    expect(tile).toHaveAttribute('aria-current', 'true');
    expect(within(tile).getByText(/current/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Cup B/ })).not.toHaveAttribute('aria-current');
  });

  it('resets a score row\'s open guidance when the cup changes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Aroma guidance' }));
    expect(screen.getByRole('button', { name: 'Aroma guidance' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next: Cup B' }));
    expect(screen.getByRole('button', { name: 'Aroma guidance' })).toHaveAttribute('aria-expanded', 'false');
  });
});
