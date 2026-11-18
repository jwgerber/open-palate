/**
 * The bar vote: three 56px radio buttons (Yes / Maybe / No) with a one-line
 * gloss each. Separate from the scores. Tapping the lit one again clears it.
 */
import { memo } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { focusRing, shadeText } from '../bits/a11y';
import { BAR_VOTES, BAR_VOTE_LABELS } from '../content';

const GLOSS = { yes: 'serve it', maybe: 'not sure', no: 'pass' };

function AdvancedVote({ value, onChange }) {
  return (
    <Box>
      <Box role="radiogroup" aria-label="Bar vote" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
        {BAR_VOTES.map((v) => {
          const on = value === v;
          return (
            <ButtonBase
              key={v}
              role="radio"
              aria-checked={on}
              aria-label={`${BAR_VOTE_LABELS[v]}, ${GLOSS[v]}`}
              onClick={() => onChange(on ? null : v)}
              sx={{
                minHeight: 56, borderRadius: 2, flexDirection: 'column',
                border: on ? '2px solid' : '1px solid', borderColor: on ? 'primary.main' : 'divider',
                bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.12) : t.palette.background.paper),
                color: on ? shadeText('primary') : 'text.primary',
                ...focusRing,
              }}
            >
              <Typography component="span" sx={{ fontSize: 16, fontWeight: 600 }}>{BAR_VOTE_LABELS[v]}</Typography>
              <Typography component="span" variant="caption" color="text.secondary">{GLOSS[v]}</Typography>
            </ButtonBase>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        Your gut call, separate from the scores.
      </Typography>
    </Box>
  );
}

export default memo(AdvancedVote);
