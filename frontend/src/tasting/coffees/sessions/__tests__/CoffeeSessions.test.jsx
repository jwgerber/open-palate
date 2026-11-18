import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { getCoffeeSessions: vi.fn() } }));
vi.mock('../../../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../SessionCard', () => ({ default: ({ session }) => <div data-testid="session-card">card {session.flight_id}</div> }));
vi.mock('../SoloRow', () => ({ default: ({ session }) => <div data-testid="solo-row">solo {session.flight_id}</div> }));

import CoffeeSessions from '../CoffeeSessions';

const sess = (id, shared = true, sheet = 'advanced') => ({ flight_id: id, shared, sheet, date: '2026-11-05', prep: 'cupping' });
const props = { coffeeId: 1, onDeleteRead: vi.fn(), canManage: false, isPerson: true, reloadKey: 0 };

beforeEach(() => api.getCoffeeSessions.mockReset());

describe('CoffeeSessions', () => {
  it('renders a shared session as a card and a solo one as a row', async () => {
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess(9), sess(8, false, 'basic')], next_before: null });
    render(<CoffeeSessions {...props} />);
    expect(await screen.findByTestId('session-card')).toHaveTextContent('card 9');
    expect(screen.getByTestId('solo-row')).toHaveTextContent('solo 8');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    api.getCoffeeSessions.mockResolvedValue({ sessions: [], next_before: null });
    render(<CoffeeSessions {...props} />);
    expect(await screen.findByText('No tastings yet.')).toBeInTheDocument();
  });

  it('refetches with the sheet when a pill is picked', async () => {
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess(9)], next_before: null });
    render(<CoffeeSessions {...props} />);
    await screen.findByTestId('session-card');
    expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: undefined, sheet: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Cuppings' }));
    await waitFor(() => expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: undefined, sheet: 'advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Basic' }));
    await waitFor(() => expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: undefined, sheet: 'basic' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: undefined, sheet: undefined }));
  });

  it('loads more only when next_before is set, and appends', async () => {
    api.getCoffeeSessions
      .mockResolvedValueOnce({ sessions: [sess(9)], next_before: 9 })
      .mockResolvedValueOnce({ sessions: [sess(5)], next_before: null });
    render(<CoffeeSessions {...props} />);
    await screen.findByText('card 9');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('card 5');
    expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: 9, sheet: undefined });
    expect(screen.getByText('card 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('refetches from page 1 when reloadKey changes', async () => {
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess(9)], next_before: null });
    const { rerender } = render(<CoffeeSessions {...props} />);
    await screen.findByText('card 9');
    rerender(<CoffeeSessions {...props} reloadKey={1} />);
    await waitFor(() => expect(api.getCoffeeSessions).toHaveBeenCalledTimes(2));
    expect(api.getCoffeeSessions).toHaveBeenLastCalledWith(1, { before: undefined, sheet: undefined });
  });

  it('shows an error with a retry when the fetch fails', async () => {
    api.getCoffeeSessions.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ sessions: [sess(9)], next_before: null });
    render(<CoffeeSessions {...props} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('card 9')).toBeInTheDocument();
  });

  it('clears a pending load-more when the filter changes before it answers', async () => {
    let resolveMore;
    api.getCoffeeSessions
      .mockResolvedValueOnce({ sessions: [sess(9)], next_before: 9 })
      .mockImplementationOnce(() => new Promise((r) => { resolveMore = r; }))
      .mockResolvedValueOnce({ sessions: [sess(7, true, 'basic')], next_before: 7 });
    render(<CoffeeSessions {...props} />);
    await screen.findByText('card 9');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Basic' }));
    resolveMore({ sessions: [sess(5)], next_before: null });
    expect(await screen.findByText('card 7')).toBeInTheDocument();
    expect(screen.queryByText('card 5')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading tastings')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });
});
