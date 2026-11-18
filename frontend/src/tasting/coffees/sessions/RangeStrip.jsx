/** Range strip: bar = low-high, tick = others' average, dot = you, on a fixed domain. */
import { Box } from '@mui/material';

const pct = (v, min, max) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));

export default function RangeStrip({ lo, hi, min, max, avg, you, label }) {
  const p = (v) => pct(v, min, max);
  const hasRange = lo != null && hi != null;
  return (
    <Box role="img" aria-label={label} sx={{ position: 'relative', height: 18, width: '100%' }}>
      <Box sx={{ position: 'absolute', left: 0, right: 0, top: 8, height: 2, bgcolor: 'divider' }} />
      {hasRange && (
        <Box sx={{
          position: 'absolute', top: 5, height: 8, borderRadius: 1,
          bgcolor: 'action.disabledBackground', left: `${p(lo)}%`, width: `${Math.max(1.5, p(hi) - p(lo))}%`,
        }}
        />
      )}
      {avg != null && (
        <Box sx={{ position: 'absolute', top: 1, width: 2, height: 16, bgcolor: 'text.secondary', left: `${p(avg)}%`, transform: 'translateX(-50%)' }} />
      )}
      {you != null && (
        <Box sx={{
          position: 'absolute', top: 3, width: 12, height: 12, borderRadius: '50%', boxSizing: 'border-box',
          bgcolor: 'primary.main', border: '2px solid', borderColor: 'background.paper',
          left: `${p(you)}%`, transform: 'translateX(-50%)',
        }}
        />
      )}
    </Box>
  );
}
