/**
 * Overall — the one required score. Five 40px stars in 52px hit areas, lit in
 * the warning (cream) colour; tapping the lit star again clears it. Marked
 * "required" in the error colour until set.
 */
import { memo } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { SCALE_WORDS } from '../content';

const WORDS = SCALE_WORDS.overall;

function OverallStars({ value, onChange, size = 40 }) {
  return (
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          Overall
          {value == null && (
            <Typography component="span" sx={{ ml: 1, fontSize: 12, fontWeight: 500, color: 'error.main' }}>required</Typography>
          )}
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'primary.main', minHeight: 20 }} data-testid="word-overall">
          {value == null ? '' : WORDS[value - 1]}
        </Typography>
      </Box>
      <Box role="radiogroup" aria-label="Overall" sx={{ display: 'flex', justifyContent: 'space-between', mx: -0.75 }}>
        {[1, 2, 3, 4, 5].map((k) => {
          const lit = value != null && k <= value;
          return (
            <IconButton
              key={k}
              role="radio"
              aria-checked={value === k}
              aria-label={`${k} star${k > 1 ? 's' : ''} — ${WORDS[k - 1]}`}
              onClick={() => onChange(value === k ? null : k)}
              sx={{ width: 52, height: 52, color: lit ? 'warning.main' : 'text.disabled' }}
            >
              {lit ? <StarIcon sx={{ fontSize: size }} /> : <StarBorderIcon sx={{ fontSize: size }} />}
            </IconButton>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">{WORDS[0]}</Typography>
        <Typography variant="caption" color="text.secondary">{WORDS[4]}</Typography>
      </Box>
    </Box>
  );
}

export default memo(OverallStars);
