/**
 * The waiting reveal's close affordance follows a group admin, and the
 * poll hook stays quiet while the tab is hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({ role: 'member' }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import RevealScreen from '../log/screens/RevealScreen';
import { usePoll } from '../../common/usePoll';

const waitingDraft = (isHost) => ({
  screen: 'reveal', logged: true, result: null, flightId: 9, error: null,
  flight: { id: 9, is_open: true, is_host: isHost, host_name: 'Robin', logged_count: 1, roster: [{ taster_key: 'user:a', name: 'Robin', is_host: true, status: 'logged' }] },
});

describe('RevealScreen waiting state', () => {
  it('shows the close button to the host', () => {
    auth.role = 'member';
    render(<RevealScreen draft={waitingDraft(true)} onDone={() => {}} onCloseFlight={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close flight & reveal' })).toBeInTheDocument();
  });

  it('hides it from a non-host without a group admin', () => {
    auth.role = 'editor';
    render(<RevealScreen draft={waitingDraft(false)} onDone={() => {}} onCloseFlight={() => {}} />);
    expect(screen.queryByRole('button', { name: /Close (flight|this)/ })).not.toBeInTheDocument();
  });

  it('deletes my read behind a confirm, in the waiting state', () => {
    auth.role = 'member';
    const onDelete = vi.fn();
    render(<RevealScreen draft={waitingDraft(false)} onDone={() => {}} onCloseFlight={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this tasting' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('offers the host "Delete this flight" while nobody else has logged, and surfaces a failure', () => {
    auth.role = 'member';
    const onDeleteFlight = vi.fn();
    const draft = { ...waitingDraft(true), error: "Couldn't delete the flight." };
    render(<RevealScreen draft={draft} onDone={() => {}} onCloseFlight={() => {}} onDeleteFlight={onDeleteFlight} />);
    expect(screen.getByText("Couldn't delete the flight.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this flight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteFlight).toHaveBeenCalledTimes(1);
  });

  it('hides the delete when there is nothing of mine to delete', () => {
    auth.role = 'member';
    render(<RevealScreen draft={waitingDraft(false)} onDone={() => {}} onCloseFlight={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Delete this tasting' })).not.toBeInTheDocument();
  });

  it('offers an admin (a group admin) a labelled close on a flight they did not host', () => {
    auth.role = 'admin';
    const onCloseFlight = vi.fn();
    render(<RevealScreen draft={waitingDraft(false)} onDone={() => {}} onCloseFlight={onCloseFlight} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close this flight (admin)' }));
    expect(onCloseFlight).toHaveBeenCalled();
  });
});

describe('usePoll', () => {
  let visibility = 'visible';
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });
  afterEach(() => { vi.useRealTimers(); visibility = 'visible'; });

  it('ticks once immediately, then on the interval, and pauses while hidden', () => {
    const tick = vi.fn();
    renderHook(() => usePoll(true, tick, 1000));
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tick).toHaveBeenCalledTimes(2);
    visibility = 'hidden';
    act(() => { vi.advanceTimersByTime(3000); });
    expect(tick).toHaveBeenCalledTimes(2);
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('does nothing while inactive and stops on unmount', () => {
    const tick = vi.fn();
    const { unmount } = renderHook(() => usePoll(false, tick, 1000));
    act(() => { vi.advanceTimersByTime(2500); });
    expect(tick).not.toHaveBeenCalled();
    unmount();
  });
});
