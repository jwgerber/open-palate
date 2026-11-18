/** Pure helpers for the Coffees / coffee page / palate views — no components here. */
import { KIND_LABELS, PROCESS_LABELS, ROAST_LABELS } from '../content';

export function sectionsFor(coffees, { filter }) {
  let rows = coffees;
  if (filter.startsWith('roaster:')) {
    const r = filter.slice(8);
    rows = rows.filter((c) => c.roaster === r);
  } else if (filter === 'mine') {
    rows = rows.filter((c) => c.tasted_by_me);
  }
  return [
    { key: 'bar', label: 'On bar', rows: rows.filter((c) => c.kind === 'house') },
    { key: 'lot', label: 'Cupping lots', rows: rows.filter((c) => c.kind === 'cupping_lot') },
    { key: 'ext', label: 'Somewhere else', rows: rows.filter((c) => c.kind === 'external') },
  ].filter((s) => s.rows.length);
}

const FACT_ORDER = ['roaster', 'origin', 'region', 'process', 'roast_level', 'variety', 'altitude', 'kind'];
const FACT_LABEL = {
  process: (v) => PROCESS_LABELS[v] || v,
  roast_level: (v) => `${ROAST_LABELS[v] || v} roast`,
  kind: (v) => KIND_LABELS[v] || v,
};
const BLANK_HINT = { origin: 'origin', region: 'region', process: 'process', roast_level: 'roast', variety: 'variety', altitude: 'altitude' };

export function factChips(coffee) {
  return FACT_ORDER.filter((k) => coffee[k]).map((k) => ({ key: k, label: (FACT_LABEL[k] || ((v) => v))(coffee[k]) }));
}
export function blankFacts(coffee) {
  return Object.keys(BLANK_HINT).filter((k) => !coffee[k]).map((k) => BLANK_HINT[k]);
}

export function formFor(coffee) {
  return {
    origin: coffee?.origin || '', region: coffee?.region || '', variety: coffee?.variety || '',
    altitude: coffee?.altitude || '', lot_code: coffee?.lot_code || '', process: coffee?.process || null,
    roast_level: coffee?.roast_level || null, kind: coffee?.kind || 'house',
    notes: coffee?.notes || '',
  };
}

export function biasSentence(bias) {
  if (bias == null) return 'Not enough shared coffees yet.';
  if (Math.abs(bias) < 0.3) return "You're right on the room.";
  return bias > 0 ? 'You run a little generous.' : 'You run a little tough.';
}
export const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}`);
