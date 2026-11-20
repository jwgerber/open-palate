import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
let setup = null;
vi.mock('../AuthContext', () => ({ useAuth: () => ({ setup }) }));
import api from '../../api';
import SignInPage from '../SignInPage';

const INTRO_OFF = "This copy of Open Palate can't send email. Staff: ask an admin to copy a sign-in link for you. Admins and editors: your link goes to the server log.";
const SENT_OFF = 'If that address is on the list, a sign-in link was written to the server log (on Render: Logs, search for "Sign-in link for"). It works once and expires in 15 minutes.';

const mount = (path = '/signin') => render(<MemoryRouter initialEntries={[path]}><SignInPage /></MemoryRouter>);

describe('SignInPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { status: 'sent' } });
    setup = { needed: false, email: true };
  });

  it('shows the same message for any email', async () => {
    const seen = [];
    for (const email of ['known@example.test', 'nobody@example.test']) {
      const { unmount } = mount();
      await userEvent.type(screen.getByLabelText('Email'), email);
      await userEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }));
      const note = await screen.findByTestId('sent-note');
      seen.push(note.textContent);
      expect(api.post).toHaveBeenLastCalledWith('/auth/request-link', { email });
      unmount();
    }
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatch(/if that address/i);
  });

  it('explains an expired link without echoing anything from the URL', () => {
    mount('/signin?error=expired');
    expect(screen.getByRole('alert')).toHaveTextContent(/expired or was already used/i);
  });

  it('says to wait when the server rate-limits the request', async () => {
    api.post.mockRejectedValue({ response: { status: 429, data: {} } });
    mount();
    await userEvent.type(screen.getByLabelText('Email'), 'a@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many/i));
  });

  const submitFor = async (email) => {
    await userEvent.type(screen.getByLabelText('Email'), email);
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }));
    return screen.findByTestId('sent-note');
  };

  it('says email is off and where links go, from the status the app already loaded', async () => {
    setup = { needed: false, email: false };
    mount();
    expect(screen.getByText(INTRO_OFF)).toBeInTheDocument();
    expect((await submitFor('a@example.test')).textContent).toBe(SENT_OFF);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps the email wording when email is on', async () => {
    mount();
    expect(screen.getByText('Sign in with your email. We send a one-time link.')).toBeInTheDocument();
    expect((await submitFor('a@example.test')).textContent).toMatch(/a sign-in link is on its way/);
  });

  it('keeps the email wording when the setup status is unknown or failed', async () => {
    for (const unknown of [null, { failed: true }]) {
      setup = unknown;
      const { unmount } = mount();
      expect(screen.getByText('Sign in with your email. We send a one-time link.')).toBeInTheDocument();
      unmount();
    }
  });
});
