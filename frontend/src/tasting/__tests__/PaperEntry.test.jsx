/** Paper entry: typing a printed Advanced cupping sheet back in as someone else's read. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useReducer } from 'react';

const { api } = vi.hoisted(() => ({
  api: { enterPaperSheet: vi.fn(), getMembers: vi.fn(), logTastings: vi.fn() },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));

import PaperEntryDialog from '../paper/PaperEntryDialog';
import { mayEnterPaper } from '../paper/mayEnterPaper';
import PaperTasterScreen from '../paper/PaperTasterScreen';
import AdvancedEntryScreen from '../advanced/AdvancedEntryScreen';
import { reducer, initialDraft } from '../log/flightDraft';

const FLIGHT = {
  id: 9, name: 'Thursday cupping', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: false, is_host: true, is_open: true,
  roster: [], logged_count: 0,
  cups: [1, 2].map((p) => ({ position: p, label: `Cup ${String.fromCharCode(64 + p)}`, blind: false, coffee_id: p, name: `Coffee ${p}`, roaster: 'Maple Roasters' })),
};
const MEMBERS = [{ id: 5, name: 'Pat Lee', first_name: 'Pat' }, { id: 6, name: 'Ana Ruiz', first_name: 'Ana' }];
const ALL = ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance'];
const score = (cat, v) => fireEvent.keyDown(screen.getByTestId(`advanced-slider-${cat}`), { key: v });
const scoreAll = (cats) => cats.forEach((c) => score(c, 'ArrowRight'));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getMembers.mockResolvedValue(MEMBERS);
  api.enterPaperSheet.mockResolvedValue({ taster_key: 'paper:guest:sam', taster_name: 'Sam', count: 1 });
});

describe('mayEnterPaper', () => {
  const advanced = { sheet: 'advanced', is_host: false };
  it.each([
    ['non-host manager', advanced, { canManage: true, isSharedDevice: false }, true],
    ['host on the shared device', { ...advanced, is_host: true }, { canManage: false, isSharedDevice: true }, true],
    ['non-host shared device', advanced, { canManage: false, isSharedDevice: true }, false],
    ['member host', { ...advanced, is_host: true }, { canManage: false, isSharedDevice: false }, true],
    ['non-host member', advanced, { canManage: false, isSharedDevice: false }, false],
    ['basic flight', { sheet: 'basic', is_host: true }, { canManage: true, isSharedDevice: true }, false],
  ])('%s -> %s', (_n, flight, who, expected) => {
    expect(mayEnterPaper(flight, who)).toBe(expected);
  });
});

describe('PaperTasterScreen', () => {
  it('loads tiles from getMembers and picks a member', async () => {
    const onPick = vi.fn();
    render(<PaperTasterScreen onPick={onPick} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pat' }));
    expect(api.getMembers).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith({ memberId: 5, name: 'Pat Lee' });
  });

  it('enables Use this name once a guest name is typed', () => {
    const onPick = vi.fn();
    render(<PaperTasterScreen onPick={onPick} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Use this name' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Someone else (guest)'), { target: { value: '  Sam ' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalledWith({ guestName: 'Sam', name: 'Sam' });
  });

  it('tells the typist how to separate two guests with the same name', () => {
    render(<PaperTasterScreen onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Two guests with the same name? Add something to tell them apart, e.g. Sam R.')).toBeInTheDocument();
  });
});

describe('PaperEntryDialog', () => {
  const setup = (props = {}) => {
    const onClose = vi.fn(); const onSaved = vi.fn();
    render(<PaperEntryDialog open flight={FLIGHT} onClose={onClose} onSaved={onSaved} {...props} />);
    return { onClose, onSaved };
  };
  const pickSam = () => {
    fireEvent.change(screen.getByLabelText('Someone else (guest)'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
  };
  const scoreCupA = () => {
    scoreAll(ALL);
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
  };
  const openAll = () => fireEvent.click(screen.getByRole('button', { name: /^All 2/ }));

  it('saves one complete cup as the guest', async () => {
    const { onSaved } = setup();
    pickSam();
    expect(screen.getByRole('heading', { name: 'Paper sheet · Sam' })).toBeInTheDocument();
    scoreCupA();
    openAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalledTimes(1));
    const [id, body] = api.enterPaperSheet.mock.calls[0];
    expect(id).toBe(9);
    expect(body.guestName).toBe('Sam');
    expect(body.tasterMemberId).toBeUndefined();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ position: 1, bar_vote: expect.any(String) });
    ALL.forEach((c) => expect(body.entries[0][c]).toBe(8.5));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ taster_key: 'paper:guest:sam', taster_name: 'Sam', count: 1 }));
  });

  it('sends the picked member and the shared device identity', async () => {
    setup({ memberId: 3 });
    fireEvent.click(await screen.findByRole('button', { name: 'Pat' }));
    scoreCupA(); openAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalled());
    expect(api.enterPaperSheet.mock.calls[0][1]).toMatchObject({ tasterMemberId: 5, memberId: 3 });
    expect(api.enterPaperSheet.mock.calls[0][1].guestName).toBeUndefined();
  });

  it('paper caption says the sheet joins the summary on save', async () => {
    setup(); pickSam(); scoreCupA(); openAll();
    expect(await screen.findByText('Skipping cups is fine. The sheet joins the summary when you save.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is shared until the host closes/)).toBeNull();
  });

  it('on a closed blind cupping titles each cup by its paper label and its name', () => {
    const closed = {
      ...FLIGHT, is_blind: true, is_open: false,
      cups: [
        { position: 1, label: 'Guji', blind: false, blind_label: 'A', coffee_id: 11, name: 'Guji', roaster: 'Onyx' },
        { position: 2, label: 'Huila', blind: false, blind_label: 'B', coffee_id: 12, name: 'Huila', roaster: 'Onyx' },
      ],
    };
    setup({ flight: closed }); pickSam();
    expect(screen.getByRole('heading', { name: 'Cup A · Guji' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Cup B' })).toBeInTheDocument();
  });

  it('a sighted cupping keeps the plain cup heading', () => {
    setup(); pickSam();
    expect(screen.getByRole('heading', { name: 'Cup A' })).toBeInTheDocument();
  });

  it('a half-done cup disables Save', async () => {
    setup(); pickSam();
    scoreAll(['aroma', 'flavour']);
    openAll();
    expect(await screen.findByRole('button', { name: 'Save 0 cups' })).toBeDisabled();
  });

  it('shows the 409 message and stays open', async () => {
    api.enterPaperSheet.mockRejectedValue({ response: { status: 409, data: { error: 'already_logged', message: 'Sam already has a read in this cupping' } } });
    const { onSaved, onClose } = setup(); pickSam(); scoreCupA(); openAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    expect((await screen.findAllByText('Sam already has a read in this cupping')).length).toBeGreaterThan(0);
    expect(screen.queryByText('already_logged')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a 403 error text', async () => {
    api.enterPaperSheet.mockRejectedValue({ response: { status: 403, data: { error: 'Only the host or an editor can enter a paper sheet' } } });
    setup(); pickSam(); scoreCupA(); openAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    expect((await screen.findAllByText('Only the host or an editor can enter a paper sheet')).length).toBeGreaterThan(0);
  });

  it('close after typing asks first; Keep typing stays, Discard closes with no request', async () => {
    const { onClose } = setup(); pickSam();
    score('aroma', 'ArrowRight');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard this paper sheet? Nothing has been saved.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep typing' }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Discard this paper sheet? Nothing has been saved.')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.enterPaperSheet).not.toHaveBeenCalled();
  });

  it('cannot be closed while a save is in flight', async () => {
    let finish;
    api.enterPaperSheet.mockReturnValue(new Promise((r) => { finish = r; }));
    const { onClose, onSaved } = setup(); pickSam(); scoreCupA(); openAll();
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Close', hidden: true })[0]);
    fireEvent.keyDown(screen.getAllByRole('dialog', { hidden: true })[0], { key: 'Escape' });
    expect(screen.queryByText('Discard this paper sheet? Nothing has been saved.')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    finish({ taster_key: 'paper:guest:sam', taster_name: 'Sam', count: 1 });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('close with nothing typed does not ask', () => {
    const { onClose } = setup(); pickSam();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the parked live draft untouched', async () => {
    function Both() {
      const [live, dispatch] = useReducer(reducer, null, () => reducer(initialDraft(), { type: 'seedFromFlight', flight: FLIGHT }));
      window.__live = live;
      return (
        <>
          <button onClick={() => dispatch({ type: 'advancedScore', coffeeId: 1, cat: 'aroma', value: 9 })}>seed live</button>
          <PaperEntryDialog open flight={FLIGHT} onClose={() => {}} onSaved={() => {}} />
        </>
      );
    }
    render(<Both />);
    fireEvent.click(screen.getByText('seed live'));
    const before = JSON.stringify(window.__live.entries);
    expect(before).toContain('9');
    pickSam(); scoreAll(['aroma', 'flavour']);
    expect(JSON.stringify(window.__live.entries)).toBe(before);
  });
});

describe('AdvancedEntryScreen variant paper', () => {
  it('renders no timer banner and no share button', () => {
    function H() {
      const [draft, dispatch] = useReducer(reducer, null, () => reducer(initialDraft(), { type: 'seedFromFlight', flight: { ...FLIGHT, adv_pass: 1, timer_elapsed_s: 10 } }));
      return <AdvancedEntryScreen draft={draft} dispatch={dispatch} variant="paper" paperName="Sam" onShare={() => {}} onOpenTimer={() => {}} onLog={() => {}} onClose={() => {}} />;
    }
    render(<H />);
    expect(screen.getByRole('heading', { name: 'Paper sheet · Sam' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share this flight' })).toBeNull();
  });
});
