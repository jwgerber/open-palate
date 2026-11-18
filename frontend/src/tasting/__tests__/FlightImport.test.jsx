import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const { api, auth } = vi.hoisted(() => ({
  api: { getRecentFlights: vi.fn(), getCoffees: vi.fn(), previewFlightImport: vi.fn(), importFlights: vi.fn(), getFlight: vi.fn(), getLabelKey: vi.fn() },
  auth: { role: 'editor' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LogTab from '../log/LogTab';
import FlightImportDialog from '../log/FlightImportDialog';
import { clearParkedDraft } from '../log/useFlightDraft';
import { renderAt } from './helpers';

const FILE = new File(['flight,prep\n'], 'flights.csv', { type: 'text/csv' });
const DARK = { name: '2026-11-05 Dark', prep: 'cupping', sheet: 'advanced', cup_count: 6, custom_labels: false, new_coffee_count: 0, error_count: 0, existing_count: 0 };
const LIGHT = { name: '2026-11-05 Light', prep: 'drip', sheet: 'basic', cup_count: 4, custom_labels: true, new_coffee_count: 0, error_count: 0, existing_count: 0 };
const PLAN = { file_errors: [], row_errors: [], warnings: [], flights: [DARK, LIGHT], plan_hash: 'h1' };

beforeEach(() => {
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin' } });
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
  auth.role = 'editor';
});

describe('FlightImportDialog', () => {
  const open = (props = {}) => {
    const onApplied = vi.fn();
    render(<FlightImportDialog open file={FILE} onClose={vi.fn()} onApplied={onApplied} {...props} />);
    return { onApplied };
  };
  const apply = () => screen.getByRole('button', { name: 'Apply' });
  const tick = (name) => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(name) }));

  it('lists every flight unticked with Apply disabled', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    open();
    expect(await screen.findByText('2026-11-05 Dark')).toBeInTheDocument();
    expect(screen.getByText(/6 cups/)).toBeInTheDocument();
    expect(screen.getByText(/Advanced/)).toBeInTheDocument();
    expect(screen.getByText(/4 cups/)).toBeInTheDocument();
    expect(screen.getByText(/Basic/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /2026-11-05 Dark/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /2026-11-05 Light/ })).not.toBeChecked();
    expect(apply()).toBeDisabled();
  });

  it('ticking enables Apply and sends only ticked names', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockResolvedValue({ flights: [] });
    open();
    await screen.findByText('2026-11-05 Dark');
    tick('2026-11-05 Dark');
    expect(apply()).toBeEnabled();
    fireEvent.click(apply());
    await waitFor(() => expect(api.importFlights).toHaveBeenCalled());
    const fd = api.importFlights.mock.calls[0][0];
    expect(fd.get('flights')).toBe(JSON.stringify(['2026-11-05 Dark']));
    expect(fd.get('plan_hash')).toBe('h1');
    expect(fd.get('shuffle')).toBe('true');
    expect(fd.get('file')).toBe(FILE);
  });

  it('shuffle is on by default; off shows the note and sends false', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockResolvedValue({ flights: [] });
    open();
    await screen.findByText('2026-11-05 Dark');
    const shuffle = screen.getByRole('checkbox', { name: /shuffle pour order/i });
    expect(shuffle).toBeChecked();
    expect(screen.queryByText(/follow the file order/i)).toBeNull();
    fireEvent.click(shuffle);
    expect(screen.getByText(/follow the file order/i)).toBeInTheDocument();
    tick('2026-11-05 Dark');
    fireEvent.click(apply());
    await waitFor(() => expect(api.importFlights).toHaveBeenCalled());
    expect(api.importFlights.mock.calls[0][0].get('shuffle')).toBe('false');
  });

  it('marks a flight with its own labels and says it keeps file order', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    open();
    await screen.findByText('2026-11-05 Light');
    expect(screen.getByText('Your labels')).toBeInTheDocument();
    expect(screen.getByText(/keep the file's order/i)).toBeInTheDocument();
  });

  it('says ticked flights open now and close in 48 hours', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    open();
    await screen.findByText('2026-11-05 Dark');
    expect(screen.getByText(/open now/i)).toBeInTheDocument();
    expect(screen.getByText(/close in 48 hours/i)).toBeInTheDocument();
    expect(screen.queryByText(/24 hours/i)).toBeNull();
  });

  it('shows N new coffees, omits a missing row number, and has no pending text', async () => {
    api.previewFlightImport.mockResolvedValue({
      ...PLAN,
      warnings: [{ row: null, message: 'Blank flight cells skipped' }],
      flights: [{ ...DARK, new_coffee_count: 1 }, { ...LIGHT, new_coffee_count: 2 }],
    });
    open();
    expect(await screen.findByText('1 new coffee')).toBeInTheDocument();
    expect(screen.getByText('2 new coffees')).toBeInTheDocument();
    expect(screen.getByText('Blank flight cells skipped')).toBeInTheDocument();
    expect(screen.queryByText(/undefined|pending/i)).not.toBeInTheDocument();
  });

  it('a flight with errors shows its count and cannot be ticked; others stay tickable', async () => {
    api.previewFlightImport.mockResolvedValue({
      ...PLAN,
      flights: [{ ...DARK, error_count: 2 }, LIGHT],
      row_errors: [
        { row: 3, column: 'coffee', message: 'no match', flight: '2026-11-05 Dark' },
        { row: 4, column: 'coffee', message: 'no match', flight: '2026-11-05 Dark' },
      ],
    });
    open();
    await screen.findByText('2026-11-05 Dark');
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    const dark = screen.getByRole('checkbox', { name: /2026-11-05 Dark/ });
    expect(dark).toBeDisabled();
    fireEvent.click(dark);
    expect(apply()).toBeDisabled();
    tick('2026-11-05 Light');
    expect(apply()).toBeEnabled();
  });

  it('shows a row error whose flight is null and does not block the other flights', async () => {
    api.previewFlightImport.mockResolvedValue({
      ...PLAN,
      row_errors: [{ row: 9, column: 'flight', message: 'flight name is too long', flight: null }],
    });
    open();
    expect(await screen.findByText('Row 9 · flight: flight name is too long')).toBeInTheDocument();
    tick('2026-11-05 Dark');
    expect(apply()).toBeEnabled();
  });

  it('a file error blocks every flight', async () => {
    api.previewFlightImport.mockResolvedValue({ ...PLAN, file_errors: ["The file has no 'prep' column"] });
    open();
    expect(await screen.findByText("The file has no 'prep' column")).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /2026-11-05 Dark/ })).toBeDisabled();
    expect(apply()).toBeDisabled();
  });

  it('shows warnings without blocking Apply', async () => {
    api.previewFlightImport.mockResolvedValue({ ...PLAN, warnings: [{ row: 5, message: 'Label ignored' }] });
    open();
    expect(await screen.findByText(/Row 5: Label ignored/)).toBeInTheDocument();
    tick('2026-11-05 Dark');
    expect(apply()).toBeEnabled();
  });

  it('409 offers Re-preview, and re-preview clears the ticks', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockRejectedValue({ response: { status: 409, data: { error: 'plan_stale', message: 'Changed since preview' } } });
    open();
    await screen.findByText('2026-11-05 Dark');
    tick('2026-11-05 Dark');
    fireEvent.click(apply());
    expect(await screen.findByText('Changed since preview')).toBeInTheDocument();
    expect(apply()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Re-preview' }));
    await waitFor(() => expect(api.previewFlightImport).toHaveBeenCalledTimes(2));
    await screen.findByText('2026-11-05 Dark');
    expect(screen.getByRole('checkbox', { name: /2026-11-05 Dark/ })).not.toBeChecked();
    expect(apply()).toBeDisabled();
  });

  it('422 swaps in the returned plan', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockRejectedValue({ response: { status: 422, data: { ...PLAN, flights: [DARK], row_errors: [{ row: 2, column: 'label', message: 'duplicate', flight: '2026-11-05 Dark' }] } } });
    open();
    await screen.findByText('2026-11-05 Dark');
    tick('2026-11-05 Dark');
    fireEvent.click(apply());
    expect(await screen.findByText('Row 2 · label: duplicate · 2026-11-05 Dark')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-05 Light')).toBeNull();
    expect(apply()).toBeDisabled();
  });

  it('disables Apply while applying so a double tap cannot submit twice', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockReturnValue(new Promise(() => {}));
    open();
    await screen.findByText('2026-11-05 Dark');
    tick('2026-11-05 Dark');
    fireEvent.click(apply());
    fireEvent.click(apply());
    expect(api.importFlights).toHaveBeenCalledTimes(1);
    expect(apply()).toBeDisabled();
  });
});

