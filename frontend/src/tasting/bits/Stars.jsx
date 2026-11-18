/**
 * A read-only five-star row for a score OR an average: whole stars filled
 * (an average rounds), the rest outlined; a dash when there is no value.
 */
import { Box, Typography } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';

export default function Stars({ value, size = 18 }) {
  if (value == null) return <Typography component="span" color="text.disabled" aria-label="no overall">—</Typography>;
  const full = Math.round(value);
  const label = Number.isInteger(value) ? `${value} of 5 stars` : `${value.toFixed(1)} of 5 stars`;
  return (
    <Box role="img" sx={{ display: 'inline-flex', color: 'warning.main' }} aria-label={label}>
      {[1, 2, 3, 4, 5].map((k) => (k <= full
        ? <StarIcon key={k} sx={{ fontSize: size }} />
        : <StarBorderIcon key={k} sx={{ fontSize: size, opacity: 0.35 }} />))}
    </Box>
  );
}
