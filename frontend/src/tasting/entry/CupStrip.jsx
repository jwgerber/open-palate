/**
 * The bottom cup strip — one 44px tile per cup, the most frequent action in
 * a flight, so it lives in the thumb zone above the CTA. A dot marks a cup
 * that already has its Overall.
 */
import { memo } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

const shortName = (label) => (label || '').split(' ').slice(0, 2).join(' ');

function CupStrip({ cups, cur, onSelect }) {
  if (!cups || cups.length < 2) return null;
  return (
    <Box sx={{ display: 'flex', gap: 0.75 }} role="group" aria-label="Cups">
      {cups.map((c, i) => {
        const on = i === cur;
        return (
          <ButtonBase
            key={c.id}
            aria-pressed={on}
            onClick={() => onSelect(i)}
            sx={{
              flex: 1, minWidth: 0, height: 44, borderRadius: 2, gap: 0.75, px: 1,
              border: '1px solid', borderColor: on ? 'transparent' : 'divider',
              bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.12) : t.palette.background.paper),
              color: on ? 'primary.dark' : 'text.primary',
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, bgcolor: c.scored ? 'primary.main' : 'divider' }} data-testid={`cup-dot-${c.id}`} data-scored={c.scored ? '1' : '0'} />
            <Typography noWrap sx={{ fontSize: 13, fontWeight: on ? 600 : 500 }}>{shortName(c.label)}</Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export default memo(CupStrip);
