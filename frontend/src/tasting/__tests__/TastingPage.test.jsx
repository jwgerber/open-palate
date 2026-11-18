import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const auth = vi.hoisted(() => ({ role: 'member' }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});
vi.mock('../log/LogTab', () => ({ default: () => <div>log-tab</div> }));
vi.mock('../coffees/CoffeesTab', () => ({ default: () => <div>coffees-tab</div> }));
vi.mock('../coffees/CoffeePage', () => ({ default: () => <div>coffee-page</div> }));
vi.mock('../palate/PalateTab', () => ({ default: () => <div>palate-tab</div> }));
vi.mock('../print/PrintSheetsPage', () => ({ default: () => <div>print-sheets-page</div> }));

import TastingPage from '../TastingPage';

// Mounted under the same splat route App.jsx uses, so the nested routes resolve.
const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/*" element={<TastingPage />} />
    </Routes>
  </MemoryRouter>,
);

describe('TastingPage', () => {
  it('lands on the Log tab and shows the three tabs', async () => {
    auth.role = 'member';
    renderAt('/');
    await waitFor(() => expect(screen.getByText('log-tab')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: 'Log' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Coffees' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'My palate' })).toBeInTheDocument();
  });

  it('routes a shared-flight link and a coffee page', async () => {
    auth.role = 'member';
    renderAt('/f/12');
    await waitFor(() => expect(screen.getByText('log-tab')).toBeInTheDocument());
    renderAt('/coffees/7');
    await waitFor(() => expect(screen.getByText('coffee-page')).toBeInTheDocument());
  });

  it('hides My palate from a shared device and redirects it to Log', async () => {
    auth.role = 'device';
    renderAt('/palate');
    await waitFor(() => expect(screen.getByText('log-tab')).toBeInTheDocument());
    expect(screen.queryByRole('tab', { name: 'My palate' })).not.toBeInTheDocument();
  });

  it('keeps the 640 reading column', async () => {
    auth.role = 'member';
    renderAt('/log');
    await waitFor(() => expect(screen.getByText('log-tab')).toBeInTheDocument());
    expect(screen.getByTestId('tasting-column')).toHaveStyle({ maxWidth: '640px' });
  });

  it('sends an unknown path to the Log tab', async () => {
    auth.role = 'editor';
    renderAt('/nowhere');
    await waitFor(() => expect(screen.getByText('log-tab')).toBeInTheDocument());
  });

  it('renders the print-sheets route without the tab bar or column', async () => {
    auth.role = 'member';
    renderAt('/print/sheets/12');
    await waitFor(() => expect(screen.getByText('print-sheets-page')).toBeInTheDocument());
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tasting-column')).not.toBeInTheDocument();
  });
});
