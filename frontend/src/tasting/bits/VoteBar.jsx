/** A stacked yes / maybe / no bar with the counts spelled out beneath. Renders nothing with no votes. */
import { Box, Typography } from '@mui/material';

const PARTS = [['yes', 'success.main'], ['maybe', 'warning.main'], ['no', 'error.main']];

export default function VoteBar({ votes }) {
  const total = PARTS.reduce((sum, [k]) => sum + (votes[k] || 0), 0);
  if (!total) return null;
  const text = PARTS.map(([k]) => `${votes[k] || 0} ${k}`).join(' · ');
  return (
    <Box>
      <Box aria-hidden sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', gap: '2px' }}>
        {PARTS.map(([k, color]) => (votes[k] ? <Box key={k} sx={{ flex: votes[k], bgcolor: color }} /> : null))}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{text}</Typography>
    </Box>
  );
}
