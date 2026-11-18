import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const refresh = vi.fn(() => Promise.resolve());
vi.mock('../AuthContext', () => ({ useAuth: () => ({ refresh }) }));
import api from '../../api';
import SetupPage from '../SetupPage';

const mount = (path) => render(<MemoryRouter initialEntries={[path]}><SetupPage /></MemoryRouter>);

describe('SetupPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('posts the token from the URL with the admin details', async () => {
    api.post.mockResolvedValue({ data: { status: 'ok' } });
    mount('/setup?token=abc123');
    await userEvent.type(screen.getByLabelText('Your name'), 'Robin Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'robin@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create the first admin' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/auth/setup', { token: 'abc123', email: 'robin@example.test', display_name: 'Robin Admin' });
  });

  it('refuses without a token and says setup is done on a 409', async () => {
    mount('/setup');
    expect(screen.getByRole('alert')).toHaveTextContent(/setup link/i);
    mount('/setup?token=t');
    api.post.mockRejectedValue({ response: { status: 409, data: { error: 'setup_done' } } });
    await userEvent.type(screen.getAllByLabelText('Your name')[1], 'R');
    await userEvent.type(screen.getAllByLabelText('Email')[1], 'r@example.test');
    await userEvent.click(screen.getAllByRole('button', { name: 'Create the first admin' })[1]);
    expect(await screen.findByText(/already been set up/i)).toBeInTheDocument();
  });
});
