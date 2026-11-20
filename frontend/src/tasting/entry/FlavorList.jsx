/**
 * A ring too big for wedges (more than MAX_WEDGES notes, e.g. Vegetal / Earthy /
 * Herb's 22) drawn as wrapped, thumb-sized chips instead. Same taps as the wheel:
 * a chip cycles its note, and the header button takes the heading as is.
 */
import { memo } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { FAMILY_HEX, tintFor } from '../lexicon';

// Light family colours (sweet, grain) take dark ink; the rest take white.
const LIGHT_FAMILIES = new Set(['sweet', 'grain']);
export const isDarkFamily = (family) => !LIGHT_FAMILIES.has(family);

function FlavorList({ node, items, tags, atCap, covered, hereStrength, hereInside, onTapChild, onTapHeading, stateOf, mode }) {
  const hex = FAMILY_HEX[node.family];
  return (
    <Box data-testid="flavor-list" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, borderTop: `4px solid ${hex}`, pt: 1.25 }}>
      <ButtonBase
        onClick={onTapHeading}
        disabled={covered}
        aria-label={covered ? undefined : `Take ${node.label} as is${stateOf(hereStrength)}`}
        aria-pressed={covered ? undefined : !!hereStrength}
        sx={{ alignSelf: 'center', borderRadius: 9999, px: 2, minHeight: 44, border: '1px solid', borderColor: hereStrength ? 'primary.main' : 'divider' }}
      >
        <Typography sx={{ fontSize: 13, color: covered ? 'text.disabled' : 'primary.main' }}>
          {covered ? `covered by ${hereInside.map((k) => k.split('>').pop()).join(', ')}` : hereStrength ? `✓ ${node.label}` : `＋ take "${node.label}" as is`}
        </Typography>
      </ButtonBase>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
        {items.map((c) => {
          const s = tags[c.key] || 0;
          const capped = !s && atCap;
          return (
            <ButtonBase
              key={c.key}
              data-testid={`wedge-${c.key}`}
              onClick={() => onTapChild(c)}
              aria-label={`${c.label}${stateOf(s)}`}
              aria-pressed={!!s}
              aria-disabled={capped || undefined}
              sx={{
                minHeight: 44, px: 1.75, borderRadius: 9999, fontSize: 14, fontWeight: s ? 700 : 500,
                bgcolor: s ? hex : tintFor(c.key, mode), color: s ? (isDarkFamily(node.family) ? '#FFFFFF' : '#2A2630') : 'text.primary',
                border: s === 3 ? '3px solid' : '1px solid', borderColor: s ? 'text.primary' : 'divider',
                opacity: capped ? 0.45 : 1,
              }}
            >
              {c.label}{s === 3 ? ' !' : s ? ' ✓' : ''}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

export default memo(FlavorList);
