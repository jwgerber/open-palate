/**
 * Your lean against the room per Advanced category: a bar growing right (you scored
 * higher) or left (lower) from a centre line. Rows are the categories the
 * server sent, already in Advanced order.
 */
import { Box, Typography } from '@mui/material';
import { signedLean } from '../bits/chartMath';
import { ADV_CATEGORIES, ADV_GUIDANCE } from '../content';

const MIN_SPAN = 1;

export default function CategoryLean({ lean }) {
  const cats = ADV_CATEGORIES.filter((c) => lean[c] != null);
  const span = Math.max(MIN_SPAN, ...cats.map((c) => Math.abs(lean[c])));
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {cats.map((c) => {
        const v = lean[c];
        const half = (Math.abs(v) / span) * 50;
        return (
          <Box component="li" key={c} data-testid={`lean-${c}`} sx={{ display: 'grid', gridTemplateColumns: '84px 1fr 44px', alignItems: 'center', gap: 1, minHeight: 28 }}>
            <Typography variant="body2" noWrap>{ADV_GUIDANCE[c].label}</Typography>
            <Box aria-hidden sx={{ position: 'relative', height: 12 }}>
              <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, bgcolor: 'divider', transform: 'translateX(-50%)' }} />
              <Box
                data-testid={`lean-bar-${c}`}
                sx={{ position: 'absolute', top: 2, bottom: 2, borderRadius: 0.5, width: `${half}%`, ...(v >= 0 ? { left: '50%', bgcolor: 'primary.main' } : { right: '50%', bgcolor: 'warning.light' }) }}
              />
            </Box>
            <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 600 }}>{signedLean(v)}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}
