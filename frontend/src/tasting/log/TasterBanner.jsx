/**
 * Whose sheet is on a shared device's scoring screens. The tablet is passed
 * around: without this line the next person could finish and log the last
 * taster's half-done sheet under that taster's name.
 */
import { Box, Button, Typography } from '@mui/material';

export default function TasterBanner({ name, onSwitch }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.5, flexShrink: 0,
      borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover',
    }}>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>Tasting as {name}</Typography>
      <Button size="small" onClick={onSwitch}>Not you?</Button>
    </Box>
  );
}