describe('FlightImportDialog ready screen', () => {
  const CREATED = {
    flights: [
      { id: 11, name: '2026-11-05 Dark', prep: 'cupping', sheet: 'advanced', cup_count: 6, closes_at: '2026-11-07T15:30:00' },
      { id: 12, name: '2026-11-05 Light', prep: 'drip', sheet: 'basic', cup_count: 4, closes_at: '2026-11-07T15:30:00' },
    ],
  };
  const applyBoth = async (props = {}, dark = false) => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockResolvedValue(CREATED);
    const onClose = vi.fn();
    const onApplied = vi.fn();
    const ui = <FlightImportDialog open file={FILE} onClose={onClose} onApplied={onApplied} {...props} />;
    render(dark ? <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>{ui}</ThemeProvider> : ui);
    await screen.findByText('2026-11-05 Dark');
    fireEvent.click(screen.getByRole('checkbox', { name: /2026-11-05 Dark/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /2026-11-05 Light/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('button', { name: 'Done' });
    return { onClose, onApplied };
  };
  const card = (name) => screen.getByRole('group', { name });

  it('shows the ready screen, not a closed dialog, with no way back to the preview', async () => {
    const { onClose, onApplied } = await applyBoth();
    expect(onClose).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(within(card('2026-11-05 Dark')).getByText(/6 cups/)).toBeInTheDocument();
    // 15:30 UTC on Nov 7 (EST) is 10:30am in the store's zone.
    expect(within(card('2026-11-05 Dark')).getByText(/Closes .*10:30am/)).toBeInTheDocument();
  });

  it('each flight has a QR code, Copy link and Print key; only the Advanced flight has Print sheets', async () => {
    await applyBoth();
    for (const name of ['2026-11-05 Dark', '2026-11-05 Light']) {
      const c = within(card(name));
      expect(await c.findByRole('img', { name: `QR code for ${name}` }, { timeout: 3000 })).toBeInTheDocument();
      expect(c.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
      expect(c.getByRole('button', { name: 'Print key' })).toBeInTheDocument();
    }
    expect(within(card('2026-11-05 Dark')).getByRole('link', { name: 'Print sheets' })).toBeInTheDocument();
    expect(within(card('2026-11-05 Light')).queryByRole('link', { name: 'Print sheets' })).toBeNull();
  });

  it('Print sheets is a new-tab link to that flight, and Print key stays enabled', async () => {
    await applyBoth();
    const link = within(card('2026-11-05 Dark')).getByRole('link', { name: 'Print sheets' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/print\/sheets\/11$/));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(link);
    expect(api.getFlight).not.toHaveBeenCalled();
    expect(within(card('2026-11-05 Dark')).getByRole('button', { name: 'Print key' })).toBeEnabled();
    expect(within(card('2026-11-05 Light')).getByRole('button', { name: 'Print key' })).toBeEnabled();
  });

  it('puts each QR on a white box so it scans in dark mode', async () => {
    await applyBoth({}, true);
    const qr = await within(card('2026-11-05 Dark')).findByRole('img', { name: 'QR code for 2026-11-05 Dark' }, { timeout: 3000 });
    expect(qr.parentElement).toHaveStyle({ backgroundColor: 'rgb(255, 255, 255)' });
  });

  it('Copy link copies the flight link', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await applyBoth();
    fireEvent.click(within(card('2026-11-05 Dark')).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/f\/11$/)));
  });

  it('Done closes and reports so recent flights reload', async () => {
    const { onClose, onApplied } = await applyBoth();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape on the ready screen behaves like Done', async () => {
    const { onApplied } = await applyBoth();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it('Escape in the nested key dialog closes only that dialog and leaves the ready screen open', async () => {
    api.getLabelKey.mockResolvedValue({ cups: [{ position: 1, label: 'Cup A', coffee_id: 1, name: 'Guji', roaster: 'Onyx', origin: 'Ethiopia' }] });
    const { onApplied, onClose } = await applyBoth();
    fireEvent.click(within(card('2026-11-05 Light')).getByRole('button', { name: 'Print key' }));
    const key = await screen.findByRole('dialog', { name: /Label key/ }, { timeout: 3000 });
    fireEvent.keyDown(key, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Label key/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Print key opens the key dialog for that flight', async () => {
    api.getLabelKey.mockResolvedValue({ cups: [{ position: 1, label: 'Cup A', coffee_id: 1, name: 'Guji', roaster: 'Onyx', origin: 'Ethiopia' }] });
    await applyBoth();
    fireEvent.click(within(card('2026-11-05 Light')).getByRole('button', { name: 'Print key' }));
    const key = await screen.findByRole('dialog', { name: /Label key/ }, { timeout: 3000 });
    expect(await within(key).findByText('Guji', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(api.getLabelKey).toHaveBeenCalledWith(12);
  });
});

describe('LogTab Upload flights', () => {
  const tab = () => renderAt('/log', <Route path="/log" element={<LogTab />} />);

  it('shows for a manager on a personal account', async () => {
    tab();
    expect(await screen.findByRole('button', { name: 'Upload flights' })).toBeInTheDocument();
  });

  it('hidden for staff', async () => {
    auth.role = 'member';
    tab();
    await screen.findByText('What did you taste?');
    expect(screen.queryByRole('button', { name: 'Upload flights' })).toBeNull();
  });

  it('hidden on the shared device', async () => {
    auth.role = 'device';
    tab();
    await screen.findByText('What did you taste?');
    expect(screen.queryByRole('button', { name: 'Upload flights' })).toBeNull();
  });

  it('picking the same file twice reopens the dialog', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    tab();
    await screen.findByRole('button', { name: 'Upload flights' });
    const input = screen.getByTestId('flight-csv-input');
    fireEvent.change(input, { target: { files: [FILE] } });
    expect(input.value).toBe('');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.change(input, { target: { files: [FILE] } });
    expect(await screen.findByText('Upload flights CSV')).toBeInTheDocument();
  });

  it('Done on the ready screen closes the dialog and reloads recent flights', async () => {
    api.previewFlightImport.mockResolvedValue(PLAN);
    api.importFlights.mockResolvedValue({ flights: [{ id: 11, name: '2026-11-05 Dark', prep: 'cupping', sheet: 'advanced', cup_count: 6, closes_at: '2026-11-07T15:30:00' }] });
    tab();
    await screen.findByRole('button', { name: 'Upload flights' });
    await waitFor(() => expect(api.getRecentFlights).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId('flight-csv-input'), { target: { files: [FILE] } });
    await screen.findByText('2026-11-05 Dark');
    tick();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.getRecentFlights).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  function tick() { fireEvent.click(screen.getByRole('checkbox', { name: /2026-11-05 Dark/ })); }
});
