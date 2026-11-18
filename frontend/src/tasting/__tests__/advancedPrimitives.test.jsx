import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { advancedValueFromPointer, advancedPct, advancedNudge, advancedHints } from '../advanced/advancedSlider';
import AdvancedScoreRow from '../advanced/AdvancedScoreRow';
import { ADV_GUIDANCE } from '../content';

describe('advancedSlider helpers', () => {
  const rect = { left: 100, width: 200 };
  it('maps pointer x to 7.5-10 snapped to the step', () => {
    expect(advancedValueFromPointer(100 + 64, rect, 0.1)).toBe(8.3);
    expect(advancedValueFromPointer(100 + 64, rect, 0.5)).toBe(8.5);
    expect(advancedValueFromPointer(-50, rect, 0.1)).toBe(7.5);
    expect(advancedValueFromPointer(900, rect, 0.1)).toBe(10);
  });
  it('advancedPct spans 7.5-10 and parks null and D/Q at the 8.0 position', () => {
    expect(advancedPct(7.5)).toBe(0);
    expect(advancedPct(10)).toBe(100);
    expect(advancedPct(null)).toBe(20);
    expect(advancedPct(7)).toBe(20);
  });
  it('advancedNudge uses tenths arithmetic and clamps', () => {
    expect(advancedNudge(8.2, 0.1, 0.1)).toBe(8.3);
    expect(advancedNudge(10, 0.1, 0.1)).toBe(10);
    expect(advancedNudge(7.5, -0.1, 0.1)).toBe(7.5);
    expect(advancedNudge(null, 0.1, 0.1)).toBe(8.1);
  });
  it('advancedHints follows the mockup', () => {
    expect(advancedHints(null, false)).toEqual(['plus', 'minus']);
    expect(advancedHints(8.5, false)).toEqual(['plus']);
    expect(advancedHints(7.8, false)).toEqual(['minus']);
    expect(advancedHints(8, false)).toEqual(['clean']);
    expect(advancedHints(7, false)).toEqual(['dq']);
    expect(advancedHints(8.5, true)).toEqual(['plus', 'minus', 'dq']);
  });
});

describe('AdvancedScoreRow', () => {
  it('D/Q pill sets 7 and toggles back to null', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AdvancedScoreRow cat="acidity" value={null} step={0.5} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /D\/Q/ }));
    expect(onChange).toHaveBeenLastCalledWith('acidity', 7);
    rerender(<AdvancedScoreRow cat="acidity" value={7} step={0.5} onChange={onChange} />);
    expect(screen.getAllByText('D/Q').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /D\/Q/ }));
    expect(onChange).toHaveBeenLastCalledWith('acidity', null);
  });
  describe('pointer input', () => {
    const rect = { left: 0, width: 250, top: 0, height: 36, right: 250, bottom: 36 };
    const setup = () => {
      const onChange = vi.fn();
      render(<AdvancedScoreRow cat="aroma" value={null} step={0.5} onChange={onChange} />);
      const slider = screen.getByRole('slider');
      slider.getBoundingClientRect = () => rect;
      return { onChange, slider };
    };
    const ptr = (pointerType, x = 100, y = 10) => ({ pointerType, pointerId: 1, clientX: x, clientY: y, button: 0, buttons: 1 });

    it('mouse pointerdown commits immediately', () => {
      const { onChange, slider } = setup();
      fireEvent.pointerDown(slider, ptr('mouse', 250));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('aroma', 10);
    });
    it('touch pointerdown alone commits nothing', () => {
      const { onChange, slider } = setup();
      fireEvent.pointerDown(slider, ptr('touch'));
      expect(onChange).not.toHaveBeenCalled();
    });
    it('touch down then cancel (browser took the pan) commits nothing', () => {
      const { onChange, slider } = setup();
      fireEvent.pointerDown(slider, ptr('touch'));
      fireEvent.pointerCancel(slider, ptr('touch'));
      fireEvent.pointerUp(slider, ptr('touch'));
      expect(onChange).not.toHaveBeenCalled();
    });
    it('touch tap (down then up) commits once with the snapped value', () => {
      const { onChange, slider } = setup();
      fireEvent.pointerDown(slider, ptr('touch', 250));
      fireEvent.pointerUp(slider, ptr('touch', 250));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('aroma', 10);
    });
    it('touch horizontal drag commits on move, vertical drift does not', () => {
      const { onChange, slider } = setup();
      fireEvent.pointerDown(slider, ptr('touch', 100, 10));
      fireEvent.pointerMove(slider, ptr('touch', 103, 30));
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.pointerMove(slider, ptr('touch', 150, 12));
      expect(onChange).toHaveBeenCalled();
    });
  });

  it('ArrowRight moves one step from 8.0', () => {
    const onChange = vi.fn();
    render(<AdvancedScoreRow cat="aroma" value={8} step={0.5} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemin', '7.5');
    expect(slider).toHaveAttribute('aria-valuenow', '8');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('aroma', 8.5);
  });
  it('nudge buttons exist only at step 0.1', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AdvancedScoreRow cat="aroma" value={8} step={0.5} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: /increase/i })).toBeNull();
    rerender(<AdvancedScoreRow cat="aroma" value={8} step={0.1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /increase/i }));
    expect(onChange).toHaveBeenLastCalledWith('aroma', 8.1);
    fireEvent.click(screen.getByRole('button', { name: /decrease/i }));
    expect(onChange).toHaveBeenLastCalledWith('aroma', 7.9);
  });
  it('untouched row shows both guidance lines and a dash', () => {
    render(<AdvancedScoreRow cat="sweetness" value={null} step={0.5} onChange={() => {}} />);
    expect(screen.getByText(new RegExp(ADV_GUIDANCE.sweetness.plus))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ADV_GUIDANCE.sweetness.minus))).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('slider')).not.toHaveAttribute('aria-valuenow');
  });
  it('D/Q state omits aria-valuenow and reads Disqualified', () => {
    render(<AdvancedScoreRow cat="aroma" value={7} step={0.5} onChange={() => {}} />);
    const slider = screen.getByRole('slider');
    expect(slider).not.toHaveAttribute('aria-valuenow');
    expect(slider).toHaveAttribute('aria-valuetext', 'Disqualified');
  });
  it('clean 8.0 shows the fixed line; the (i) toggle opens all three', () => {
    render(<AdvancedScoreRow cat="sweetness" value={8} step={0.5} onChange={() => {}} />);
    expect(screen.getByText('Clean — nothing wrong, nothing special.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /guidance/i }));
    expect(screen.getByText(new RegExp(ADV_GUIDANCE.sweetness.dq))).toBeInTheDocument();
  });
});
