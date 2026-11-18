/** The 11px letterspaced overline every section in the module opens with. */
import { Typography } from '@mui/material';

export default function Eyebrow({ children, sx }) {
  return (
    <Typography variant="overline" sx={{ fontSize: 11, letterSpacing: '0.1em', lineHeight: 1.4, color: 'text.secondary', display: 'block', ...sx }}>
      {children}
    </Typography>
  );
}
