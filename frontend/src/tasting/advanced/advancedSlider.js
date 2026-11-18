import { ADV_MIN, ADV_MAX, ADV_ANCHOR } from '../content';

// All score arithmetic runs in integer tenths so 8.2 + 0.1 is exactly 8.3.
const tenths = (v) => Math.round(v * 10);
const clampScore = (t) => Math.max(tenths(ADV_MIN), Math.min(tenths(ADV_MAX), t)) / 10;

/** Map a pointer x on the track to 7.5-10, snapped to `step`. */
export const advancedValueFromPointer = (clientX, rect, step) => {
  if (!rect.width) return ADV_MIN;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const raw = tenths(ADV_MIN) + ratio * (tenths(ADV_MAX) - tenths(ADV_MIN));
  const s = tenths(step);
  return clampScore(Math.round(raw / s) * s);
};

/** 0-100 across 7.5-10. Untouched (null) and D/Q (7) park at the 8.0 position. */
export const advancedPct = (value) => {
  const v = value == null || value < ADV_MIN ? ADV_ANCHOR : value;
  return ((v - ADV_MIN) / (ADV_MAX - ADV_MIN)) * 100;
};

/** Move a score by `delta`, starting from 8.0 when untouched or D/Q. */
export const advancedNudge = (value, delta, step) => {
  const base = value == null || value < ADV_MIN ? tenths(ADV_ANCHOR) : tenths(value);
  return clampScore(base + Math.sign(delta) * tenths(step));
};

/** Which guidance lines to show under a row (mockup call 2). */
export const advancedHints = (value, open) => {
  if (open) return ['plus', 'minus', 'dq'];
  if (value == null) return ['plus', 'minus'];
  if (value < ADV_MIN) return ['dq'];
  if (value === ADV_ANCHOR) return ['clean'];
  return value > ADV_ANCHOR ? ['plus'] : ['minus'];
};
