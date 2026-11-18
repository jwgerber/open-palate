/**
 * The "Overall" headline a coffee's consensus opens with: eyebrow + count,
 * the big average beside a star, ± spread, and a right-hand slot (the
 * caller's own stars on the reveal, the trend on the coffee page).
 */
import { Box, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import Eyebrow from './Eyebrow';

export function BigNumber({ children, size = 34, sx, ...rest }) {
  return (
    <Typography sx={{ fontFamily: (t) => t.typography.h1.fontFamily, fontWeight: 600, fontSize: size, lineHeight: 1, ...sx }} {...rest}>
      {children}
    </Typography>
  );
}

export default function ConsensusHeadline({ consensus, countLabel, spreadSuffix = '', trailing }) {
  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow>Overall</Eyebrow>
        <Typography variant="caption" color="text.secondary">{countLabel}</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BigNumber>{consensus.avg_overall.toFixed(1)}</BigNumber>
          <StarIcon sx={{ fontSize: 28 }} />
          <Typography variant="body2" color="text.secondary">± {consensus.spread.toFixed(1)}{spreadSuffix}</Typography>
        </Box>
        {trailing}
      </Box>
    </>
  );
}
