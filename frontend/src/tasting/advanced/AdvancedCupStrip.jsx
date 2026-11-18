/**
 * Horizontally scrolling cup tiles for a 6-12 cup cupping: the cup letter over
 * a progress bar (scored / 10). `cups` is [{ id, letter, scored, state }].
 */
import { memo } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ADV_CATEGORIES } from '../content';
import { focusRing, shadeText } from '../bits/a11y';

// Primitive props only, so a score landing on one cup repaints one tile.
const CupTile = memo(function CupTile({ index, letter, scored, state, on, onSelect }) {
  return (
    <ButtonBase
      aria-pressed={on}
      aria-label={`Cup ${letter}, ${scored} of ${ADV_CATEGORIES.length} scored`}
      onClick={() => onSelect(index)}
      sx={{
        flexShrink: 0, width: 48, height: 48, borderRadius: 2, flexDirection: 'column', gap: 0.5,
        border: '1px solid', borderColor: on ? 'primary.main' : state === 'half' ? 'warning.main' : 'divider',
        bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.12) : t.palette.background.paper),
        color: on ? shadeText('primary') : 'text.primary',
        ...focusRing,
      }}
    >
      <Typography component="span" sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1 }}>{letter}</Typography>
      <Box sx={{ width: 28, height: 4, borderRadius: 2, bgcolor: 'divider', overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${(scored / ADV_CATEGORIES.length) * 100}%`, bgcolor: state === 'done' ? 'success.main' : 'primary.main' }} />
      </Box>
    </ButtonBase>
  );
});

function AdvancedCupStrip({ cups, cur, onSelect }) {
  if (!cups || cups.length < 2) return null;
  return (
    <Box role="group" aria-label="Cups" sx={{ display: 'flex', gap: 0.75, overflowX: 'auto' }}>
      {cups.map((c, i) => (
        <CupTile key={c.id} index={i} letter={c.letter} scored={c.scored} state={c.state} on={i === cur} onSelect={onSelect} />
      ))}
    </Box>
  );
}

export default memo(AdvancedCupStrip);
