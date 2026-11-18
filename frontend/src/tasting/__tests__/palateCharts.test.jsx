import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { markerPct } from '../bits/chartMath';
import YouVsRoom from '../bits/YouVsRoom';
import VoteBar from '../bits/VoteBar';
import CategoryLean from '../palate/CategoryLean';

const wrap = (ui) => render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe('markerPct', () => {
  it('maps a value onto 0-100 and clamps', () => {
    expect(markerPct(70, 75, 100)).toBe(0);
    expect(markerPct(87.5, 75, 100)).toBe(50);
    expect(markerPct(101, 75, 100)).toBe(100);
  });
});

describe('YouVsRoom', () => {
  it('draws one marker and a single-number label with no room', () => {
    wrap(<YouVsRoom you={88} room={null} min={75} max={100} />);
    expect(screen.getAllByTestId(/^marker-/)).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAccessibleName('You 88.0');
  });
  it('gives both numbers, with a filled you and a hollow room', () => {
    wrap(<YouVsRoom you={88} room={85.25} min={75} max={100} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('You 88.0, the room 85.3');
    expect(screen.getAllByTestId(/^marker-/)).toHaveLength(2);
    expect(screen.getByTestId('marker-you')).toHaveStyle({ left: '52%' });
  });
  it('takes custom labels', () => {
    wrap(<YouVsRoom you={4} room={3} min={1} max={5} youLabel="Yours" roomLabel="Theirs" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Yours 4.0, theirs 3.0');
  });
});

describe('VoteBar', () => {
  it('renders nothing for zero votes', () => {
    const { container } = wrap(<VoteBar votes={{ yes: 0, maybe: 0, no: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows the counts', () => {
    wrap(<VoteBar votes={{ yes: 3, maybe: 2, no: 1 }} />);
    expect(screen.getByText('3 yes · 2 maybe · 1 no')).toBeInTheDocument();
  });
});

describe('CategoryLean', () => {
  it('lists the given categories in Advanced order with signed values', () => {
    wrap(<CategoryLean lean={{ aroma: 0.3, flavour: -0.3, balance: 0 }} />);
    const rows = screen.getAllByTestId(/^lean-(?!bar)/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['lean-aroma', 'lean-flavour', 'lean-balance']);
    expect(within(rows[0]).getByText('+0.3')).toBeInTheDocument();
    expect(within(rows[1]).getByText('−0.3')).toBeInTheDocument();
    expect(within(rows[2]).getByText('0.0')).toBeInTheDocument();
  });
  it('colors the positive and negative bars differently', () => {
    wrap(<CategoryLean lean={{ aroma: 0.5, flavour: -0.5 }} />);
    const pos = screen.getByTestId('lean-bar-aroma');
    const neg = screen.getByTestId('lean-bar-flavour');
    expect(getComputedStyle(pos).backgroundColor).not.toBe(getComputedStyle(neg).backgroundColor);
  });
});
