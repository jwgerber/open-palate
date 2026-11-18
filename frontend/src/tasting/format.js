/** Tiny pure formatters shared across the Tasting screens. */
import { PREP_LABELS } from './content';

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** The lowercase prep word for a meta line: "cupping", "drip", "espresso". */
export const prepWord = (prep) => (prep === 'cupping' ? 'cupping' : (PREP_LABELS[prep] || prep || '').toLowerCase());

/** A 1–5 score as a percentage along an axis ("0%" … "100%"). */
export const scalePct = (v) => `${((v - 1) / 4) * 100}%`;

/** One row error as a line: "Row 3 · coffee: no match · Day 1", or "File: ..." when it has no
 *  row. The trailing flight name appears only on flight-import errors. */
export function rowErrorText(err) {
  const where = err.row != null ? `Row ${err.row}` : 'File';
  const line = `${err.column ? `${where} · ${err.column}` : where}: ${err.message}`;
  return err.flight ? `${line} · ${err.flight}` : line;
}
