import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AttributeSlider from '../entry/AttributeSlider';
import { valueFromPointer } from '../entry/sliderMath';
import OverallStars from '../entry/OverallStars';
import CupStrip from '../entry/CupStrip';
import DefectsCard from '../entry/DefectsCard';
import TermChip from '../entry/TermChip';

describe('AttributeSlider', () => {
  it('maps pointer x to five snapping stops', () => {
    const rect = { left: 100, width: 200 };
    expect(valueFromPointer(100, rect)).toBe(1);
    expect(valueFromPointer(124, rect)).toBe(1);
    expect(valueFromPointer(126, rect)).toBe(2);
    expect(valueFromPointer(200, rect)).toBe(3);
    expect(valueFromPointer(300, rect)).toBe(5);
    expect(valueFromPointer(900, rect)).toBe(5);
    expect(valueFromPointer(-5, rect)).toBe(1);
  });

  it('shows no word untouched, then the word for the value, and moves by keyboard', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AttributeSlider label="Acidity" attr="acidity" value={null} onChange={onChange} />);
    expect(screen.getByTestId('word-acidity')).toHaveTextContent('');
    const slider = screen.getByRole('slider', { name: 'Acidity' });
    expect(slider).not.toHaveAttribute('aria-valuenow');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('acidity', 4);   // from the implicit midpoint
    rerender(<AttributeSlider label="Acidity" attr="acidity" value={3} onChange={onChange} />);
    expect(screen.getByTestId('word-acidity')).toHaveTextContent('bright');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('acidity', 2);
  });

  it('only follows a move while the primary button is held', () => {
    const onChange = vi.fn();
    render(<AttributeSlider label="Body" attr="body" value={null} onChange={onChange} />);
    const slider = screen.getByTestId('slider-body');
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 });
    fireEvent.pointerMove(slider, { clientX: 100, buttons: 0 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(slider, { clientX: 100, button: 0 });
    expect(onChange).toHaveBeenLastCalledWith('body', 5);
    // The rect is captured on pointer-down and not re-read mid-drag.
    slider.getBoundingClientRect = () => { throw new Error('re-read mid-drag'); };
    fireEvent.pointerMove(slider, { clientX: 0, buttons: 1 });
    expect(onChange).toHaveBeenLastCalledWith('body', 1);
  });
});

describe('OverallStars', () => {
  it('lights stars up to the value, words it, and clears on tapping the lit star', () => {
    const onChange = vi.fn();
    const { rerender } = render(<OverallStars value={null} onChange={onChange} />);
    expect(screen.getByText('required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^4 stars/ }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    rerender(<OverallStars value={4} onChange={onChange} />);
    expect(screen.queryByText('required')).not.toBeInTheDocument();
    expect(screen.getByTestId('word-overall')).toHaveTextContent('really good');
    fireEvent.click(screen.getByRole('radio', { name: /^4 stars/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('CupStrip', () => {
  it('renders nothing for one cup, and a dot per scored cup for more', () => {
    const { container, rerender } = render(<CupStrip cups={[{ id: 1, label: 'Guji' }]} cur={0} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    const onSelect = vi.fn();
    rerender(<CupStrip cups={[{ id: 1, label: 'Guji Shakiso Natural', scored: true }, { id: 2, label: 'Winter Blend', scored: false }]} cur={0} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Guji Shakiso' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cup-dot-1')).toHaveAttribute('data-scored', '1');
    expect(screen.getByTestId('cup-dot-2')).toHaveAttribute('data-scored', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Winter Blend' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe('DefectsCard', () => {
  it('counts noted defects and toggles them', () => {
    const onToggle = vi.fn();
    render(<DefectsCard defects={{ papery: 1 }} onToggle={onToggle} />);
    expect(screen.getByText('1 noted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Defects/ }));
    fireEvent.click(screen.getByText('musty'));
    expect(onToggle).toHaveBeenCalledWith('musty');
  });
});

describe('TermChip', () => {
  it('renders the label, a strong mark and a remove button', () => {
    const onRemove = vi.fn();
    render(<TermChip term="Fruity>Berry>blueberry" strength={3} onRemove={onRemove} />);
    expect(screen.getByText('blueberry !')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove blueberry' }));
    expect(onRemove).toHaveBeenCalledWith('Fruity>Berry>blueberry');
  });
});
