/** The four 1–5 attributes as label · bar · word rows (last look, your read). */
import { Box, Typography } from '@mui/material';
import { wordFor } from '../lexicon';

const BARS = [['Acidity', 'acidity'], ['Sweetness', 'sweetness'], ['Body', 'body'], ['Balance', 'balance']];

export default function AttributeBars({ vals, sx }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '64px 1fr 88px', rowGap: 0.75, columnGap: 1, alignItems: 'center', ...sx }}>
      {BARS.map(([label, attr]) => {
        const v = vals?.[attr];
        return [
          <Typography key={`${attr}-l`} variant="caption" color="text.secondary">{label}</Typography>,
          <Box key={`${attr}-b`} sx={{ height: 6, borderRadius: 3, bgcolor: (t) => t.palette.action.hover, overflow: 'hidden' }}>
            {v != null && <Box sx={{ width: `${v * 20}%`, height: '100%', bgcolor: 'primary.main' }} />}
          </Box>,
          <Typography key={`${attr}-w`} variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>{v == null ? '—' : wordFor(attr, v)}</Typography>,
        ];
      })}
    </Box>
  );
}
