import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CategoryTable from '../CategoryTable';
import { ADV_GROUPS } from '../../../content';

const ADV_CATS = ADV_GROUPS.flatMap(([, cats]) => cats);

const advancedScores = (v) => Object.fromEntries(ADV_CATS.map((c) => [c, v]));
const advancedRead = (v, total) => ({ scores: advancedScores(v), total, overall: null, vote: 'yes', terms: [], defects: [], note: '' });

function advancedSession(over = {}) {
  const others = { ...advancedScores(8), total: 80 };
  const range = { ...Object.fromEntries(ADV_CATS.map((c) => [c, [7.5, 9]])), total: [78, 84] };
  return {
    flight_id: 1, date: '2026-11-05', name: 'Thu', prep: 'cupping', sheet: 'advanced', shared: true,
    n: 4, flight_cups: 3, rank: null, vs_flight: null,
    yours: advancedRead(8.5, 85),
    room: { n_others: 3, others_avg: others, range, votes: null, terms: [], defects: [] },
    reads: null,
    ...over,
  };
}

function basicSession(over = {}) {
  const scores = { acidity: 4, sweetness: 3, body: 2, balance: 5, overall: 4 };
  const avg = { acidity: 3.5, sweetness: 3, body: 2.5, balance: 4, overall: 3.8 };
  return {
    flight_id: 2, date: '2026-11-06', name: null, prep: 'brew', sheet: 'basic', shared: false,
    n: 3, flight_cups: 1, rank: null, vs_flight: null,
    yours: { scores, total: null, overall: 4, vote: null, terms: [], defects: [], note: '' },
    room: {
      n_others: 2, others_avg: avg,
      range: Object.fromEntries(Object.keys(avg).map((k) => [k, [2, 5]])),
      votes: null, terms: [], defects: [],
    },
    reads: null,
    ...over,
  };
}

describe('CategoryTable (advanced)', () => {
  it('renders 10 category rows, a Total row and the You/Others/Lean headers with no person columns', () => {
    render(<CategoryTable session={advancedSession()} />);
    expect(screen.getAllByTestId('category-row')).toHaveLength(10);
    expect(screen.getByTestId('total-row')).toBeInTheDocument();
    for (const h of ['You', 'Others', 'Lean']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.queryAllByTestId('person-header')).toHaveLength(0);
    expect(screen.getByText('Aromatic')).toBeInTheDocument();
    expect(screen.getByText('Aroma')).toBeInTheDocument();
  });

  it('prints lean with a leading plus and a true minus sign', () => {
    render(<CategoryTable session={advancedSession()} />);
    expect(within(screen.getAllByTestId('category-row')[0]).getByText('+0.5')).toBeInTheDocument();
    const s = advancedSession();
    s.room.others_avg.aroma = 8.6;
    s.yours.scores.aroma = 8.5;
    render(<CategoryTable session={s} />);
    expect(screen.getByText('−0.1')).toBeInTheDocument();
  });

  it('shows 0.0 for a zero lean', () => {
    const s = advancedSession();
    s.room.others_avg.aroma = 8.5;
    render(<CategoryTable session={s} />);
    expect(within(screen.getAllByTestId('category-row')[0]).getByText('0.0')).toBeInTheDocument();
  });

  it('adds one column per reader who is not you', () => {
    const reads = [
      { ...advancedRead(8.5, 85), taster_name: 'Josh', taster_key: 'a', is_you: true },
      { ...advancedRead(8, 80), taster_name: 'Ana', taster_key: 'b', is_you: false },
      { ...advancedRead(7.5, 75), taster_name: 'Bo', taster_key: 'c', is_you: false },
    ];
    render(<CategoryTable session={advancedSession({ reads })} />);
    const heads = screen.getAllByTestId('person-header');
    expect(heads.map((h) => h.textContent)).toEqual([expect.stringContaining('Ana'), expect.stringContaining('Bo')]);
    expect(screen.queryByText('Josh')).not.toBeInTheDocument();
  });

  it('prints D/Q for a 7 score', () => {
    const s = advancedSession();
    s.yours.scores.aroma = 7;
    render(<CategoryTable session={s} />);
    expect(within(screen.getAllByTestId('category-row')[0]).getByText('D/Q')).toBeInTheDocument();
  });

  it('shows only the You column when the room is withheld', () => {
    render(<CategoryTable session={advancedSession({ room: null })} />);
    expect(screen.getByRole('columnheader', { name: 'You' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Others' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Lean' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('CategoryTable (basic)', () => {
  it('renders 5 rows each with the word for your score and no total row', () => {
    render(<CategoryTable session={basicSession()} />);
    expect(screen.getAllByTestId('category-row')).toHaveLength(5);
    expect(screen.queryByTestId('total-row')).not.toBeInTheDocument();
    expect(screen.getByText('you: sharp')).toBeInTheDocument();
    expect(screen.getByText('you: light')).toBeInTheDocument();
    expect(screen.getByText('you: everything fits')).toBeInTheDocument();
    expect(screen.getByText('you: sweet')).toBeInTheDocument();
  });
});

describe('CategoryTable structure', () => {
  const reads = [
    { ...advancedRead(8.5, 85), taster_name: 'Josh', taster_key: 'a', is_you: true },
    { ...advancedRead(8, 80), taster_name: 'Ana', taster_key: 'b', is_you: false },
  ];

  it('builds a real table: headers and body cells live in rows', () => {
    render(<CategoryTable session={advancedSession({ reads })} />);
    for (const h of screen.getAllByRole('columnheader')) expect(h.parentElement).toHaveAttribute('role', 'row');
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(1 + 10 + 1);
    const aroma = screen.getAllByTestId('category-row')[0];
    expect(within(aroma).getByRole('rowheader')).toHaveTextContent('Aroma');
    expect(within(aroma).getAllByRole('cell').length).toBeGreaterThanOrEqual(5);
    expect(within(screen.getByTestId('total-row')).getByRole('rowheader')).toHaveTextContent('Total');
  });

  it('keeps person columns rendered (scrollable) rather than hidden at any width', () => {
    render(<CategoryTable session={advancedSession({ reads })} />);
    expect(screen.getByTestId('person-header')).toHaveTextContent('Ana');
    expect(screen.getByRole('columnheader', { name: /Ana/ })).toBeVisible();
  });
});
