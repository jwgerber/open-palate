import dayjs from 'dayjs';

const MINUS = '−';

/** "2026-11-05" (a group-local calendar date, not an instant) -> "Thu, Nov 5". */
export function formatSessionDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return dayjs(new Date(y, m - 1, d)).format('ddd, MMM D');
}

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** Signed one-decimal number with a true minus sign. */
export function signed(v) {
  const r = Math.round(v * 10) / 10;
  if (r > 0) return `+${r.toFixed(1)}`;
  if (r < 0) return `${MINUS}${Math.abs(r).toFixed(1)}`;
  return '0.0';
}

export const f1 = (v) => (v == null ? '—' : Number(v).toFixed(1));
