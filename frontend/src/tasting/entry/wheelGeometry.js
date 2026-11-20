/** Wheel geometry — pure, so the SVG maths is testable without React. */
const SIZE = 330;
const VIEW = 304;
const R_OUTER = 138;
const R_INNER = 58;
const GAP = 0.012;

export const GEOMETRY = { SIZE, VIEW, R_OUTER, R_INNER, GAP };

function compute(i, n, R, r) {
  const a = (2 * Math.PI) / n;
  const s = -Math.PI / 2 + i * a;
  const e = s + a - GAP;
  const p = (rad, ang) => `${(rad * Math.cos(ang)).toFixed(1)},${(rad * Math.sin(ang)).toFixed(1)}`;
  const big = a > Math.PI ? 1 : 0;
  const d = `M${p(R, s)} A${R},${R} 0 ${big},1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${big},0 ${p(r, s)} Z`;
  const m = s + (a - GAP) / 2;
  const lr = (R + r) / 2;
  return { d, lx: lr * Math.cos(m), ly: lr * Math.sin(m) };
}

// (i, n) is bounded — n ≤ MAX_WEDGES (12, FlavorWheel) in any ring — so every wedge the wheel
// can ever draw fits in a few dozen cache entries, and the wedge and label
// loops stop recomputing trig and path strings on every render.
const cache = new Map();

/** Wedge i of n as an SVG path plus its label anchor (viewBox units). */
export function arc(i, n, R = R_OUTER, r = R_INNER) {
  const key = `${i}/${n}/${R}/${r}`;
  let g = cache.get(key);
  if (!g) { g = compute(i, n, R, r); cache.set(key, g); }
  return g;
}
