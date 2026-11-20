/**
 * The Advanced cupping summary: routing (a Advanced flight's result is /summary, never
 * /reveal), the ranking table, and the coffee cards in both the named
 * (host/manager) and unnamed (everyone else) shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useReducer } from 'react';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getSummary: vi.fn(), getReveal: vi.fn(), getFlightResult: vi.fn(), getFlight: vi.fn(), closeFlight: vi.fn(),
    getRecentFlights: vi.fn(), getCoffees: vi.fn(), getMembers: vi.fn(), downloadCuppingCsv: vi.fn(), deleteTastings: vi.fn(), enterPaperSheet: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import SummaryScreen from '../summary/SummaryScreen';
import CalibrationBlock from '../summary/CalibrationBlock';
import FlightDialog from '../log/FlightDialog';
import LogTab from '../log/LogTab';
import { clearParkedDraft } from '../log/useFlightDraft';
import { reducer, initialDraft } from '../log/flightDraft';

const NULL_CATS = { aroma: null, flavour: null, aftertaste: null, acidity: null, sweetness: null, bitterness: null, weight: null, texture: null, afterfeel: null, balance: null };
const cats = (over = {}) => ({ ...NULL_CATS, aroma: { avg: 8.5, min: 8, max: 9 }, acidity: { avg: 8.25, min: 7, max: 9.5 }, ...over });
const read = (name, total, via = 'account') => ({
  taster_name: name, taster_key: `user:${name}`, created_via: via, total, scores: { ...NULL_CATS, acidity: 8.5 },
  bar_vote: 'yes', terms: ['blueberry'], defects: [], note: `${name} note`,
});

const flight = (over = {}) => ({ id: 9, name: 'Thursday cupping', sheet: 'advanced', is_open: false, is_host: true, logged_count: 3, roster: [], ...over });

const namedBody = () => ({
  flight: flight(), named: true,
  yours: {},
  calibration: null,
  coffees: [
    { coffee_id: 1, position: 1, blind_label: 'Cup B', name: 'Guji Shakiso', roaster: 'Maple Roasters', n: 3, avg_total: 86.5, categories: cats(),
      votes: { yes: 2, maybe: 1, no: 0 }, yes_share: 0.67, top_terms: [{ term: 'Fruit>Berry>blueberry', label: 'blueberry', pct: 67 }],
      defects: { musty: 1 }, dq: [{ category: 'acidity', by: 'Sam' }], reads: [read('Sam', 88), read('Robin', 85, 'paper')] },
    { coffee_id: 2, position: 2, blind_label: 'Cup A', name: 'Winter Blend', roaster: 'Maple Roasters', n: 3, avg_total: 80.1, categories: cats(),
      votes: { yes: 0, maybe: 1, no: 2 }, yes_share: 0, top_terms: [], defects: {}, dq: [], reads: [read('Pat', 80)] },
    { coffee_id: 3, position: 3, blind_label: 'Cup C', name: 'Huila 3', roaster: 'Howell', n: 3, avg_total: 83, categories: cats(),
      votes: { yes: 3, maybe: 0, no: 0 }, yes_share: 1, top_terms: [], defects: {}, dq: [], reads: [read('Lee', 83)] },
  ],
});

const unnamedBody = () => ({
  flight: flight({ is_host: false }), named: false,
  yours: {
    1: { ...read('Me', 87), scores: { ...NULL_CATS, aroma: 9, acidity: 8 } },
    2: { ...read('Me', 71), note: 'withheld note', terms: ['jasmine'] },
  },
  calibration: null,
  coffees: [
    { coffee_id: 1, position: 1, blind_label: null, name: 'Guji Shakiso', roaster: 'Maple Roasters', n: 4, avg_total: 85, categories: cats(),
      votes: { yes: 3, maybe: 1, no: 0 }, yes_share: 0.75, top_terms: [], defects: {}, dq: [{ category: 'acidity', by: null, count: 2 }], reads: null },
    { coffee_id: 2, position: 2, blind_label: null, name: 'Winter Blend', roaster: 'Maple Roasters', n: 2, avg_total: null, categories: NULL_CATS,
      votes: null, yes_share: null, top_terms: [], defects: {}, dq: [], reads: null },
    { coffee_id: 3, position: 3, blind_label: null, name: 'Empty Lot', roaster: 'X', n: 0, avg_total: null, categories: NULL_CATS,
      votes: { yes: 0, maybe: 0, no: 0 }, yes_share: null, top_terms: [], defects: {}, dq: [], reads: [] },
  ],
});

const draftWith = (result, extra = {}) => ({ screen: 'reveal', logged: true, flightId: 9, error: null, shared: true, sheet: 'advanced', flight: flight(), result, ...extra });
const renderSummary = (result, props = {}) => render(<SummaryScreen draft={draftWith(result)} onDone={() => {}} onCloseFlight={() => {}} {...props} />);

beforeEach(() => {
  auth.role = 'member';
  clearParkedDraft();
  Object.values(api).forEach((f) => f.mockReset());
  api.getFlightResult.mockImplementation((f, o) => (f.sheet === 'advanced' ? api.getSummary(f.id, o) : api.getReveal(f.id, o)));
  api.getRecentFlights.mockResolvedValue({ flights: [], me: { name: 'Robin', created_via: 'account' } });
  api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
});

const rowNames = () => screen.getAllByTestId('rank-row').map((r) => within(r).getByTestId('rank-name').textContent);

describe('SummaryScreen named', () => {
  it('ranks in server order with the original cup, vote counts and reader names', () => {
    renderSummary(namedBody());
    expect(rowNames()).toEqual(['Guji Shakiso', 'Winter Blend', 'Huila 3']);
    const first = screen.getAllByTestId('rank-row')[0];
    expect(within(first).getByText('was Cup B')).toBeInTheDocument();
    expect(within(first).getByText('86.5')).toBeInTheDocument();
    expect(within(first).getByLabelText('2 yes, 1 maybe, 0 no')).toBeInTheDocument();
    // Counts are words, not colour-coded digits.
    expect(within(first).getByText('2 Yes · 1 Maybe · 0 No')).toBeInTheDocument();
    // Cards are collapsed by default; open the first to see the reads.
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Robin')).toBeInTheDocument();
    expect(screen.getByText('paper')).toBeInTheDocument();
    expect(screen.getByText('D/Q by Sam (Acidity)')).toBeInTheDocument();
  });

  it('Vote sorts by yes share, descending', () => {
    renderSummary(namedBody());
    fireEvent.click(screen.getByRole('button', { name: 'Vote' }));
    expect(rowNames()).toEqual(['Huila 3', 'Guji Shakiso', 'Winter Blend']);
    fireEvent.click(screen.getByRole('button', { name: 'Score' }));
    expect(rowNames()).toEqual(['Guji Shakiso', 'Winter Blend', 'Huila 3']);
  });

  it('tapping a row scrolls to its card', () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderSummary(namedBody());
    fireEvent.click(screen.getAllByTestId('rank-row')[1]);
    expect(scrollIntoView).toHaveBeenCalled();
  });
});

describe('SummaryScreen unnamed', () => {
  it('shows no reader names, an aggregate D/Q chip, and withheld/empty card text', () => {
    renderSummary(unnamedBody());
    expect(screen.queryByText(/Sam|Robin/)).toBeNull();
    expect(screen.queryByText(/was Cup/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.getByText('D/Q: acidity ×2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Winter Blend card/ }));
    expect(screen.getByText('Not enough reads yet (2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Empty Lot card/ }));
    expect(screen.getByText('Nobody scored this cup')).toBeInTheDocument();
  });

  it('a withheld coffee shows a dash and no vote bar but keeps its n', () => {
    renderSummary(unnamedBody());
    const row = screen.getAllByTestId('rank-row')[1];
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByRole('img')).toBeNull();
    expect(within(row).getByTestId('rank-n')).toHaveTextContent('2');
  });

  it('shows my own dot on the axis from yours[coffee].scores', () => {
    renderSummary(unnamedBody());
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.getByRole('img', { name: /^Aroma: average 8\.5, range 8\.0 to 9\.0, you 9\.0$/ })).toBeInTheDocument();
  });

  it('shows my own read on a full card', () => {
    renderSummary(unnamedBody());
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('87.0')).toBeInTheDocument();
    expect(screen.getByText('Me note')).toBeInTheDocument();
  });

  it('shows my own read on a withheld coffee, with no table stats', () => {
    renderSummary(unnamedBody());
    fireEvent.click(screen.getByRole('button', { name: /Winter Blend card/ }));
    expect(screen.getByText('Not enough reads yet (2)')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('71.0')).toBeInTheDocument();
    expect(screen.getByText('withheld note')).toBeInTheDocument();
    expect(screen.getByText('jasmine')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /average/ })).toBeNull();
  });

  it('shows no own-read row when the viewer has not scored the coffee', () => {
    renderSummary(unnamedBody());
    fireEvent.click(screen.getByRole('button', { name: /Empty Lot card/ }));
    expect(screen.queryByText('You')).toBeNull();
  });

  it('a named viewer gets no separate You row', () => {
    renderSummary(namedBody());
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.queryByText('You')).toBeNull();
  });

  it('labels the ranking columns and the read count', () => {
    renderSummary(namedBody());
    const header = screen.getByTestId('rank-header');
    ['#', 'Coffee', 'Avg', 'n'].forEach((t) => expect(within(header).getByText(t)).toBeInTheDocument());
    expect(within(screen.getAllByTestId('rank-row')[0]).getByTestId('rank-n')).toHaveTextContent('3 reads');
  });

  it('keeps two D/Q chips from the same category and name distinct', () => {
    const body = namedBody();
    body.coffees[0].dq = [{ category: 'acidity', by: 'Sam' }, { category: 'acidity', by: 'Sam' }];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSummary(body);
    fireEvent.click(screen.getByRole('button', { name: /Guji Shakiso card/ }));
    expect(screen.getAllByText('D/Q by Sam (Acidity)')).toHaveLength(2);
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    spy.mockRestore();
  });

  it('offers Delete my tasting when onDelete is passed', () => {
    const onDelete = vi.fn();
    renderSummary(unnamedBody(), { onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete this tasting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe('CalibrationBlock', () => {
  it('names the categories beyond +-0.5 and not the rest', () => {
    render(<CalibrationBlock calibration={{ acidity: 0.6, texture: -0.7, aroma: 0.1 }} />);
    expect(screen.getByText('You score acidity higher and texture lower than the table.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Acidity: 0\.6 above the table/ })).toBeInTheDocument();
  });
  it('says so when nothing is beyond 0.5', () => {
    render(<CalibrationBlock calibration={{ aroma: 0.1 }} />);
    expect(screen.getByText('You score close to the table.')).toBeInTheDocument();
  });
  it('renders nothing for null', () => {
    const { container } = render(<CalibrationBlock calibration={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows inside the summary when the body carries it', () => {
    renderSummary({ ...unnamedBody(), calibration: { acidity: 0.6, texture: -0.7 } });
    expect(screen.getByText(/You score acidity higher/)).toBeInTheDocument();
  });
});

describe('SummaryScreen download', () => {
  it('named body downloads the CSV named by the group-local open date', async () => {
    api.downloadCuppingCsv.mockResolvedValue('x');
    // 02:30 UTC on the 22nd is the evening of the 21st in New York.
    renderSummary({ ...namedBody(), flight: flight({ opened_at: '2026-10-22T02:30:00' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Download spreadsheet' }));
    await waitFor(() => expect(api.downloadCuppingCsv).toHaveBeenCalledWith(9, 'cupping-2026-10-21-9.csv'));
  });
  it('shows an error alert when the download fails', async () => {
    api.downloadCuppingCsv.mockRejectedValue(new Error('boom'));
    renderSummary(namedBody());
    fireEvent.click(screen.getByRole('button', { name: 'Download spreadsheet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/download/i);
  });
  it('disables Download while the file is being fetched', async () => {
    let finish;
    api.downloadCuppingCsv.mockReturnValue(new Promise((r) => { finish = r; }));
    renderSummary(namedBody());
    const btn = screen.getByRole('button', { name: 'Download spreadsheet' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    expect(api.downloadCuppingCsv).toHaveBeenCalledTimes(1);
    finish('x');
    await waitFor(() => expect(btn).toBeEnabled());
  });
  it('unnamed body has no Download', () => {
    renderSummary(unnamedBody());
    expect(screen.queryByRole('button', { name: 'Download spreadsheet' })).not.toBeInTheDocument();
  });
  it('the shared store device has no Download even on a named body', () => {
    auth.role = 'device';
    renderSummary(namedBody());
    expect(screen.queryByRole('button', { name: 'Download spreadsheet' })).not.toBeInTheDocument();
  });
});

describe('SummaryScreen empty', () => {
  it('says so when nobody logged a cup', () => {
    renderSummary({ ...namedBody(), coffees: [] });
    expect(screen.getByText('Nobody logged a cup in this cupping.')).toBeInTheDocument();
    expect(screen.queryByTestId('rank-header')).toBeNull();
  });
});

describe('SummaryScreen waiting', () => {
  it('shows the waiting state while there is no result', () => {
    renderSummary(null);
    expect(screen.getByRole('button', { name: 'Close flight & reveal' })).toBeInTheDocument();
  });
});

describe('routing', () => {
  it('closing a Advanced flight fetches /summary (not /reveal) and leaves the waiting state', async () => {
    api.closeFlight.mockResolvedValue({});
    api.getSummary.mockResolvedValue(namedBody());
    function Harness() {
      const [draft, dispatch] = useReducer(reducer, null, () => {
        const f = flight({ is_open: true, cups: [{ position: 1, label: 'Cup A', blind: true }], prep: 'cupping', is_shared: true });
        return reducer(reducer(initialDraft(), { type: 'seedFromFlight', flight: f }), { type: 'logged', flight: f });
      });
      return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
    }
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close flight & reveal' }));
    await screen.findAllByTestId('rank-row');
    expect(api.getSummary).toHaveBeenCalledTimes(1);
    expect(api.getReveal).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close flight & reveal' })).toBeNull();
  });

  it('opening a closed Advanced flight from Recent calls /summary', async () => {
    const f = { ...flight(), prep: 'cupping', cups: [], title: 'Thursday cupping', cup_count: 3, you_logged: true };
    api.getRecentFlights.mockResolvedValue({ flights: [f], me: { name: 'Robin', created_via: 'account' } });
    api.getSummary.mockResolvedValue(namedBody());
    render(<MemoryRouter initialEntries={['/log']}><Routes><Route path="/log" element={<LogTab />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('recent-9'));
    await waitFor(() => expect(api.getSummary).toHaveBeenCalledWith(9, undefined));
    expect(api.getReveal).not.toHaveBeenCalled();
    await screen.findAllByTestId('rank-row');
  });
});

describe('SummaryScreen paper reads', () => {
  const GUJI = /Guji Shakiso card/;
  const open = () => fireEvent.click(screen.getByRole('button', { name: GUJI }));
  const RM = "Remove Robin's paper read";
  const withCups = (over = {}) => ({ ...namedBody(), flight: flight({ cups: [{ position: 1, label: 'Cup A', blind: false, coffee_id: 1, name: 'Guji Shakiso', roaster: 'Maple Roasters' }], adv_step: 0.5, ...over }) });

  it('shows the paper chip on a paper read only', () => {
    renderSummary(namedBody());
    open();
    expect(screen.getAllByText('paper')).toHaveLength(1);
  });

  it('the host sees Remove on a paper read, and only on that one', () => {
    renderSummary(namedBody());
    open();
    expect(screen.getAllByRole('button', { name: RM })).toHaveLength(1);
  });

  it('a non-host manager sees Remove', () => {
    auth.role = 'editor';
    const body = namedBody(); body.flight = flight({ is_host: false });
    renderSummary(body);
    open();
    expect(screen.getByRole('button', { name: RM })).toBeInTheDocument();
  });

  it('a non-host staff member sees no Remove', () => {
    const body = namedBody(); body.flight = flight({ is_host: false });
    renderSummary(body);
    open();
    expect(screen.queryByRole('button', { name: RM })).toBeNull();
  });

  it('the shared store device sees no Remove even as host', () => {
    auth.role = 'device';
    renderSummary(namedBody());
    open();
    expect(screen.queryByRole('button', { name: RM })).toBeNull();
  });

  it('the shared store device is told who can remove a paper sheet', () => {
    auth.role = 'device';
    renderSummary(namedBody());
    expect(screen.getAllByText('To remove a paper sheet, ask an editor.')).toHaveLength(1);
  });

  it('the store device that can enter paper sees the line even with no reads shown', () => {
    auth.role = 'device';
    const body = unnamedBody(); body.flight = flight({ is_host: true });
    renderSummary(body);
    expect(screen.getByText('To remove a paper sheet, ask an editor.')).toBeInTheDocument();
  });

  it('a phone host is not shown the ask-an-editor line', () => {
    renderSummary(namedBody());
    expect(screen.queryByText('To remove a paper sheet, ask an editor.')).toBeNull();
  });

  it('confirm deletes that taster key then refreshes the result', async () => {
    api.deleteTastings.mockResolvedValue({});
    const onRefreshResult = vi.fn().mockResolvedValue();
    renderSummary(namedBody(), { onRefreshResult });
    open();
    fireEvent.click(screen.getByRole('button', { name: RM }));
    expect(screen.getByText("Remove Robin's paper sheet from this cupping?")).toBeInTheDocument();
    expect(api.deleteTastings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteTastings).toHaveBeenCalledWith(9, { tasterKey: 'user:Robin' }));
    await waitFor(() => expect(onRefreshResult).toHaveBeenCalled());
  });

  it('cancelling the confirm deletes nothing', () => {
    renderSummary(namedBody());
    open();
    fireEvent.click(screen.getByRole('button', { name: RM }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteTastings).not.toHaveBeenCalled();
  });

  it('a failed delete shows an error and does not refresh', async () => {
    api.deleteTastings.mockRejectedValue({ response: { status: 403, data: { error: 'nope' } } });
    const onRefreshResult = vi.fn();
    renderSummary(namedBody(), { onRefreshResult });
    open();
    fireEvent.click(screen.getByRole('button', { name: RM }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nope');
    expect(onRefreshResult).not.toHaveBeenCalled();
  });

  it('Enter a paper sheet shows for a non-host editor and not for a non-host member', () => {
    auth.role = 'editor';
    const body = withCups(); body.flight.is_host = false;
    const { unmount } = renderSummary(body);
    expect(screen.getByRole('button', { name: 'Enter a paper sheet' })).toBeInTheDocument();
    unmount();
    auth.role = 'member';
    const notHost = withCups(); notHost.flight.is_host = false;
    renderSummary(notHost);
    expect(screen.queryByRole('button', { name: 'Enter a paper sheet' })).toBeNull();
  });

  it('a saved paper sheet refetches the summary and the new read shows its chip', async () => {
    auth.role = 'editor';
    api.getMembers.mockResolvedValue([]);
    api.enterPaperSheet.mockResolvedValue({ taster_key: 'paper:guest:sam', taster_name: 'Sam', count: 1 });
    const after = withCups();
    after.coffees[1].reads.push(read('Sam', 84, 'paper'));
    after.coffees = after.coffees.map((c) => (c.coffee_id === 2 ? c : { ...c, reads: c.reads }));
    api.getSummary.mockResolvedValue(after);
    function Harness() {
      const [draft, dispatch] = useReducer(reducer, null, () => {
        const f = withCups().flight;
        return reducer(reducer(reducer(initialDraft(), { type: 'seedFromFlight', flight: f }), { type: 'logged', flight: f }), { type: 'revealed', result: withCups() });
      });
      return <FlightDialog draft={draft} dispatch={dispatch} onDone={() => {}} />;
    }
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enter a paper sheet' }));
    fireEvent.change(await screen.findByLabelText('Someone else (guest)'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
    ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance']
      .forEach((c) => fireEvent.keyDown(screen.getByTestId(`advanced-slider-${c}`), { key: 'ArrowRight' }));
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.getSummary).toHaveBeenCalledWith(9, { memberId: null }));
    fireEvent.click(await screen.findByRole('button', { name: /Winter Blend card/ }));
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.getAllByText('paper').length).toBeGreaterThan(0);
  });
});
