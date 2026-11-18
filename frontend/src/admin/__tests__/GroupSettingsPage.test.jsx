import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const refresh = vi.fn(() => Promise.resolve());
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ refresh }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
import api from '../../api';
import GroupSettingsPage from '../GroupSettingsPage';

const members = [
  { id: 1, display_name: 'Robin Admin', email: 'robin@example.test', role: 'admin', active: true, signed_up: true },
  { id: 2, display_name: 'Jo Floor', email: null, role: 'member', active: true, signed_up: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => Promise.resolve({ data: ({
    '/group': { id: 1, name: 'Test Group', timezone: 'UTC' },
    '/group/members': members,
    '/group/device-codes': [],
  })[url] }));
});

describe('GroupSettingsPage', () => {
  it('lists members and changes a role', async () => {
    api.patch.mockResolvedValue({ data: { ...members[1], role: 'editor' } });
    render(<GroupSettingsPage />);
    expect(await screen.findByText('Jo Floor')).toBeInTheDocument();
    expect(screen.getByText('No email (roster only)')).toBeInTheDocument();
    const row = screen.getByText('Jo Floor').closest('div').parentElement;
    await userEvent.click(within(row).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'editor' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/group/members/2', { role: 'editor' }));
  });

  it('shows a new device code once, from the POST response', async () => {
    api.post.mockResolvedValue({ data: { id: 9, code: 'ABCD-2345', expires_at: '2030-01-01T00:00:00' } });
    render(<GroupSettingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make a device code' }));
    expect(await screen.findByTestId('fresh-code')).toHaveTextContent('ABCD-2345');
    expect(api.post).toHaveBeenCalledWith('/group/device-codes');
  });

  it('explains the last-admin refusal', async () => {
    api.patch.mockRejectedValue({ response: { status: 409, data: { error: 'last_admin' } } });
    render(<GroupSettingsPage />);
    const row = (await screen.findByText('Robin Admin')).closest('div').parentElement;
    await userEvent.click(within(row).getAllByRole('switch')[0]);
    expect(await screen.findByText(/at least one active admin/i)).toBeInTheDocument();
  });

  it('saves a new time zone, refreshes the session, and explains a bad one', async () => {
    api.patch.mockResolvedValueOnce({ data: { id: 1, name: 'Test Group', timezone: 'America/Chicago' } });
    render(<GroupSettingsPage />);
    const zone = await screen.findByLabelText('Time zone');
    await userEvent.clear(zone);
    await userEvent.type(zone, 'America/Chicago');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/group', { name: 'Test Group', timezone: 'America/Chicago' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    api.patch.mockRejectedValueOnce({ response: { status: 422, data: { error: 'bad_timezone', field: 'timezone' } } });
    await userEvent.clear(zone);
    await userEvent.type(zone, 'Mars/Base');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/isn't a time zone/i)).toBeInTheDocument();
  });

  it('explains a linked-member email change', async () => {
    api.patch.mockRejectedValue({ response: { status: 409, data: { error: 'member_linked' } } });
    render(<GroupSettingsPage />);
    const row = (await screen.findByText('Robin Admin')).closest('div').parentElement;
    await userEvent.click(within(row).getAllByRole('switch')[0]);
    expect(await screen.findByText(/already signed in/i)).toBeInTheDocument();
  });
});
