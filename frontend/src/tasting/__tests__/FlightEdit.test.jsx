/**
 * Editing a blind flight before anyone has tasted: the button's lock, the dialog's
 * rename / add / reorder / remove, and the host's draft after a save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useCallback, useReducer } from 'react';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getLabelKey: vi.fn(), putFlightCups: vi.fn(), getCoffees: vi.fn(), getFlight: vi.fn(),
    matchCoffee: vi.fn(), createCoffee: vi.fn(), getMembers: vi.fn(),
  },
  auth: { role: 'editor' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import LabelKeyCard from '../advanced/host/LabelKeyCard';
import FlightEditDialog from '../advanced/host/FlightEditDialog';
import { flightEditLock } from '../advanced/host/flightEditLock';
import FlightDialog from '../log/FlightDialog';
import { reducer, initialDraft } from '../log/flightDraft';

const cup = (position, label, coffee_id, name) => ({ position, label, coffee_id, name, roaster: 'Onyx', origin: 'Kenya' });
const KEY = { cups: [cup(1, 'Cup A', 11, 'Kiambu'), cup(2, 'Cup B', 12, 'Guji'), cup(3, 'Cup C', 13, 'Huila')] };
const CUSTOM_KEY = { cups: [cup(1, 'Cup H1', 11, 'Kiambu'), cup(2, 'Cup H2', 12, 'Guji')] };
const LIST = { coffees: [{ id: 11, name: 'Kiambu' }, { id: 12, name: 'Guji' }, { id: 13, name: 'Huila' }, { id: 14, name: 'Sidama', roaster: 'Onyx' }], roasters: [] };

const flight = (over = {}) => ({
  id: 9, name: 'Dark roasts', sheet: 'advanced', is_open: true, is_blind: true, is_host: true, is_shared: true, prep: 'cupping',
  created_via: 'account', adv_pass: null, timer_started_at: null, timer_elapsed_s: null, logged_count: 0,
  roster: [], cups: [{ position: 1, label: 'Cup A', blind: true, blind_label: 'A' }], ...over,
});

const renderDialog = (props = {}) => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<FlightEditDialog open flight={flight()} onSaved={onSaved} onClose={onClose} {...props} />);
  return { onSaved, onClose };
};
const rowNames = () => screen.getAllByTestId('edit-row').map((r) => within(r).getByTestId('edit-name').value ?? within(r).getByTestId('edit-name').textContent);
const rowLabels = () => screen.getAllByTestId('edit-row').map((r) => within(r).getByTestId('edit-label').textContent);
const sentCups = () => api.putFlightCups.mock.calls[0][1].cups;
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getLabelKey.mockResolvedValue(KEY);
  api.getCoffees.mockResolvedValue(LIST);
  api.putFlightCups.mockResolvedValue(KEY);
  api.matchCoffee.mockResolvedValue({ match: null });
  auth.role = 'editor';
});

describe('flightEditLock', () => {
  it('is open on a fresh flight', () => expect(flightEditLock(flight())).toBeNull());
  it('locks on a logged read', () => expect(flightEditLock(flight({ logged_count: 1 }))).toMatch(/logged/));
  it('locks on a started timer', () => expect(flightEditLock(flight({ timer_started_at: 'x' }))).toMatch(/timer/));
  it('locks on a closed flight', () => expect(flightEditLock(flight({ is_open: false }))).toMatch(/closed/));
});

describe('the button on the Blind cups card', () => {
  const button = () => screen.getByRole('button', { name: 'Edit flight…' });

  it('is enabled on a fresh flight and opens the dialog with the warning and names', async () => {
    render(<LabelKeyCard flightId={9} flight={flight()} />);
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Edit flight' });
    expect(within(dialog).getByText("You'll know the cups — your scores still count.")).toBeInTheDocument();
    expect(within(dialog).getByText("If anyone has started scoring, don't change this flight.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Saving clears/)).toBeNull();
    await within(dialog).findByDisplayValue('Kiambu');
  });

  it.each([
    [{ logged_count: 1 }, /logged/],
    [{ timer_started_at: 'x' }, /timer/],
    [{ is_open: false }, /closed/],
  ])('is disabled with a reason for %j', (over, reason) => {
    render(<LabelKeyCard flightId={9} flight={flight(over)} />);
    expect(button()).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('clears a showing key and tells the screen after a save', async () => {
    const onFlightEdited = vi.fn();
    render(<LabelKeyCard flightId={9} flight={flight()} onFlightEdited={onFlightEdited} />);
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    await screen.findByRole('button', { name: 'Hide' });
    fireEvent.click(button());
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    await waitFor(() => expect(onFlightEdited).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Label key…' })).toBeInTheDocument();
  });
});

describe('closing the dialog', () => {
  it('holds still while a save is on its way, so Cancel never looks like it undid one', async () => {
    let finish;
    api.putFlightCups.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onClose } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    finish(KEY);
    await screen.findByRole('button', { name: 'Done' });
  });

  it('ignores a stray tap outside, which would throw away every edit', async () => {
    const { onClose } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(document.querySelector('.MuiBackdrop-root'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Kiambu')).toBeInTheDocument();
  });

  it('still closes on Escape when nothing is saving', async () => {
    const { onClose } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a full flight', () => {
  const fullKey = (n) => ({ cups: Array.from({ length: n }, (_, i) => cup(i + 1, `Cup ${String.fromCharCode(65 + i)}`, 100 + i, `Coffee ${i}`)) });

  it('offers no way to add a 27th cup', async () => {
    api.getLabelKey.mockResolvedValue(fullKey(26));
    renderDialog();
    await screen.findByDisplayValue('Coffee 25');
    expect(screen.queryByRole('combobox', { name: 'Add a coffee' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Something else…' })).toBeNull();
    expect(screen.getByText('A flight holds 26 cups at most.')).toBeInTheDocument();
  });

  it('offers it again once a cup comes out', async () => {
    api.getLabelKey.mockResolvedValue(fullKey(26));
    renderDialog();
    await screen.findByDisplayValue('Coffee 25');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Coffee 25' }));
    expect(await screen.findByRole('combobox', { name: 'Add a coffee' })).toBeInTheDocument();
  });
});

describe('the card after a rename alone', () => {
  it('clears the key but leaves my scores alone', async () => {
    const onFlightEdited = vi.fn();
    render(<LabelKeyCard flightId={9} flight={flight()} onFlightEdited={onFlightEdited} />);
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    await screen.findByRole('button', { name: 'Hide' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit flight…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit flight' });
    fireEvent.change(await within(dialog).findByDisplayValue('Guji'), { target: { value: 'Guji Natural' } });
    save();
    expect(await screen.findByText(/Reprint the label key/)).toBeInTheDocument();
    expect(onFlightEdited).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  });
});

describe('FlightEditDialog', () => {
  it('moves coffees while the slot labels stay put, and sends the new order', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    expect(rowLabels()).toEqual(['Cup A', 'Cup B', 'Cup C']);
    expect(rowNames()).toEqual(['Guji', 'Kiambu', 'Huila']);
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(sentCups()).toEqual([{ coffee_id: 12 }, { coffee_id: 11 }, { coffee_id: 13 }]);
  });

  it('cannot move the first cup up or the last cup down', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    expect(screen.getByRole('button', { name: 'Move Kiambu up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Huila down' })).toBeDisabled();
  });

  it('warns that saving clears my scores only once the cups have moved', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    expect(screen.queryByText("Saving clears any scores you've started on this device.")).toBeNull();
    fireEvent.change(screen.getByDisplayValue('Guji'), { target: { value: 'Guji Natural' } });
    expect(screen.queryByText("Saving clears any scores you've started on this device.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    expect(screen.getByText("Saving clears any scores you've started on this device.")).toBeInTheDocument();
  });

  it('closes without a request when nothing changed', async () => {
    const { onClose, onSaved } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.putFlightCups).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('tells the screen a rename alone moved no cups', async () => {
    const { onSaved } = renderDialog();
    fireEvent.change(await screen.findByDisplayValue('Guji'), { target: { value: 'Guji Natural' } });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ cupsMoved: false }));
  });

  it('says so when the screen could not refresh after a save', async () => {
    const onSaved = vi.fn().mockRejectedValue(new Error('offline'));
    renderDialog({ onSaved });
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    expect(await screen.findByText(/Close and reopen this flight before scoring/)).toBeInTheDocument();
  });

  it('makes a coffee from "Something else" a cupping lot, not a house coffee', async () => {
    api.createCoffee.mockResolvedValue({ id: 50, name: 'Fresh lot' });
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Something else…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Coffee name' }), { target: { value: 'Fresh lot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to flight' }));
    await screen.findByText('Fresh lot');
    expect(api.createCoffee.mock.calls[0][0].kind).toBe('cupping_lot');
  });

  it('shows two coffees of the same name and roaster as separate options', async () => {
    api.getCoffees.mockResolvedValue({ coffees: [{ id: 20, name: 'Twin', roaster: 'Onyx' }, { id: 21, name: 'Twin', roaster: 'Onyx' }], roasters: [] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add a coffee' }));
    expect(await screen.findAllByRole('option')).toHaveLength(2);
    expect(consoleError.mock.calls.filter((c) => String(c[0]).includes('same key'))).toEqual([]);
    consoleError.mockRestore();
  });

  it('removes a row, which the last label drops off, and the save leaves it out', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    expect(rowLabels()).toEqual(['Cup A', 'Cup B']);
    expect(rowNames()).toEqual(['Kiambu', 'Huila']);
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(sentCups()).toEqual([{ coffee_id: 11 }, { coffee_id: 13 }]);
  });

  it('disables Remove on the last remaining cup', async () => {
    api.getLabelKey.mockResolvedValue({ cups: [KEY.cups[0]] });
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    expect(screen.getByRole('button', { name: 'Remove Kiambu' })).toBeDisabled();
  });

  it('Cancel sends nothing', async () => {
    const { onClose, onSaved } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.putFlightCups).not.toHaveBeenCalled();
  });

  it('sends a changed name and leaves unchanged ones out', async () => {
    renderDialog();
    fireEvent.change(await screen.findByDisplayValue('Guji'), { target: { value: 'Guji Natural' } });
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(sentCups()).toEqual([{ coffee_id: 11 }, { coffee_id: 12, name: 'Guji Natural' }, { coffee_id: 13 }]);
  });

  it('blocks Save on a blank name', async () => {
    renderDialog();
    fireEvent.change(await screen.findByDisplayValue('Guji'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows names read-only to a host who cannot rename', async () => {
    auth.role = 'member';
    renderDialog();
    await screen.findByText('Kiambu');
    expect(screen.queryByDisplayValue('Kiambu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(sentCups().every((c) => !('name' in c))).toBe(true);
  });

  const addSidama = async () => {
    const input = await screen.findByRole('combobox', { name: 'Add a coffee' });
    fireEvent.mouseDown(input);
    fireEvent.click(await screen.findByRole('option', { name: /Sidama/ }));
  };

  it('offers every active coffee not already in the flight, with no store filter', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add a coffee' }));
    const options = await screen.findAllByRole('option');
    expect(options.some((o) => /Sidama/.test(o.textContent))).toBe(true);
    expect(options.some((o) => /Kiambu/.test(o.textContent))).toBe(false);
    expect(api.getCoffees).toHaveBeenCalledWith();
  });

  it('gives an added coffee the next letter on a lettered flight, with no label field', async () => {
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    await addSidama();
    expect(rowLabels()).toEqual(['Cup A', 'Cup B', 'Cup C', 'Cup D']);
    expect(screen.queryByRole('textbox', { name: /Label for/ })).toBeNull();
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(sentCups()[3]).toEqual({ coffee_id: 14 });
    expect(api.putFlightCups.mock.calls[0][1].newLabels).toEqual([]);
  });

  it('asks for a label per extra slot on a custom-labelled flight', async () => {
    api.getLabelKey.mockResolvedValue(CUSTOM_KEY);
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    await addSidama();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label for cup 3' }), { target: { value: 'H3' } });
    save();
    await waitFor(() => expect(api.putFlightCups).toHaveBeenCalled());
    expect(api.putFlightCups.mock.calls[0][1].newLabels).toEqual(['H3']);
  });

  it('forgets a typed label once its slot goes away', async () => {
    api.getLabelKey.mockResolvedValue(CUSTOM_KEY);
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    await addSidama();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label for cup 3' }), { target: { value: 'H3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    expect(screen.queryByRole('textbox', { name: /Label for/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Add a coffee' }));
    fireEvent.click(await screen.findByRole('option', { name: /Guji/ }));
    expect(screen.getByRole('textbox', { name: 'Label for cup 3' })).toHaveValue('');
  });

  it('needs no new label when a custom-labelled flight swaps one coffee for another', async () => {
    api.getLabelKey.mockResolvedValue(CUSTOM_KEY);
    renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    await addSidama();
    expect(screen.queryByRole('textbox', { name: /Label for/ })).toBeNull();
    expect(rowLabels()).toEqual(['Cup H1', 'Cup H2']);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('reminds the host to reprint when the cup count changed', async () => {
    const { onSaved, onClose } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    save();
    expect(await screen.findByText(/Reprint any sheets or label key/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('reminds the host about a printed key after a reorder, and not about sheets', async () => {
    const { onClose } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    expect(await screen.findByText(/Reprint the label key/)).toBeInTheDocument();
    expect(screen.queryByText(/sheets/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server message on flight_locked and stops editing', async () => {
    api.putFlightCups.mockRejectedValue({ response: { status: 409, data: { error: 'flight_locked', message: 'Someone has already logged a read.' } } });
    const { onSaved } = renderDialog();
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Move Kiambu down' }));
    save();
    expect(await screen.findByText('Someone has already logged a read.')).toBeInTheDocument();
    expect(screen.queryByText('flight_locked')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Guji' })).toBeDisabled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the edits and shows the reason on a validation error', async () => {
    api.putFlightCups.mockRejectedValue({ response: { status: 400, data: { error: 'another coffee is already called Guji' } } });
    renderDialog();
    fireEvent.change(await screen.findByDisplayValue('Kiambu'), { target: { value: 'Guji' } });
    save();
    expect(await screen.findByText('another coffee is already called Guji')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it("shows the server's message when the key is refused", async () => {
    api.getLabelKey.mockRejectedValue({ response: { status: 403, data: { error: 'Only the host can see the label key' } } });
    renderDialog();
    expect(await screen.findByText('Only the host can see the label key')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('the flightEdited draft action', () => {
  const edited = flight({ cups: [
    { position: 1, label: 'Cup A', blind: true, blind_label: 'A' },
    { position: 2, label: 'Cup B', blind: true, blind_label: 'B' },
  ] });
  const start = () => ({
    ...reducer(initialDraft(), { type: 'seedFromFlight', flight: flight() }),
    screen: 'hostSetup', who: { id: 5, name: 'Sam' }, cur: 1,
    entries: { 'pos:1': { vals: { overall: 4 } } },
  });

  it('replaces the cups and clears my scores, which were tied to the old slots', () => {
    const d = reducer(start(), { type: 'flightEdited', flight: edited });
    expect(d.picked.map((c) => c.id)).toEqual(['pos:1', 'pos:2']);
    expect(d.entries).toEqual({});
    expect(d.cur).toBe(0);
    expect(d.flight).toBe(edited);
  });

  it('keeps the screen, who I am', () => {
    const d = reducer(start(), { type: 'flightEdited', flight: edited });
    expect(d.screen).toBe('hostSetup');
    expect(d.who).toEqual({ id: 5, name: 'Sam' });
  });
});

describe('through FlightDialog', () => {
  function Harness() {
    const [draft, rawDispatch] = useReducer(reducer, null, () => ({
      ...reducer(initialDraft(), { type: 'seedFromFlight', flight: flight() }), screen: 'hostSetup', flightId: 9,
    }));
    const dispatch = useCallback((a) => rawDispatch(a), []);
    return (
      <>
        <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />
        <div data-testid="picked">{draft.picked.length}</div>
      </>
    );
  }

  it('re-reads the flight after a save, stays on setup, and the dialog keeps its reminder', async () => {
    api.getFlight.mockResolvedValue(flight({ cups: [
      { position: 1, label: 'Cup A', blind: true, blind_label: 'A' },
      { position: 2, label: 'Cup B', blind: true, blind_label: 'B' },
    ] }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit flight…' }));
    await screen.findByDisplayValue('Kiambu');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Guji' }));
    save();
    await waitFor(() => expect(screen.getByTestId('picked')).toHaveTextContent('2'));
    expect(api.getFlight).toHaveBeenCalledWith(9, expect.anything());
    expect(screen.getByText('Set up the table')).toBeInTheDocument();
    expect(await screen.findByText(/reprint/i)).toBeInTheDocument();
  });
});
