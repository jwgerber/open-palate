import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getCoffees: vi.fn(), previewCoffeeImport: vi.fn(), importCoffees: vi.fn(), downloadCoffeesCsv: vi.fn(),
    invalidateCoffees: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import CoffeesTab from '../coffees/CoffeesTab';
import CoffeeImportDialog from '../coffees/CoffeeImportDialog';
import { renderAt, guji } from './helpers';

const FILE = new File(['id,name\n'], 'coffees.csv', { type: 'text/csv' });
const PLAN = {
  file_errors: [], row_errors: [], warnings: [], unchanged_count: 4, plan_hash: 'h1',
  creates: [{ row: 2, coffee_id: null, name: 'Kochere', fields: [{ column: 'name', old: null, new: 'Kochere' }, { column: 'roaster', old: null, new: 'Onyx' }] }],
  updates: [{ row: 3, coffee_id: 1, name: 'Guji Shakiso', fields: [{ column: 'process', old: 'washed', new: 'natural' }, { column: 'stores', old: ['Main St'], new: [] }] }],
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getCoffees.mockResolvedValue({ coffees: [guji], roasters: ['Maple Roasters'] });
  api.downloadCoffeesCsv.mockResolvedValue(new Blob());
  auth.role = 'member';
});

const tab = () => renderAt('/coffees', <Route path="/coffees" element={<CoffeesTab />} />);

describe('CoffeesTab CSV buttons', () => {
  it('hides Export/Import below editor', async () => {
    tab();
    await screen.findByText('Guji Shakiso');
    expect(screen.queryByRole('button', { name: /export csv/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import csv/i })).toBeNull();
  });

  it('shows them for an editor; export downloads', async () => {
    auth.role = 'editor';
    tab();
    fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    expect(api.downloadCoffeesCsv).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument();
  });
});

describe('CoffeeImportDialog', () => {
  const open = (props = {}) => render(
    <CoffeeImportDialog open file={FILE} onClose={vi.fn()} onApplied={vi.fn()} {...props} />,
  );

  it('renders new, changes and warnings from the plan', async () => {
    api.previewCoffeeImport.mockResolvedValue({ ...PLAN, warnings: [{ row: 2, message: 'already exists' }] });
    open();
    expect(await screen.findByText('New coffees (1)')).toBeInTheDocument();
    expect(screen.getByText('Kochere · Onyx')).toBeInTheDocument();
    expect(screen.getByText('Changes (1)')).toBeInTheDocument();
    expect(screen.getByText('process: washed → natural')).toBeInTheDocument();
    expect(screen.getByText('stores: Main St → (blank)')).toBeInTheDocument();
    expect(screen.getByText(/Row 2: already exists/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('shows the skipped coffees and their count', async () => {
    api.previewCoffeeImport.mockResolvedValue({
      ...PLAN,
      skipped: [{ row: 4, name: 'Guji', roaster: 'Onyx', archived: true, message: "'Guji' already exists (archived)" }],
    });
    open();
    expect(await screen.findByText(/1 skipped/)).toBeInTheDocument();
    expect(screen.getByText('Already in your coffees, skipped (1)')).toBeInTheDocument();
    expect(screen.getByText(/Row 4: 'Guji' already exists \(archived\)/)).toBeInTheDocument();
  });

  it('everything skipped is nothing to change, Apply disabled', async () => {
    api.previewCoffeeImport.mockResolvedValue({
      ...PLAN, creates: [], updates: [],
      skipped: [{ row: 2, name: 'Guji', roaster: '', archived: false, message: "'Guji' already exists" }],
    });
    open();
    expect(await screen.findByText('Nothing to change.')).toBeInTheDocument();
    expect(screen.getByText('Already in your coffees, skipped (1)')).toBeInTheDocument();
    expect(screen.queryByText(/^1 skipped$/)).toBeNull();
    expect(screen.getByText(/other columns aren't applied; add the coffee's id/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('disables Apply on errors and on nothing to change', async () => {
    api.previewCoffeeImport.mockResolvedValue({ ...PLAN, row_errors: [{ row: 3, coffee_id: 1, column: 'process', message: 'bad' }] });
    const { unmount } = open();
    expect(await screen.findByText('Row 3 · process: bad')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    unmount();
    api.previewCoffeeImport.mockResolvedValue({ ...PLAN, creates: [], updates: [] });
    open();
    expect(await screen.findByText('Nothing to change.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('applies with the plan hash and reports the counts', async () => {
    api.previewCoffeeImport.mockResolvedValue(PLAN);
    api.importCoffees.mockResolvedValue({ created: 1, updated: 1, unchanged: 4 });
    const onApplied = vi.fn();
    open({ onApplied });
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith({ created: 1, updated: 1, unchanged: 4 }));
    const form = api.importCoffees.mock.calls[0][0];
    expect(form.get('plan_hash')).toBe('h1');
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('a 409 asks for a re-preview, and retry previews again', async () => {
    api.previewCoffeeImport.mockResolvedValue(PLAN);
    api.importCoffees.mockRejectedValue({ response: { status: 409, data: { error: 'plan_stale', message: 'Data changed since preview — re-preview' } } });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/Data changed since preview/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Re-preview' }));
    await waitFor(() => expect(api.previewCoffeeImport).toHaveBeenCalledTimes(2));
  });
});
