/**
 * Pure model for the Advanced cupping timer: which phase a cupping is in,
 * the timeline rows, and the dose maths. No React, no clock — callers pass the
 * elapsed seconds the server computed (`flight.timer_elapsed_s`).
 */

const CRUST_BREAK_S = 300;
// The spec says only "right after" the break; skimming from 7:00 is the owner-pending call.
const SKIM_S = 420;
const HOT_SOON_S = 600;

const PASSES = {
  1: { key: 'hot', name: 'Hot pass', tempF: 149, hint: '~149 °F' },
  2: { key: 'comfortable', name: 'Comfortable pass', tempF: 131, hint: '~131 °F' },
  3: { key: 'warm', name: 'Warm pass', tempF: 113, hint: '~113 °F · last pass' },
};

const SETUP = { key: 'setup', name: 'Setting up', hint: 'smell the dry grounds (fragrance)' };

export function advancedPhase(elapsedS, advancedPass) {
  if (advancedPass == null) return SETUP;
  if (advancedPass > 0) return PASSES[advancedPass];
  if (elapsedS < CRUST_BREAK_S) return { key: 'steep', name: 'Steeping', hint: 'crust breaks at 5:00' };
  if (elapsedS < SKIM_S) return { key: 'break', name: 'Break the crust', hint: '4 stirs, sniff as it breaks' };
  if (elapsedS < HOT_SOON_S) return { key: 'skim', name: 'Skim', hint: 'same order and pace' };
  return { key: 'hotSoon', name: 'Hot pass next', hint: 'check temp — under 160 °F' };
}

export const ADV_STEPS = [
  { key: 'fragrance', at: 'before', name: 'Fragrance', detail: 'Smell the dry grounds — it feeds Aroma.' },
  { key: 'pour', at: '0:00', name: 'Pour', detail: 'Same pace every bowl, about 3 a minute.' },
  { key: 'break', at: '5:00', name: 'Break the crust + sniff', detail: '4 stirs to the bottom; smell as you break. Rinse the spoon between bowls.' },
  { key: 'skim', at: 'after', name: 'Skim', detail: 'Same order and pace as the pour.' },
  { key: 'hot', at: '~10:00', name: 'Hot pass · ~149 °F', detail: 'Check temp first.' },
  { key: 'comfortable', at: 'later', name: 'Comfortable pass · ~131 °F', detail: '' },
  { key: 'warm', at: 'later', name: 'Warm pass · ~113 °F', detail: 'Last pass — finish your scores.' },
];

// Which timeline row each phase is on. Steeping is the Pour row; "hot pass next"
// already points at the Hot row.
const ROW_OF_PHASE = {
  setup: 'fragrance', steep: 'pour', break: 'break', skim: 'skim',
  hotSoon: 'hot', hot: 'hot', comfortable: 'comfortable', warm: 'warm',
};

export function stepStatus(step, phase) {
  const now = ADV_STEPS.findIndex((s) => s.key === ROW_OF_PHASE[phase.key]);
  const mine = ADV_STEPS.findIndex((s) => s.key === step.key);
  if (mine < now) return 'done';
  return mine === now ? 'now' : 'next';
}

export function nextPass(advancedPass) {
  const next = advancedPass == null ? null : PASSES[advancedPass + 1];
  return next ? { pass: advancedPass + 1, label: `${next.name} · ~${next.tempF} °F` } : null;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const GRAMS_PER_ML = 0.055;
const MIN_BOWL_ML = 150;
const MAX_BOWL_ML = 200;
const MAX_BOWLS = 6;

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const gramsPerBowl = (ml) => round1(clamp(ml, MIN_BOWL_ML, MAX_BOWL_ML) * GRAMS_PER_ML);

export const totalGrams = (ml, bowls, coffees) =>
  round1(gramsPerBowl(ml) * clamp(bowls, 1, MAX_BOWLS) * coffees);
