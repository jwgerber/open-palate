import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let lastKind = null;
vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  setLastKind: (k) => { lastKind = k; },
  getLastKind: () => lastKind,
}));
vi.mock('../tasting/forgetLocalState', () => ({ forgetLocalState: vi.fn() }));
vi.mock('../tasting/useContent', () => ({ useContent: () => ({ ready: true, error: null }) }));
vi.mock('../tasting/TastingPage', () => ({ default: () => <div>TASTING-APP</div> }));
vi.mock('../auth/SignInPage', () => ({ default: () => <div>SIGNIN-PAGE</div> }));
vi.mock('../auth/DeviceCodePage', () => ({ default: () => <div>DEVICE-PAGE</div> }));
vi.mock('../auth/SetupPage', () => ({ default: () => <div>SETUP-PAGE</div> }));
import api from '../api';
import { forgetLocalState } from '../tasting/forgetLocalState';
import { AuthProvider } from '../auth/AuthContext';
import App from '../App';

const group = { id: 1, name: 'G', timezone: 'UTC', role: 'member' };
const me = (kind) => ({ data: { kind, user: kind === 'user' ? { id: 1 } : null, groups: [group] } });
const unauthorized = { response: { status: 401 } };
const mount = () => render(
  <MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); lastKind = null; vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('session load', () => {
  it('shows a retry screen, not the sign-in page, on a network error; retry recovers', async () => {
    api.get.mockRejectedValueOnce(new Error('Network Error'));
    mount();
    expect(await screen.findByTestId('unreachable')).toHaveTextContent(/can't reach the server/i);
    expect(screen.queryByText('SIGNIN-PAGE')).toBeNull();
    expect(screen.queryByText('DEVICE-PAGE')).toBeNull();
    api.get.mockResolvedValueOnce(me('user'));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('TASTING-APP')).toBeInTheDocument();
  });

  it('keeps showing the retry screen when the retry fails too', async () => {
    api.get.mockRejectedValue({ response: { status: 503 } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('unreachable')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign-in on a 401', async () => {
    api.get.mockRejectedValueOnce(unauthorized);
    mount();
    expect(await screen.findByText('SIGNIN-PAGE')).toBeInTheDocument();
  });

  it('sends a signed-out shared device back to the device-code page', async () => {
    lastKind = 'device';
    api.get.mockRejectedValueOnce(unauthorized);
    mount();
    expect(await screen.findByText('DEVICE-PAGE')).toBeInTheDocument();
  });
});

describe('disconnecting a shared device', () => {
  const connected = async () => {
    api.get.mockResolvedValueOnce(me('device'));
    mount();
    await screen.findByText('TASTING-APP');
  };

  it('asks first, and Cancel leaves the device signed in', async () => {
    await connected();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/new device code/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(forgetLocalState).not.toHaveBeenCalled();
  });

  it('confirming logs out, forgets local state, and returns to the device page', async () => {
    await connected();
    api.post.mockResolvedValue({ data: {} });
    api.get.mockRejectedValueOnce(unauthorized);
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('DEVICE-PAGE')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
    expect(forgetLocalState).toHaveBeenCalledTimes(1);
  });
});

describe('signing out a person', () => {
  it('signs out at once, forgets local state, and goes to sign-in', async () => {
    api.get.mockResolvedValueOnce(me('user'));
    mount();
    await screen.findByText('TASTING-APP');
    api.post.mockResolvedValue({ data: {} });
    api.get.mockRejectedValueOnce(unauthorized);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('SIGNIN-PAGE')).toBeInTheDocument();
    expect(forgetLocalState).toHaveBeenCalledTimes(1);
  });
});
