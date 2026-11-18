/**
 * The Advanced host guide: the taster's timer banner (time and pass only, never scores,
 * names or counts), the host's setup and timer screens, and the label key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useCallback, useReducer } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const { api, auth } = vi.hoisted(() => ({
  api: {
    startTimer: vi.fn(), setPass: vi.fn(), getLabelKey: vi.fn(), getFlight: vi.fn(), getCoffees: vi.fn(),
    logTastings: vi.fn(), getFlightResult: vi.fn(), createFlight: vi.fn(), getMembers: vi.fn(), enterPaperSheet: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import TimerBanner from '../advanced/host/TimerBanner';
import HostSetupScreen from '../advanced/host/HostSetupScreen';
import HostTimerScreen from '../advanced/host/HostTimerScreen';
import LabelKeyCard from '../advanced/host/LabelKeyCard';
import PrintKeyDialog from '../print/PrintKeyDialog';
import ShareFlightScreen from '../log/screens/ShareFlightScreen';
import FlightDialog from '../log/FlightDialog';
import { reducer, initialDraft } from '../log/flightDraft';

const flight = (over = {}) => ({
  id: 9, sheet: 'advanced', is_open: true, adv_pass: null, timer_started_at: null, timer_elapsed_s: null,
  logged_count: 2, roster: [{ name: 'Robin', status: 'logged' }], ...over,
});

describe('TimerBanner', () => {
  it('shows the quiet setup variant before the host starts', () => {
    render(<TimerBanner flight={flight()} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Setting up · smell the dry grounds (fragrance)');
    expect(banner).not.toHaveTextContent(/\d:\d\d/);
  });

  it('shows the clock, steeping phase and hint at 192 s', () => {
    render(<TimerBanner flight={flight({ adv_pass: 0, timer_started_at: 'x', timer_elapsed_s: 192 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('3:12 · Steeping · crust breaks at 5:00');
  });

  it('shows the pass and its temperature once the host taps a pass', () => {
    render(<TimerBanner flight={flight({ adv_pass: 2, timer_started_at: 'x', timer_elapsed_s: 1000 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('16:40 · Comfortable pass · ~131 °F');
  });

  it('renders nothing on a basic flight', () => {
    const { container } = render(<TimerBanner flight={flight({ sheet: 'basic' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a closed flight', () => {
    const { container } = render(<TimerBanner flight={flight({ is_open: false, adv_pass: 1, timer_elapsed_s: 900 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without a flight', () => {
    const { container } = render(<TimerBanner flight={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('carries no score, name or count text', () => {
    render(<TimerBanner flight={flight({ adv_pass: 1, timer_started_at: 'x', timer_elapsed_s: 700 })} />);
    const text = screen.getByRole('status').textContent;
    expect(text).not.toMatch(/Robin|logged|scored|of \d|\/ ?100/i);
  });

  it('is plain text, not a button, without onOpenTimer', () => {
    render(<TimerBanner flight={flight()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('becomes an "Open the timer" button when the caller may run it', () => {
    const onOpenTimer = vi.fn();
    render(<TimerBanner flight={flight({ adv_pass: 0, timer_elapsed_s: 10 })} onOpenTimer={onOpenTimer} />);
    fireEvent.click(screen.getByRole('button', { name: /^Open the timer/ }));
    expect(onOpenTimer).toHaveBeenCalledTimes(1);
  });
});

describe('TimerBanner as a button', () => {
  it('keeps its visible text in the accessible name', () => {
    render(<TimerBanner flight={flight({ adv_pass: 0, timer_elapsed_s: 10 })} onOpenTimer={() => {}} />);
    const name = screen.getByRole('button').textContent;
    expect(name).toMatch(/^Open the timer:/);
    expect(name).toContain('Steeping');
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-label');
  });
});

const CUPS = Array.from({ length: 8 }, (_, i) => ({ position: i + 1, label: `Cup ${String.fromCharCode(65 + i)}`, blind: true, coffee_id: null }));
const hostFlight = (over = {}) => ({
  id: 9, name: 'Fall importer samples', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: true, is_host: true,
  is_open: true, created_via: 'account', roster: [], logged_count: 3, adv_pass: null, timer_started_at: null, timer_elapsed_s: null,
  cups: CUPS, ...over,
});
const KEY = { cups: [
  { position: 1, label: 'Cup A', name: 'Santa Ana Bourbon', origin: 'El Salvador', roaster: 'Onyx' },
  { position: 2, label: 'Cup B', name: 'Kiambu AA', origin: 'Kenya', roaster: 'Onyx' },
] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
  api.getFlight.mockResolvedValue(hostFlight());
  auth.role = 'member';
});

describe('HostSetupScreen paper entry', () => {
  const setup = (f = hostFlight({ sheet: 'advanced', adv_step: 0.5, is_blind: false, cups: CUPS })) => render(<HostSetupScreen flight={f} onBack={() => {}} onOpenTimer={() => {}} />);
  it('shows for a member who hosts the cupping (the server allows the host)', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Enter a paper sheet' })).toBeInTheDocument();
  });
  it('is hidden for a member who is not the host', () => {
    setup(hostFlight({ sheet: 'advanced', adv_step: 0.5, is_blind: false, cups: CUPS, is_host: false }));
    expect(screen.queryByRole('button', { name: 'Enter a paper sheet' })).toBeNull();
  });
  it('opens the dialog for an editor and a save shows a snackbar', async () => {
    auth.role = 'editor';
    api.getMembers.mockResolvedValue([]);
    api.enterPaperSheet.mockResolvedValue({ taster_key: 'paper:guest:sam', taster_name: 'Sam', count: 1 });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Enter a paper sheet' }));
    fireEvent.change(await screen.findByLabelText('Someone else (guest)'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
    ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance']
      .forEach((c) => fireEvent.keyDown(screen.getByTestId(`advanced-slider-${c}`), { key: 'ArrowRight' }));
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: /^All 8/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    expect(await screen.findByText("Saved Sam's sheet")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Paper sheet · Sam' })).toBeNull();
  });
});

describe('HostSetupScreen', () => {
  const setup = (f = hostFlight(), props = {}) => render(<HostSetupScreen flight={f} onBack={() => {}} onOpenTimer={() => {}} {...props} />);

  it('disables Open the timer and says so once the cupping is closed', () => {
    setup(hostFlight({ is_open: false }));
    expect(screen.getByRole('button', { name: 'Open the timer' })).toBeDisabled();
    expect(screen.getByText('This cupping is closed.')).toBeInTheDocument();
  });

  it('says nothing about closing while the cupping is open', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Open the timer' })).toBeEnabled();
    expect(screen.queryByText('This cupping is closed.')).toBeNull();
  });

  it('shows the flight name and the meta line with the logged count', () => {
    setup();
    expect(screen.getByText('Fall importer samples')).toBeInTheDocument();
    expect(screen.getByText('8 coffees · blind · 3 logged')).toBeInTheDocument();
    expect(screen.queryByText(/have the link/)).toBeNull();
  });

  it('shows 9.9 g at 180 ml and 237.6 g for 3 bowls of 8 coffees', () => {
    setup();
    expect(screen.getByText('9.9 g')).toBeInTheDocument();
    expect(screen.getByText('237.6 g')).toBeInTheDocument();
  });

  it('recomputes from a preset pill and the bowls stepper', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '200' }));
    expect(screen.getByText('11 g')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More bowls' }));
    expect(screen.getByText(/4 bowls/)).toBeInTheDocument();
  });

  it('lists the six checklist rows and the nothing-saved caption', () => {
    setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getByText('Purge the grinder with each sample before you grind it')).toBeInTheDocument();
    expect(screen.getByText('Ticks stay on this screen only — nothing is saved.')).toBeInTheDocument();
  });

  it('resets the ticks after leaving and coming back', () => {
    const { unmount } = setup();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    unmount();
    setup();
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  });

  it('opens the timer from the footer', () => {
    const onOpenTimer = vi.fn();
    setup(hostFlight(), { onOpenTimer });
    expect(screen.getByText('Fragrance comes first — smell the dry grounds before you pour.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the timer' }));
    expect(onOpenTimer).toHaveBeenCalledTimes(1);
  });

  it('offers the label key to the account host of a blind flight', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Label key…' })).toBeInTheDocument();
  });

  it.each([
    ['a non-host editor', () => { auth.role = 'editor'; return hostFlight({ is_host: false }); }],
    ['a device-created flight', () => hostFlight({ created_via: 'device' })],
    ['a shared device', () => { auth.role = 'device'; return hostFlight(); }],
    ['a sighted flight', () => hostFlight({ is_blind: false })],
  ])('hides the label key for %s', (_, make) => {
    setup(make());
    expect(screen.queryByRole('button', { name: 'Label key…' })).toBeNull();
  });
});

describe('LabelKeyCard', () => {
  it('shows the warning, reveals names per tap, and forgets them on Hide', async () => {
    api.getLabelKey.mockResolvedValue(KEY);
    render(<LabelKeyCard flightId={9} />);
    expect(screen.getByText("You'll know the cups — your scores still count.")).toBeInTheDocument();
    expect(screen.queryByText('Kiambu AA')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    expect(await screen.findByText('Santa Ana Bourbon')).toBeInTheDocument();
    expect(screen.getByText('El Salvador · Onyx')).toBeInTheDocument();
    expect(api.getLabelKey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Santa Ana Bourbon')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    await screen.findByText('Santa Ana Bourbon');
    expect(api.getLabelKey).toHaveBeenCalledTimes(2);
  });

  it('names no letters in its intro', () => {
    render(<LabelKeyCard flightId={9} />);
    expect(screen.getByText(/Everyone sees only the cup labels — never a name — until you close/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Cup A');
  });

  it('shows the server message when the key is refused', async () => {
    api.getLabelKey.mockRejectedValue({ response: { status: 403, data: { error: 'Only the host can see the label key' } } });
    render(<LabelKeyCard flightId={9} />);
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    expect(await screen.findByText('Only the host can see the label key')).toBeInTheDocument();
  });

  it('offers Print key once the key is shown, and not before', async () => {
    api.getLabelKey.mockResolvedValue(KEY);
    render(<LabelKeyCard flightId={9} flightName="Dark roasts" />);
    expect(screen.queryByRole('button', { name: 'Print key' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Label key…' }));
    await screen.findByText('Santa Ana Bourbon');
    fireEvent.click(screen.getByRole('button', { name: 'Print key' }));
    // The print dialog asks the server for itself: a second fetch, not a copy of the card's state.
    await waitFor(() => expect(api.getLabelKey).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('dialog', { name: /Label key/ })).toBeInTheDocument();
  });
});

describe('PrintKeyDialog', () => {
  const CUPS = [
    { position: 2, label: 'Cup B', coffee_id: 5, name: 'Kiambu AA', roaster: 'Onyx', origin: 'Kenya' },
    { position: 1, label: 'Cup A', coffee_id: 4, name: 'Santa Ana Bourbon', roaster: 'Ridge Roasters', origin: 'El Salvador' },
  ];
  const dialog = () => screen.getByRole('dialog', { name: /Label key/ });

  it('fetches on open and shows label, coffee, roaster and origin in pour order under a host-only heading', async () => {
    api.getLabelKey.mockResolvedValue({ cups: CUPS });
    render(<PrintKeyDialog open flightId={9} flightName="Dark roasts" onClose={() => {}} />);
    expect(api.getLabelKey).toHaveBeenCalledWith(9);
    await within(dialog()).findByText('Santa Ana Bourbon');
    expect(within(dialog()).getByText(/host only/i)).toBeInTheDocument();
    expect(within(dialog()).getByText('Dark roasts')).toBeInTheDocument();
    const rows = within(dialog()).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toContain('Cup A');
    expect(rows[0]).toContain('Santa Ana Bourbon');
    expect(rows[0]).toContain('Ridge Roasters');
    expect(rows[0]).toContain('El Salvador');
    expect(rows[1]).toContain('Cup B');
    expect(within(dialog()).getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('prints from a body-level print root that holds the key', async () => {
    api.getLabelKey.mockResolvedValue({ cups: CUPS });
    render(<PrintKeyDialog open flightId={9} flightName="Dark roasts" onClose={() => {}} />);
    await within(dialog()).findByText('Santa Ana Bourbon');
    const root = document.querySelector('.key-print-root');
    expect(root.parentElement).toBe(document.body);
    expect(root.textContent).toContain('Santa Ana Bourbon');
    expect(root.textContent).toMatch(/host only/i);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('prints in fixed ink on white even under a dark theme', async () => {
    api.getLabelKey.mockResolvedValue({ cups: CUPS });
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <PrintKeyDialog open flightId={9} flightName="Dark roasts" onClose={() => {}} />
      </ThemeProvider>,
    );
    await within(dialog()).findByText('Santa Ana Bourbon');
    const root = document.querySelector('.key-print-root');
    expect(root).toHaveStyle({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)' });
    expect(within(root).getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(/host only/i);
    const origin = within(root).getByText('Ridge Roasters · El Salvador');
    expect(origin).toHaveStyle({ color: 'rgb(66, 66, 66)' });
  });

  it('shows the refusal and no Print button on a 403', async () => {
    api.getLabelKey.mockRejectedValue({ response: { status: 403, data: { error: 'Only the host can see the label key' } } });
    render(<PrintKeyDialog open flightId={9} flightName="Dark roasts" onClose={() => {}} />);
    expect(await within(dialog()).findByText('Only the host can see the label key')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    expect(document.querySelector('.key-print-root')).toBeNull();
  });

  it('asks the server fresh on every open and keeps nothing in storage', async () => {
    api.getLabelKey.mockResolvedValue({ cups: CUPS });
    localStorage.clear();
    sessionStorage.clear();
    const { rerender } = render(<PrintKeyDialog open flightId={9} flightName="F" onClose={() => {}} />);
    await within(dialog()).findByText('Santa Ana Bourbon');
    rerender(<PrintKeyDialog open={false} flightId={9} flightName="F" onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Santa Ana Bourbon')).toBeNull());
    expect(document.body.textContent).not.toContain('Santa Ana Bourbon');
    rerender(<PrintKeyDialog open flightId={9} flightName="F" onClose={() => {}} />);
    await within(dialog()).findByText('Santa Ana Bourbon');
    expect(api.getLabelKey).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('HostTimerScreen', () => {
  const started = (over = {}) => hostFlight({ adv_pass: 0, timer_started_at: 'x', timer_elapsed_s: 760, ...over });
  const mount = (f, dispatch = vi.fn(), props = {}) => {
    render(<HostTimerScreen flight={f} dispatch={dispatch} onMySheet={() => {}} {...props} />);
    return dispatch;
  };

  it('offers Start before the timer runs, and Start calls startTimer', async () => {
    const f = started({ adv_pass: null, timer_started_at: null, timer_elapsed_s: null });
    api.startTimer.mockResolvedValue(started({ timer_elapsed_s: 0 }));
    const dispatch = mount(f);
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    fireEvent.click(screen.getByRole('button', { name: 'Start timer — pour now' }));
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledTimes(1));
    expect(api.startTimer.mock.calls[0][0]).toBe(9);
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'flightUpdated', flight: expect.objectContaining({ adv_pass: 0 }) }));
  });

  it('shows the clock, phase and the step timeline once started', () => {
    mount(started());
    expect(screen.getByRole('timer')).toHaveTextContent('12:40');
    expect(screen.getByRole('timer')).toHaveTextContent('Hot pass next');
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('Break the crust + sniff')).toBeInTheDocument();
    expect(screen.getByText('Warm pass · ~113 °F')).toBeInTheDocument();
  });

  it('Next pass at adv_pass 1 sends setPass(id, 2) once, even on a second tap', async () => {
    let resolve;
    api.setPass.mockReturnValue(new Promise((r) => { resolve = r; }));
    mount(started({ adv_pass: 1 }));
    const next = screen.getByRole('button', { name: 'Next pass: Comfortable pass · ~131 °F' });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(api.setPass).toHaveBeenCalledTimes(1);
    expect(api.setPass.mock.calls[0].slice(0, 2)).toEqual([9, 2]);
    expect(next).toBeDisabled();
    resolve(started({ adv_pass: 2 }));
    await waitFor(() => expect(next).not.toBeDisabled());
  });

  it('disables Start, Next pass and Restart once the cupping is closed', () => {
    mount(started({ adv_pass: 1, is_open: false }));
    expect(screen.getByText('This cupping is closed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next pass/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeDisabled();
  });

  it('disables Start on a closed cupping that never started', () => {
    mount(started({ adv_pass: null, timer_started_at: null, timer_elapsed_s: null, is_open: false }));
    expect(screen.getByRole('button', { name: 'Start timer — pour now' })).toBeDisabled();
    expect(screen.getByText('This cupping is closed.')).toBeInTheDocument();
  });

  it('hides Next pass at pass 3 and says it is the last', () => {
    mount(started({ adv_pass: 3 }));
    expect(screen.queryByRole('button', { name: /Next pass/ })).toBeNull();
    expect(screen.getByTestId('last-pass')).toHaveTextContent('Last pass — finish your scores.');
  });

  it('Restart cancelled sends nothing; confirmed calls startTimer', async () => {
    api.startTimer.mockResolvedValue(started({ timer_elapsed_s: 0 }));
    mount(started());
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(screen.getByText('Restart from 0:00? The pass goes back to the start.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.startTimer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledTimes(1));
  });

  it('My sheet returns to the entry screen', () => {
    const onMySheet = vi.fn();
    mount(started(), vi.fn(), { onMySheet });
    fireEvent.click(screen.getByRole('button', { name: 'My sheet' }));
    expect(onMySheet).toHaveBeenCalledTimes(1);
  });

  it('shows the server message on a 409 and refetches the flight', async () => {
    // The real _state_error shape: a code under `error`, the human line under `message`.
    api.setPass.mockRejectedValue({ response: { status: 409, data: { error: 'flight_closed', message: 'This flight is already closed' } } });
    api.getFlight.mockResolvedValue(started({ adv_pass: 1, is_open: false }));
    const dispatch = mount(started({ adv_pass: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /Next pass/ }));
    expect(await screen.findByText('This flight is already closed')).toBeInTheDocument();
    expect(screen.queryByText('flight_closed')).toBeNull();
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'flightUpdated', flight: expect.objectContaining({ is_open: false }) }));
    expect(api.getFlight).toHaveBeenCalledWith(9, expect.anything());
  });
});

describe('routing through FlightDialog', () => {
  function Harness({ flight, screenName = 'entry', flightId = 9 }) {
    const [draft, rawDispatch] = useReducer(reducer, null,
      () => ({ ...reducer(initialDraft(), { type: 'seedFromFlight', flight }), screen: screenName, flightId }));
    const dispatch = useCallback((a) => rawDispatch(a), []);
    return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
  }
  const open = () => screen.getByRole('button', { name: /^Open the timer/ });

  it('a host opens setup from the banner before the timer starts', async () => {
    render(<Harness flight={hostFlight()} />);
    fireEvent.click(open());
    expect(await screen.findByText('Ticks stay on this screen only — nothing is saved.')).toBeInTheDocument();
  });

  it('a host opens the timer from the banner once it has started', async () => {
    render(<Harness flight={hostFlight({ adv_pass: 0, timer_started_at: 'x', timer_elapsed_s: 30 })} />);
    fireEvent.click(open());
    expect(await screen.findByRole('timer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'My sheet' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('a staff non-host has no way into setup or the timer', () => {
    render(<Harness flight={hostFlight({ is_host: false })} />);
    expect(screen.queryByRole('button', { name: /^Open the timer/ })).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('an editor non-host gets the timer but not the key', async () => {
    auth.role = 'editor';
    render(<Harness flight={hostFlight({ is_host: false })} />);
    fireEvent.click(open());
    await screen.findByText('Ticks stay on this screen only — nothing is saved.');
    expect(screen.queryByRole('button', { name: 'Label key…' })).toBeNull();
  });

  it('on the store device the shared device-named host gets the timer and no key', async () => {
    auth.role = 'device';
    render(<Harness flight={hostFlight({ created_via: 'device' })} />);
    fireEvent.click(open());
    await screen.findByText('Ticks stay on this screen only — nothing is saved.');
    expect(screen.queryByRole('button', { name: 'Label key…' })).toBeNull();
  });

  it('the share screen offers "Set up the table" to a host of a Advanced flight only', async () => {
    const { unmount } = render(<Harness flight={hostFlight()} screenName="share" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up the table' }));
    expect(await screen.findByText('Ticks stay on this screen only — nothing is saved.')).toBeInTheDocument();
    unmount();
    render(<Harness flight={hostFlight({ is_host: false })} screenName="share" />);
    await screen.findByText('Share this flight');
    expect(screen.queryByRole('button', { name: 'Set up the table' })).toBeNull();
  });
});

describe('ShareFlightScreen label key', () => {
  const basic = (over = {}) => hostFlight({ sheet: 'basic', is_blind: true, is_host: true, created_via: 'app', roster: [], cups: [], ...over });
  const setup = (f) => render(<ShareFlightScreen draft={{ ...initialDraft(), flightId: f?.id ?? null, flight: f ?? null, flightName: '', blind: true }} dispatch={() => {}} onBack={() => {}} />);
  const key = () => screen.queryByRole('button', { name: 'Label key…' });

  it('shows the label key to the host of a blind basic flight', () => {
    setup(basic());
    expect(key()).toBeInTheDocument();
  });
  it.each([
    ['a non-host', () => basic({ is_host: false })],
    ['a non-blind flight', () => basic({ is_blind: false })],
    ['a device-created flight', () => basic({ created_via: 'device' })],
    ['the shared device', () => { auth.role = 'device'; return basic(); }],
    ['a Advanced flight', () => basic({ sheet: 'advanced' })],
  ])('hides it on %s', (_, make) => {
    setup(make());
    expect(key()).toBeNull();
  });
  it('puts the QR on a white box so it scans in dark mode', () => {
    const f = basic();
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <ShareFlightScreen draft={{ ...initialDraft(), flightId: f.id, flight: f, flightName: '', blind: true }} dispatch={() => {}} onBack={() => {}} />
      </ThemeProvider>,
    );
    const svg = document.querySelector('svg[width="96"]');
    expect(svg.parentElement).toHaveStyle({ backgroundColor: 'rgb(255, 255, 255)' });
  });
  it('hides it before the flight exists', () => {
    setup(null);
    expect(key()).toBeNull();
  });
});
