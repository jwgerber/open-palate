/**
 * A you-and-them marker on one shared scale. You are a filled dot, the room is
 * a hollow ring, so the two differ by shape and not only by color. The room is
 * left out (one marker) when there is no room number.
 */
import { Box } from '@mui/material';
import { markerPct } from './chartMath';

const SIZE = 14;
const dot = { position: 'absolute', top: 5, width: SIZE, height: SIZE, borderRadius: '50%', transform: 'translateX(-50%)', boxSizing: 'border-box' };

export default function YouVsRoom({ you, room = null, min, max, youLabel = 'You', roomLabel = 'The room' }) {
  const label = room == null
    ? `${youLabel} ${you.toFixed(1)}`
    : `${youLabel} ${you.toFixed(1)}, ${roomLabel.charAt(0).toLowerCase()}${roomLabel.slice(1)} ${room.toFixed(1)}`;
  return (
    <Box role="img" aria-label={label} sx={{ position: 'relative', height: 24, width: '100%' }}>
      <Box sx={{ position: 'absolute', left: 0, right: 0, top: 11, height: 2, bgcolor: 'divider' }} />
      {room != null && (
        <Box data-testid="marker-room" sx={{ ...dot, left: `${markerPct(room, min, max)}%`, border: '2px solid', borderColor: 'text.secondary', bgcolor: 'background.paper' }} />
      )}
      <Box data-testid="marker-you" sx={{ ...dot, left: `${markerPct(you, min, max)}%`, bgcolor: 'primary.main', boxShadow: (t) => `0 0 0 2px ${t.palette.background.paper}` }} />
    </Box>
  );
}
