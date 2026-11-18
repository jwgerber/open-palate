// Pure page model for the printed Advanced cupping sheets (no React).
// Column heads come ONLY from flight.cups[].label, so a blind flight never
// prints a coffee name, roaster or origin.
import { toGroupTime, getGroupTimezone } from '../../time';

export const CUPS_PER_PAGE = 6;

const BLANK_CUP = 'Cup ___';

// The 1.375in label column fits ~22 characters at 8.5pt; hints are one line, so cap with margin.
export const PRINT_HINT_MAX = 20;

export const PRINT_HINTS = {
  aroma: 'dry + at the break',
  flavour: 'through the nose',
  aftertaste: 'after you swallow',
  acidity: 'bright vs sour',
  sweetness: 'sweet without sugar',
  bitterness: 'pleasant vs harsh',
  weight: 'full vs watery',
  texture: 'smooth vs rough',
  afterfeel: 'clean vs drying',
  balance: 'does it all fit?',
};

export const qrPayload = (flightId, page) => `palate-cupping:v1:${flightId}:${page}`;

export function scaleHint(step) {
  if (step == null) return 'Score 7.5–10. 8 = clean. Below 7.5: tick D/Q.';
  const unit = step === 0.1 ? 'tenths' : 'halves';
  return `Score 7.5–10 in ${unit}. 8 = clean. Below 7.5: tick D/Q.`;
}

// Reads blind_label, never label: label becomes the coffee name once a blind flight closes.
function cupMark(blind, cup) {
  if (!blind) return String(cup.position);
  return cup.blind_label ?? String.fromCharCode(64 + cup.position);
}

function cupRange(blind, chunk) {
  if (!chunk.length) return '';
  const first = cupMark(blind, chunk[0]);
  const last = cupMark(blind, chunk[chunk.length - 1]);
  return chunk.length === 1 ? `Cup ${first}` : `Cups ${first}–${last}`;
}

function flightPages(flight) {
  const sorted = [...flight.cups].sort((a, b) => a.position - b.position);
  const pages = Math.max(1, Math.ceil(sorted.length / CUPS_PER_PAGE));
  const date = toGroupTime(flight.opened_at, getGroupTimezone())?.format('ddd MMM D') ?? '';
  const mode = flight.is_blind ? 'blind' : 'sighted';
  return Array.from({ length: pages }, (_, i) => {
    const start = i * CUPS_PER_PAGE;
    const chunk = sorted.slice(start, start + CUPS_PER_PAGE);
    const range = cupRange(flight.is_blind, chunk);
    const meta = [date, mode, `page ${i + 1} of ${pages}`, range]
      .filter(Boolean)
      .join(' · ');
    return {
      kind: 'front',
      page: i + 1,
      pages,
      cups: chunk.map((c) => c.label),
      qr: qrPayload(flight.id, i + 1),
      header: { title: flight.name || 'Cupping', meta, step: flight.adv_step },
    };
  });
}

const blankPage = () => ({
  kind: 'front',
  page: 1,
  pages: 1,
  cups: Array(CUPS_PER_PAGE).fill(BLANK_CUP),
  qr: null,
  header: { title: 'Cupping', meta: null, step: null },
});

/** flight === null gives the blank sheet. */
export function sheetPages(flight, { back }) {
  const fronts = flight ? flightPages(flight) : [blankPage()];
  return fronts.flatMap((p) => (back ? [p, { kind: 'back' }] : [p]));
}
