import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SessionCard from '../SessionCard';
import SoloRow from '../SoloRow';
import { ADV_GROUPS } from '../../../content';

const ADV_CATS = ADV_GROUPS.flatMap(([, cats]) => cats);
const advancedScores = (v) => Object.fromEntries(ADV_CATS.map((c) => [c, v]));
const advancedRead = (v, total, over = {}) => ({
  scores: advancedScores(v), total, overall: null, vote: 'yes', terms: ['jasmine', 'peach'], defects: [], note: 'Clean and sweet.', ...over,
});

function advancedSession(over = {}) {
  return {
    flight_id: 7, date: '2026-11-05', name: 'Thursday cupping', prep: 'cupping', sheet: 'advanced', shared: true,
    cup_label: 'Cup D', n: 6, flight_cups: 6, rank: { place: 3, of: 6 }, vs_flight: 1.2,
    yours: advancedRead(8.5, 85),
    room: {
      n_others: 5, others_avg: { ...advancedScores(8), total: 80 },
      range: { ...Object.fromEntries(ADV_CATS.map((c) => [c, [7.5, 9]])), total: [78, 84] },
      votes: { yes: 4, maybe: 1, no: 1 },
      terms: [{ term: 'jasmine', label: 'jasmine', count: 3 }, { term: 'peach', label: 'peach', count: 1 }],
      defects: [{ term: 'fermented', count: 1 }],
    },
    reads: null,
    ...over,
  };
}

function basicSession(over = {}) {
  const avg = { acidity: 3.5, sweetness: 3, body: 2.5, balance: 4, overall: 3.8 };
  return {
    flight_id: 8, date: '2026-11-06', name: null, prep: 'drip', sheet: 'basic', shared: false,
    cup_label: null, n: 3, flight_cups: 1, rank: null, vs_flight: null,
    yours: { scores: { acidity: 4, sweetness: 3, body: 2, balance: 5, overall: 4 }, total: null, overall: 4, vote: null, terms: ['citrus'], defects: [], note: '' },
    room: { n_others: 2, others_avg: avg, range: Object.fromEntries(Object.keys(avg).map((k) => [k, [2, 5]])), votes: null, terms: [], defects: [] },
    reads: null,
    ...over,
  };
}

const named = (over = {}) => advancedSession({
  reads: [
    { ...advancedRead(8.5, 85), taster_name: 'Josh', taster_key: 'user:me', is_you: true },
    { ...advancedRead(8, 80, { vote: 'maybe', terms: ['peach'], defects: ['fermented'], note: 'A bit funky.' }), taster_name: 'Robin', taster_key: 'user:kel', is_you: false },
  ],
  ...over,
});

const FOOTER = "Each person's scores and notes are shown to editors and the cupping's host.";

describe('SessionCard header', () => {
  it('shows date, name, cup, sheet, tasters, rank chip and lean vs flight', () => {
    render(<SessionCard session={advancedSession()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('Thu, Nov 5')).toBeInTheDocument();
    expect(screen.getByText('Thursday cupping')).toBeInTheDocument();
    expect(screen.getByText('Cup D')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('6 tasters')).toBeInTheDocument();
    expect(screen.getByText('3rd of 6 cups')).toBeInTheDocument();
    expect(screen.getByText('+1.2 vs flight average')).toBeInTheDocument();
  });

  it('labels the basic sheet and omits rank, cup and lean when absent', () => {
    render(<SessionCard session={basicSession()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('Basic sheet')).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ cups/)).toBeNull();
    expect(screen.queryByText(/vs flight average/)).toBeNull();
  });

  it('prints a negative flight lean with a true minus', () => {
    render(<SessionCard session={advancedSession({ vs_flight: -0.4 })} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('−0.4 vs flight average')).toBeInTheDocument();
  });
});

