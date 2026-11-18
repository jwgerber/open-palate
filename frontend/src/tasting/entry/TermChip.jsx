/**
 * A flavor-term pill: family tint, dashed primary border when the term is a
 * heading (not a leaf), "!" suffix + 600 weight when strong, optional ×.
 */
import { memo } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { INDEX, tintFor, labelOf } from '../lexicon';

function TermChip({ term, strength = 2, onRemove, onClick, size = 'md', pct }) {
  const theme = useTheme();
  const info = INDEX[term];
  const leaf = info ? info.leaf : true;
  const strong = strength === 3;
  const h = size === 'sm' ? 24 : 32;
  const Root = onClick ? ButtonBase : Box;
  return (
    <Root
      onClick={onClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5, height: h, pl: 1.5, pr: onRemove ? 0.75 : 1.5,
        borderRadius: 9999, bgcolor: tintFor(term, theme.palette.mode), color: 'text.primary',
        border: '1px solid', borderColor: leaf ? 'transparent' : 'primary.main', borderStyle: leaf ? 'solid' : 'dashed',
        fontSize: size === 'sm' ? 11 : 13, fontWeight: strong ? 600 : 500, whiteSpace: 'nowrap',
      }}
    >
      <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 'inherit' }}>
        {labelOf(term)}{strong ? ' !' : ''}
      </Typography>
      {pct != null && (
        <Typography component="span" sx={{ fontSize: '0.85em', color: 'text.secondary' }}>{pct}%</Typography>
      )}
      {onRemove && (
        <ButtonBase aria-label={`Remove ${labelOf(term)}`} onClick={(e) => { e.stopPropagation(); onRemove(term); }} sx={{ borderRadius: '50%', width: 24, height: 24 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </ButtonBase>
      )}
    </Root>
  );
}

export default memo(TermChip);
