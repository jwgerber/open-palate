/**
 * "How you score vs the table": one diverging bar per category (-1..+1 around
 * the table's mean) and one sentence naming the categories beyond +-0.5.
 * `calibration` is {category: delta} for the categories that had enough other
 * reads, or null (nothing to compare) — then this renders nothing.
 */
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Card from '../bits/Card';
import Eyebrow from '../bits/Eyebrow';
import { ADV_CATEGORIES, ADV_GUIDANCE } from '../content';

const OUTLIER = 0.5;
const RANGE = 1;

const signed = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]);

function calibrationSentence(calibration) {
  const names = (sign) => ADV_CATEGORIES
    .filter((c) => calibration[c] != null && sign * calibration[c] > OUTLIER)
    .map((c) => ADV_GUIDANCE[c].label.toLowerCase());
  const parts = [[names(1), 'higher'], [names(-1), 'lower']]
    .filter(([n]) => n.length)
    .map(([n, dir]) => `${joinNames(n)} ${dir}`);
  return parts.length ? `You score ${parts.join(' and ')} than the table.` : 'You score close to the table.';
}

function DeltaBar({ cat, delta }) {
  const label = ADV_GUIDANCE[cat].label;
  const clamped = Math.max(-RANGE, Math.min(RANGE, delta));
  const half = `${(Math.abs(clamped) / RANGE) * 50}%`;
  const desc = delta === 0 ? 'level with the table' : `${Math.abs(delta).toFixed(1)} ${delta > 0 ? 'above' : 'below'} the table`;
  return (
    <Box role="img" aria-label={`${label}: ${desc}`} sx={{ display: 'grid', gridTemplateColumns: '84px 1fr 40px', alignItems: 'center', gap: 1, minHeight: 28 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: (t) => t.palette.action.hover }}>
        <Box sx={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: '1px', bgcolor: 'divider' }} />
        <Box sx={{
          position: 'absolute', top: 0, height: 8, width: half,
          left: delta >= 0 ? '50%' : `calc(50% - ${half})`,
          borderRadius: 4,
          bgcolor: (t) => (Math.abs(delta) > OUTLIER ? t.palette.primary.main : alpha(t.palette.primary.main, 0.4)),
        }} />
      </Box>
      <Typography variant="caption" sx={{ textAlign: 'right' }}>{signed(delta)}</Typography>
    </Box>
  );
}

export default function CalibrationBlock({ calibration }) {
  if (!calibration) return null;
  const cats = ADV_CATEGORIES.filter((c) => calibration[c] != null);
  if (!cats.length) return null;
  return (
    <Card data-testid="calibration">
      <Eyebrow sx={{ mb: 1 }}>You vs the table</Eyebrow>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        {cats.map((c) => <DeltaBar key={c} cat={c} delta={calibration[c]} />)}
      </Box>
      <Typography sx={{ mt: 1.5 }}>{calibrationSentence(calibration)}</Typography>
    </Card>
  );
}
