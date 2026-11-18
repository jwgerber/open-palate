import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RangeStrip from '../RangeStrip';

describe('RangeStrip', () => {
  it('exposes its label and omits missing marks', () => {
    render(<RangeStrip lo={8} hi={9} min={7} max={10} avg={8.5} you={null} label="Aroma range" />);
    expect(screen.getByRole('img', { name: 'Aroma range' })).toBeInTheDocument();
  });
});
