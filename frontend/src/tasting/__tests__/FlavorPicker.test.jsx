import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FlavorWheel from '../entry/FlavorWheel';
import { arc } from '../entry/wheelGeometry';
import FlavorPicker from '../entry/FlavorPicker';

const B = 'Fruit>Berry>blueberry';

describe('FlavorWheel', () => {
  it('shows a ring with more than 12 notes as a list of tap targets', () => {
    const onPath = vi.fn();
    const onCycle = vi.fn();
    const V = 'Vegetal / Earthy / Herb';
    render(<FlavorWheel path={[V]} tags={{ [`${V}>soil`]: 2 }} onPath={onPath} onCycle={onCycle} />);
    const list = screen.getByTestId('flavor-list');
    expect(within(list).getAllByTestId(/^wedge-/)).toHaveLength(22);
    expect(within(list).getByRole('button', { name: 'soil, picked' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(list).getByRole('button', { name: 'cedar' }));
    expect(onCycle).toHaveBeenCalledWith(`${V}>cedar`);
  });

  it('keeps wedges for rings of 12 or fewer', () => {
    render(<FlavorWheel path={['Fruit']} tags={{}} onPath={() => {}} onCycle={() => {}} />);
    expect(screen.queryByTestId('flavor-list')).toBeNull();
    expect(screen.getAllByTestId(/^wedge-/)).toHaveLength(8);
  });

  it('arc geometry closes a wedge and anchors its label mid-wedge', () => {
    const g = arc(0, 4);
    expect(g.d.startsWith('M0.0,-138.0 A138,138 0 0,1 ')).toBe(true);
    expect(g.d.endsWith('Z')).toBe(true);
    expect(g.lx).toBeGreaterThan(0);
    expect(g.ly).toBeLessThan(0);
    // Only a single full-circle wedge sweeps more than half a turn.
    expect(arc(0, 1).d).toContain(' 1,1 ');
    expect(arc(0, 2).d).toContain(' 0,1 ');
  });

  it('renders ten family wedges at the root and drills on a heading tap', () => {
    const onPath = vi.fn();
    const onCycle = vi.fn();
    render(<FlavorWheel path={[]} tags={{}} onPath={onPath} onCycle={onCycle} />);
    expect(screen.getAllByTestId(/^wedge-/)).toHaveLength(10);
    expect(screen.getByText('All flavors')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Fruit' }));
    expect(onPath).toHaveBeenCalledWith(['Fruit']);
    expect(onCycle).not.toHaveBeenCalled();
  });

  it('cycles a leaf on tap, picks a heading from the centre, and reads covered under specific wins', () => {
    const onPath = vi.fn();
    const onCycle = vi.fn();
    const { rerender } = render(<FlavorWheel path={['Fruit', 'Berry']} tags={{}} onPath={onPath} onCycle={onCycle} />);
    expect(screen.getAllByTestId(/^wedge-/)).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'blueberry' }));
    expect(onCycle).toHaveBeenCalledWith(B);
    fireEvent.click(screen.getByTestId('wheel-center'));
    expect(onCycle).toHaveBeenCalledWith('Fruit>Berry');
    expect(screen.getByText('＋ take as is')).toBeInTheDocument();

    onCycle.mockClear();
    rerender(<FlavorWheel path={['Fruit', 'Berry']} tags={{ [B]: 3 }} onPath={onPath} onCycle={onCycle} />);
    expect(screen.getByText('covered by')).toBeInTheDocument();
    expect(screen.getByText('blueberry', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('! strong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'blueberry, strong' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('wheel-center'));
    expect(onCycle).not.toHaveBeenCalled();

    rerender(<FlavorWheel path={['Fruit']} tags={{ [B]: 3 }} onPath={onPath} onCycle={onCycle} />);
    expect(screen.getByText('1 in')).toBeInTheDocument();
  });
});

describe('FlavorPicker', () => {
  it('shows the tray grouped by family with the sentence, removes, and jumps the wheel', () => {
    const onRemove = vi.fn();
    const onPath = vi.fn();
    render(<FlavorPicker coffeeLabel="Guji" tags={{ [B]: 3, Floral: 2 }} onCycle={() => {}} onRemove={onRemove} path={[]} onPath={onPath} />);
    const tray = screen.getByTestId('picked-tray');
    expect(within(tray).getByText('Picked · Guji')).toBeInTheDocument();
    expect(within(tray).getByText('2 of 5 — tap to remove')).toBeInTheDocument();
    expect(screen.getByTestId('auto-sentence')).toHaveTextContent('Mostly blueberry, with a hint of Floral.');
    fireEvent.click(within(tray).getByRole('button', { name: 'Remove blueberry' }));
    expect(onRemove).toHaveBeenCalledWith(B);
    fireEvent.click(within(tray).getByRole('button', { name: 'Open Fruit' }));
    expect(onPath).toHaveBeenCalledWith(['Fruit']);
    expect(screen.getByText('10 families — tap one to open it')).toBeInTheDocument();
  });

  it('breadcrumb, back and All navigate the path', () => {
    const onPath = vi.fn();
    render(<FlavorPicker coffeeLabel="Guji" tags={{}} onCycle={() => {}} onRemove={() => {}} path={['Fruit', 'Berry']} onPath={onPath} />);
    expect(screen.getByText('6 under Berry · tap the center to take "Berry" as is')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onPath).toHaveBeenLastCalledWith(['Fruit']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onPath).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole('button', { name: 'Fruit' }));
    expect(onPath).toHaveBeenLastCalledWith(['Fruit']);
  });

  it('search lists matching terms and picks through onCycle', () => {
    const onCycle = vi.fn();
    render(<FlavorPicker coffeeLabel="Guji" tags={{}} onCycle={onCycle} onRemove={() => {}} path={[]} onPath={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByLabelText('Search flavors'), { target: { value: 'blueb' } });
    fireEvent.click(screen.getByText('blueberry'));
    expect(onCycle).toHaveBeenCalledWith(B);
  });
});
