/** A value as a 0-100 percentage along [min, max], clamped so an outlier pins to the end. */
export const markerPct = (value, min, max) => Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

/** A lean as "+0.3" / "−0.3" (true minus sign); a value that rounds to zero is plain "0.0". */
export const signedLean = (n) => {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
};
