import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const refresh = vi.fn(() => Promise.resolve());
vi.mock('../AuthContext', () => ({ useAuth: () => ({ refresh }) }));
import api from '../../api';
import DeviceCodePage from '../DeviceCodePage';

const mount = () => render(<MemoryRouter><DeviceCodePage /></MemoryRouter>);

describe('DeviceCodePage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('stores nothing in localStorage, success or failure', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    api.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'invalid_code' } } });
    mount();
    await userEvent.type(screen.getByLabelText('Device code'), 'abcd-1234');
    await userEvent.click(screen.getByRole('button', { name: 'Connect this device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn.t valid/i);
    api.post.mockResolvedValueOnce({ data: { status: 'ok' } });
    await userEvent.click(screen.getByRole('button', { name: 'Connect this device' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api.post).toHaveBeenLastCalledWith('/device/enter', { code: 'abcd-1234' });
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