describe('SessionCard totals strip', () => {
  it('advanced: your total with vote chip, everyone else, your lean and the votes', () => {
    render(<SessionCard session={advancedSession()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    const strip = screen.getByTestId('totals-strip');
    expect(within(strip).getByText('Your total')).toBeInTheDocument();
    expect(within(strip).getByText('85.0')).toBeInTheDocument();
    expect(within(strip).getByText('Yes')).toBeInTheDocument();
    expect(within(strip).getByText('Everyone else')).toBeInTheDocument();
    expect(within(strip).getByText('80.0')).toBeInTheDocument();
    expect(within(strip).getByText('Your lean')).toBeInTheDocument();
    expect(within(strip).getByText('+5.0')).toBeInTheDocument();
    expect(within(strip).getByText('4 yes · 1 maybe · 1 no')).toBeInTheDocument();
  });

  it('basic: your stars and the word', () => {
    render(<SessionCard session={basicSession()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    const strip = screen.getByTestId('totals-strip');
    expect(within(strip).getByLabelText('4 of 5 stars')).toBeInTheDocument();
    expect(within(strip).getByText('really good')).toBeInTheDocument();
    expect(within(strip).queryByText('Your total')).toBeNull();
    expect(within(strip).getByText('Everyone else')).toBeInTheDocument();
    expect(within(strip).getByText('3.8')).toBeInTheDocument();
    expect(within(strip).getByText('Your lean')).toBeInTheDocument();
    expect(within(strip).getByText('+0.2')).toBeInTheDocument();
  });
});

describe('SessionCard unnamed room', () => {
  it('shows what you tasted, what the room tasted and the exact footer', () => {
    render(<SessionCard session={advancedSession()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('What you tasted')).toBeInTheDocument();
    expect(screen.getByText('Clean and sweet.')).toBeInTheDocument();
    expect(screen.getByText('What the room tasted')).toBeInTheDocument();
    expect(screen.getByText('jasmine 3')).toBeInTheDocument();
    expect(screen.getByText('peach 1')).toBeInTheDocument();
    expect(screen.getByText('fermented 1')).toBeInTheDocument();
    expect(screen.getByText(FOOTER)).toBeInTheDocument();
    expect(screen.queryByText('What people tasted')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('SessionCard named reads', () => {
  it('renders a row per reader and no unnamed footer', () => {
    render(<SessionCard session={named()} onDeleteRead={vi.fn()} canManage isPerson />);
    expect(screen.getByText('What people tasted')).toBeInTheDocument();
    const rows = screen.getAllByTestId('read-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Robin')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Maybe')).toBeInTheDocument();
    expect(within(rows[1]).getByText('peach')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/fermented/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('A bit funky.')).toBeInTheDocument();
    expect(screen.queryByText(FOOTER)).toBeNull();
    expect(screen.queryByText('What the room tasted')).toBeNull();
  });

  it('canManage can delete anyone: own without key, other with their key', async () => {
    const onDeleteRead = vi.fn();
    render(<SessionCard session={named()} onDeleteRead={onDeleteRead} canManage isPerson />);
    await userEvent.click(screen.getByRole('button', { name: "Delete Robin's read" }));
    expect(onDeleteRead).toHaveBeenCalledWith({ flightId: 7, tasterKey: 'user:kel', who: "Robin's" });
    await userEvent.click(screen.getByRole('button', { name: 'Delete your read' }));
    expect(onDeleteRead).toHaveBeenLastCalledWith({ flightId: 7, who: 'Your' });
  });

  it('a non-manager on a closed shared flight gets no delete buttons', () => {
    render(<SessionCard session={named()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it('a non-manager on a solo-flag session can delete their own read only', () => {
    render(<SessionCard session={named({ shared: false })} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByRole('button', { name: 'Delete your read' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "Delete Robin's read" })).toBeNull();
  });
});

describe('SessionCard unnamed deletes', () => {
  it('own delete follows (!shared || canManage) and isPerson', async () => {
    const onDeleteRead = vi.fn();
    const { rerender } = render(<SessionCard session={advancedSession()} onDeleteRead={onDeleteRead} canManage={false} isPerson />);
    expect(screen.queryByRole('button', { name: 'Delete your read' })).toBeNull();
    rerender(<SessionCard session={advancedSession()} onDeleteRead={onDeleteRead} canManage isPerson />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete your read' }));
    expect(onDeleteRead).toHaveBeenCalledWith({ flightId: 7, who: 'Your' });
    rerender(<SessionCard session={advancedSession()} onDeleteRead={onDeleteRead} canManage isPerson={false} />);
    expect(screen.queryByRole('button', { name: 'Delete your read' })).toBeNull();
  });
});

describe('SessionCard withheld', () => {
  const withheld = (over) => advancedSession({ room: null, reads: null, n: 2, rank: null, vs_flight: null, ...over });

  it('with your read: only yours shows, copy verbatim, no table', () => {
    render(<SessionCard session={withheld()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText("Only your read shows. The room's numbers appear once 3 people have tasted it.")).toBeInTheDocument();
    expect(screen.getByText('Clean and sweet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(FOOTER)).toBeNull();
    expect(screen.queryByText('What the room tasted')).toBeNull();
  });

  it('without your read: private copy only', () => {
    render(<SessionCard session={withheld({ yours: null })} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('Scores stay private until 3 people have tasted it.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('totals-strip')).toBeNull();
  });
});

describe('SoloRow without a named read', () => {
  it("hides delete on someone else's row the server did not name", () => {
    const s = basicSession({ shared: false, n: 1, room: null, reads: null, yours: null });
    render(<SoloRow session={s} onDeleteRead={vi.fn()} canManage isPerson />);
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
});

describe('SessionCard taster count', () => {
  it('says 1 taster', () => {
    render(<SessionCard session={advancedSession({ n: 1 })} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('1 taster')).toBeInTheDocument();
  });
});

describe('SoloRow', () => {
  const solo = (over) => basicSession({ shared: false, n: 1, room: null, reads: null, ...over });

  it('one line: date, prep, stars and terms', () => {
    render(<SoloRow session={solo()} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('Fri, Nov 6')).toBeInTheDocument();
    expect(screen.getByText('Drip')).toBeInTheDocument();
    expect(screen.getByLabelText('4 of 5 stars')).toBeInTheDocument();
    expect(screen.getByText('citrus')).toBeInTheDocument();
  });

  it('advanced solo shows the total', () => {
    render(<SoloRow session={solo({ sheet: 'advanced', prep: 'cupping', yours: advancedRead(8.5, 85) })} onDeleteRead={vi.fn()} canManage={false} isPerson />);
    expect(screen.getByText('85.0')).toBeInTheDocument();
    expect(screen.getByText('Cupping')).toBeInTheDocument();
  });

  it('own delete for anyone who is a person; none for a shared device', async () => {
    const onDeleteRead = vi.fn();
    const { rerender } = render(<SoloRow session={solo()} onDeleteRead={onDeleteRead} canManage={false} isPerson />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete your read' }));
    expect(onDeleteRead).toHaveBeenCalledWith({ flightId: 8, who: 'Your' });
    rerender(<SoloRow session={solo()} onDeleteRead={onDeleteRead} canManage={false} isPerson={false} />);
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });

  it("someone else's solo row deletes only for canManage", async () => {
    const onDeleteRead = vi.fn();
    const other = solo({ yours: null, reads: [{ ...basicSession().yours, taster_name: 'Ann', taster_key: 'user:a', is_you: false }] });
    const { rerender } = render(<SoloRow session={other} onDeleteRead={onDeleteRead} canManage={false} isPerson />);
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
    rerender(<SoloRow session={other} onDeleteRead={onDeleteRead} canManage isPerson />);
    await userEvent.click(screen.getByRole('button', { name: "Delete Ann's read" }));
    expect(onDeleteRead).toHaveBeenCalledWith({ flightId: 8, tasterKey: 'user:a', who: "Ann's" });
  });
});
