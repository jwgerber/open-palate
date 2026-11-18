import { describe, expect, it } from 'vitest';
import { closesText } from '../log/logTabSupport';

const naiveUtc = (ms) => new Date(ms).toISOString().slice(0, 19);

describe('closesText', () => {
  it('reads as part of a sentence when the flight closes today', () => {
    expect(closesText(naiveUtc(Date.now()))).toMatch(/^today at \d{1,2}:\d{2}[ap]m$/);
  });

  it('names the day when the flight closes later', () => {
    const text = closesText(naiveUtc(Date.now() + 48 * 3600 * 1000));
    expect(text).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d{2}[ap]m$/);
  });

  it('is empty when the flight has no closing time', () => {
    expect(closesText(null)).toBe('');
  });
});
