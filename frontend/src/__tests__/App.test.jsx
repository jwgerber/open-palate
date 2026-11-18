import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() }, setLastKind: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ kind: 'user', user: { id: 1 }, group: null, role: null, loading: false, refresh: vi.fn() }),
}));
import App from '../App';

describe('App', () => {
  it('shows a plain screen for a signed-in user who is in no group', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByTestId('no-group')).toHaveTextContent(/not in a group yet/i);
    expect(screen.getByText(/add your email/i)).toBeInTheDocument();
  });
});
