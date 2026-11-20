import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tasting, auth, apiMock } = vi.hoisted(() => ({
  tasting: { getCoffees: vi.fn(), invalidateCoffees: vi.fn() },
  auth: { role: 'admin' },
  apiMock: { post: vi.fn() },
}));
vi.mock('../tastingApi', () => ({ tastingApi: tasting, default: tasting }));
vi.mock('../../api', () => ({ default: apiMock }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import SampleDataCard from '../bits/SampleDataCard';

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'admin';
  tasting.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
});

describe('SampleDataCard', () => {
  it('offers sample data to an admin with no coffees, and loads it then reloads the tab', async () => {
    apiMock.post.mockResolvedValue({ status: 201, data: { coffees: 5 } });
    const onLoaded = vi.fn();
    render(<SampleDataCard onLoaded={onLoaded} />);
    expect(await screen.findByText('Explore with sample data')).toBeInTheDocument();
    expect(screen.getByText("Adds 5 example coffees and two finished blind flights tasted by three sample tasters, one of them a cupping on the advanced sheet. Remove it any time in Group settings.")).toBeInTheDocument();
    expect(tasting.getCoffees).toHaveBeenCalledWith({ includeArchived: true });
    await userEvent.click(screen.getByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/group/sample-data'));
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(tasting.invalidateCoffees).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Explore with sample data')).toBeNull());
  });

  it('warns and shows nothing when the emptiness check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    tasting.getCoffees.mockRejectedValue(new Error('down'));
    render(<SampleDataCard onLoaded={vi.fn()} />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.queryByText('Explore with sample data')).toBeNull();
    warn.mockRestore();
  });

  it.each(['member', 'editor', 'device'])('shows nothing to a %s', async (role) => {
    auth.role = role;
    render(<SampleDataCard onLoaded={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Explore with sample data')).toBeNull();
    expect(tasting.getCoffees).not.toHaveBeenCalled();
  });

  it('shows nothing when the group already has coffees', async () => {
    tasting.getCoffees.mockResolvedValue({ coffees: [{ id: 1 }], roasters: [] });
    render(<SampleDataCard onLoaded={vi.fn()} />);
    await waitFor(() => expect(tasting.getCoffees).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Explore with sample data')).toBeNull();
  });

  it('explains a 409 already_loaded in plain words and stays disabled', async () => {
    apiMock.post.mockRejectedValue({ response: { status: 409, data: { error: 'already_loaded' } } });
    const onLoaded = vi.fn();
    render(<SampleDataCard onLoaded={onLoaded} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load sample data' }));
    expect(await screen.findByText('Sample data is already loaded.')).toBeInTheDocument();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Load sample data' })).toBeDisabled();
  });

  it('hides the card on a 409 not_empty: the group has coffees now', async () => {
    apiMock.post.mockRejectedValue({ response: { status: 409, data: { error: 'not_empty' } } });
    const onLoaded = vi.fn();
    render(<SampleDataCard onLoaded={onLoaded} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load sample data' }));
    await waitFor(() => expect(screen.queryByText('Explore with sample data')).toBeNull());
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('goes away when the host reports a coffee was added', async () => {
    const { rerender } = render(<SampleDataCard onLoaded={vi.fn()} hasCoffees={false} />);
    expect(await screen.findByText('Explore with sample data')).toBeInTheDocument();
    rerender(<SampleDataCard onLoaded={vi.fn()} hasCoffees />);
    await waitFor(() => expect(screen.queryByText('Explore with sample data')).toBeNull());
  });

  it('re-checks when the window regains focus', async () => {
    render(<SampleDataCard onLoaded={vi.fn()} />);
    expect(await screen.findByText('Explore with sample data')).toBeInTheDocument();
    tasting.getCoffees.mockResolvedValue({ coffees: [{ id: 1 }], roasters: [] });
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.queryByText('Explore with sample data')).toBeNull());
  });
});
