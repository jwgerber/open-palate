import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const refresh = vi.fn(() => Promise.resolve());
let setup = null;
vi.mock('../AuthContext', () => ({ useAuth: () => ({ refresh, setup }) }));
import api from '../../api';
import SetupPage from '../SetupPage';

const mount = (path) => render(<MemoryRouter initialEntries={[path]}><SetupPage /></MemoryRouter>);

describe('SetupPage', () => {
  beforeEach(() => { vi.clearAllMocks(); setup = null; });

  it('posts the token from the URL with the admin details', async () => {
    api.post.mockResolvedValue({ data: { status: 'ok' } });
    mount('/setup?token=abc123');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/setup', { token: 'abc123', email: 'robin@example.test', display_name: 'Robin Admin' });
  });

  it('refuses without a token', async () => {
    setup = { needed: true, open: false, password: false };
    mount('/setup');
    expect(screen.getByRole('alert')).toHaveTextContent(/setup link/i);
  });

  it('offers Retry, not the closed copy, when the status check failed', async () => {
    setup = { failed: true };
    mount('/setup');
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't check whether setup is open/i);
    expect(screen.queryByText(/SETUP_PASSWORD/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('says setup is done on a 409', async () => {
    mount('/setup?token=t');
    api.post.mockRejectedValue({ response: { status: 409, data: { error: 'setup_done' } } });
    await userEvent.type(screen.getByLabelText('Your name'), 'R');
    await userEvent.type(screen.getByLabelText('Email'), 'r@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    expect(await screen.findByText(/already been set up/i)).toBeInTheDocument();
  });

  it('shows a Setup password field when only the password route is open, and sends it', async () => {
    setup = { needed: true, open: false, password: true };
    api.post.mockResolvedValue({ data: { status: 'ok' } });
    mount('/setup');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.test');
    await userEvent.type(screen.getByLabelText('Setup password'), 'hunter2');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/setup', { email: 'robin@example.test', display_name: 'Robin Admin', setup_password: 'hunter2' });
  });

  it('says the password is wrong on invalid_token', async () => {
    setup = { needed: true, open: false, password: true };
    api.post.mockRejectedValue({ response: { status: 400, data: { error: 'invalid_token' } } });
    mount('/setup');
    await userEvent.type(screen.getByLabelText('Your name'), 'R');
    await userEvent.type(screen.getByLabelText('Email'), 'r@example.test');
    await userEvent.type(screen.getByLabelText('Setup password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    expect(await screen.findByText(/setup password isn't right/i)).toBeInTheDocument();
  });

  it('shows no form and the log / SETUP_PASSWORD hint when setup is closed', () => {
    setup = { needed: true, open: false, password: false };
    mount('/setup');
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(screen.getByText(/setup link/i)).toHaveTextContent(/SETUP_PASSWORD/);
  });

  it('shows the name and email form without a token when setup is open (no password field)', () => {
    setup = { needed: true, open: true, password: false };
    mount('/setup');
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Setup password')).toBeNull();
  });

  it('a valid ?token= still shows the form whatever open says', async () => {
    setup = { needed: true, open: false, password: false };
    api.post.mockResolvedValue({ data: { status: 'ok' } });
    mount('/setup?token=tok');
    await userEvent.type(screen.getByLabelText('Your name'), 'R');
    await userEvent.type(screen.getByLabelText('Email'), 'r@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/setup', { token: 'tok', email: 'r@example.test', display_name: 'R' }));
  });

  it('says setup is already done, with a sign-in link, when no setup is needed', () => {
    setup = { needed: false };
    mount('/setup?token=old');
    expect(screen.getByText(/setup is already done/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });
});
