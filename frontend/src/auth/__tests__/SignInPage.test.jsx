import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../api';
import SignInPage from '../SignInPage';

const mount = (path = '/signin') => render(<MemoryRouter initialEntries={[path]}><SignInPage /></MemoryRouter>);

describe('SignInPage', () => {
  beforeEach(() => { vi.clearAllMocks(); api.post.mockResolvedValue({ data: { status: 'sent' } }); });

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
});
