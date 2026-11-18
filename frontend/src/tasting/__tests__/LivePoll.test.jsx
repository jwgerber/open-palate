/**
 * The entry-time "live poll": an open Advanced flight is polled while a taster scores
 * so the banner sees the host's start and passes. It dispatches only on a real
 * change, never pulls a taster off their sheet, and its 1 s clock repaints only
 * the banner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { memo, useCallback, useReducer } from 'react';

const { api, auth, rows } = vi.hoisted(() => ({
  api: { logTastings: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(), getFlightResult: vi.fn(), getSummary: vi.fn(), getReveal: vi.fn(), getMembers: vi.fn() },
  auth: { role: 'member' },
  rows: { renders: 0, screens: 0, hit() { this.renders += 1; }, hitScreen() { this.screens += 1; } },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});
vi.mock('../advanced/AdvancedScoreRow', async (importOriginal) => {
  const Real = (await importOriginal()).default;
  return { default: memo((props) => { rows.hit(); return <Real {...props} />; }) };
});

// AdvancedEntryScreen re-rendering would not show in the memoized rows, but it would re-render its Screen shell.
vi.mock('../bits/Screen', async (importOriginal) => {
  const Real = (await importOriginal()).default;
  return { default: (props) => { rows.hitScreen(); return <Real {...props} />; } };
});

import FlightDialog from '../log/FlightDialog';
import { LIVE_POLL_MS, POLL_MS } from '../log/shareSupport';
import { reducer, initialDraft } from '../log/flightDraft';

const FLIGHT = {
  id: 9, name: 'Thursday cupping', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: false, is_host: false, is_open: true,
  roster: [], logged_count: 0, adv_pass: null, timer_started_at: null, timer_elapsed_s: null,
  cups: [1, 2].map((p) => ({ position: p, label: `Cup ${p}`, blind: false, coffee_id: p, name: `Coffee ${p}`, roaster: 'R' })),
};
const dispatched = [];

function Harness({ flight = FLIGHT, screenName = 'entry', logged = false }) {
  const [draft, rawDispatch] = useReducer(reducer, null,
    () => ({ ...reducer(initialDraft(), { type: 'seedFromFlight', flight }), screen: screenName, logged }));
  // Spy at the dispatch call: a reducer body can run twice per dispatch.
  const dispatch = useCallback((a) => { dispatched.push(a); rawDispatch(a); }, []);
  return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
}

// act() defers React's re-render to its exit, so a full-period advance would fire the next interval tick
// against the stale closure; settle the leading tick first, then run out the rest of one live-poll period.
const flush = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS - 1000); });
};
const updates = () => dispatched.filter((a) => a.type === 'flightUpdated');

beforeEach(() => {
  vi.useFakeTimers();
  dispatched.length = 0;
  rows.renders = 0;
  rows.screens = 0;
  Object.values(api).forEach((f) => f.mockReset());
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
  api.getFlight.mockImplementation(async () => ({ ...FLIGHT }));
});
afterEach(() => { vi.useRealTimers(); });

describe('live poll', () => {
  it('runs on the entry screen of an open Advanced flight', async () => {
    render(<Harness />);
    await flush();
    expect(api.getFlight).toHaveBeenCalled();
  });

  it('polls every LIVE_POLL_MS (15 s), slower than the 5 s reveal poll', async () => {
    expect(LIVE_POLL_MS).toBe(15000);
    expect(POLL_MS).toBe(5000);
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const leading = api.getFlight.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(api.getFlight.mock.calls.length).toBe(leading);
    await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS - POLL_MS); });
    expect(api.getFlight.mock.calls.length).toBe(leading + 1);
  });

  it('does not run on a basic flight', async () => {
    render(<Harness flight={{ ...FLIGHT, sheet: 'basic' }} />);
    await flush();
    expect(api.getFlight).not.toHaveBeenCalled();
  });

  it('does not run on a closed flight', async () => {
    render(<Harness flight={{ ...FLIGHT, is_open: false }} />);
    await flush();
    expect(api.getFlight).not.toHaveBeenCalled();
  });

  it('dispatches nothing when only timer_elapsed_s moved', async () => {
    let n = 0;
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, timer_elapsed_s: (n += 5) }));
    render(<Harness />);
    await flush();
    await flush();
    expect(api.getFlight.mock.calls.length).toBeGreaterThan(1);
    expect(updates()).toHaveLength(0);
  });

  it('dispatches once when adv_pass changes', async () => {
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, adv_pass: 1, timer_started_at: 't0', timer_elapsed_s: 700 }));
    render(<Harness />);
    await flush();
    await flush();
    expect(updates()).toHaveLength(1);
    expect(updates()[0].flight.adv_pass).toBe(1);
  });

  it('dispatches once when the timer is restarted (new timer_started_at)', async () => {
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, adv_pass: 0, timer_started_at: 't1', timer_elapsed_s: 3 }));
    render(<Harness flight={{ ...FLIGHT, adv_pass: 0, timer_started_at: 't0', timer_elapsed_s: 400 }} />);
    await flush();
    await flush();
    expect(updates()).toHaveLength(1);
  });

  it('stops once the taster has logged (the reveal poll takes over)', async () => {
    render(<Harness logged />);
    await flush();
    expect(api.getFlight).not.toHaveBeenCalled();
  });

  it('keeps the taster on their sheet when the host closes mid-entry', async () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByTestId('advanced-slider-aroma'), { key: 'ArrowRight' });
    expect(screen.getByText(/1 of 10 scored/)).toBeInTheDocument();
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, is_open: false }));
    await flush();
    await flush();
    expect(updates().some((a) => a.flight.is_open === false)).toBe(true);
    expect(api.getFlightResult).not.toHaveBeenCalled();
    expect(api.getSummary).not.toHaveBeenCalled();
    expect(screen.getByText(/1 of 10 scored/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the banner from the first poll that carries a start', async () => {
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, adv_pass: 0, timer_started_at: 't0', timer_elapsed_s: 192 }));
    render(<Harness />);
    expect(screen.getByRole('status')).toHaveTextContent('Setting up');
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(/3:\d\d · Steeping/);
  });

  it('the 1 s clock re-renders no score row', async () => {
    api.getFlight.mockImplementation(async () => ({ ...FLIGHT, adv_pass: 0, timer_started_at: 't0', timer_elapsed_s: 10 }));
    render(<Harness flight={{ ...FLIGHT, adv_pass: 0, timer_started_at: 't0', timer_elapsed_s: 10 }} />);
    await flush();
    const before = rows.renders;
    const screensBefore = rows.screens;
    expect(before).toBeGreaterThan(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByRole('status')).toHaveTextContent(/0:1\d|0:2\d/);
    expect(rows.renders).toBe(before);
    expect(rows.screens).toBe(screensBefore);
  });
});
