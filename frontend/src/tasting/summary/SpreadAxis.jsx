/**
 * One category on a D/Q-to-max axis (7–10): the min–max band, an avg tick, a faint line at
 * the clean 8, and (for a non-named viewer) a hollow dot for the viewer's own
 * score. `stat` is {avg,min,max}; `you` is a number or null.
 */
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ADV_ANCHOR, ADV_DQ_VALUE, ADV_GUIDANCE, ADV_MAX } from '../content';

const LO = ADV_DQ_VALUE;
const HI = ADV_MAX;
const pct = (v) => `${((Math.min(HI, Math.max(LO, v)) - LO) / (HI - LO)) * 100}%`;

export default function SpreadAxis({ cat, stat, you = null }) {
  const label = ADV_GUIDANCE[cat]?.label ?? cat;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" sx={{ width: 76, flexShrink: 0 }}>{label}</Typography>
      <Box
        role="img"
        aria-label={`${label}: average ${stat.avg.toFixed(1)}, range ${stat.min.toFixed(1)} to ${stat.max.toFixed(1)}${you != null ? `, you ${you.toFixed(1)}` : ''}`}
        sx={{ position: 'relative', flex: 1, height: 22 }}
      >
        <Box sx={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, bgcolor: 'divider' }} />
        <Box sx={{ position: 'absolute', top: 3, bottom: 3, left: pct(ADV_ANCHOR), width: '1px', bgcolor: 'text.secondary', opacity: 0.5 }} />
        <Box sx={{
          position: 'absolute', top: 5, height: 12, borderRadius: 6, left: pct(stat.min),
          width: `calc(${pct(stat.max)} - ${pct(stat.min)})`, minWidth: 6,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.2),
        }} />
        <Box sx={{ position: 'absolute', top: 2, width: 2, height: 18, bgcolor: 'primary.main', left: pct(stat.avg), transform: 'translateX(-50%)' }} />
        {you != null && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute', top: 3, width: 16, height: 16, borderRadius: '50%', border: '2px solid',
              borderColor: you === ADV_DQ_VALUE ? 'error.main' : 'text.primary', bgcolor: 'background.paper',
              left: pct(you), transform: 'translateX(-50%)',
            }}
          />
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ width: 30, textAlign: 'right' }}>{stat.avg.toFixed(1)}</Typography>
    </Box>
  );
}
