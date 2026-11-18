/** A MUI Chip used as a pressed/unpressed toggle (filters, process). */
import { Chip } from '@mui/material';

export default function ToggleChip({ on, label, onClick, sx }) {
  return (
    <Chip
      label={label}
      clickable
      onClick={onClick}
      aria-pressed={on}
      color={on ? 'primary' : 'default'}
      variant={on ? 'filled' : 'outlined'}
      sx={{ minHeight: 36, ...sx }}
    />
  );
}
