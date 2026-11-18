/** Initial avatars and the shared-flight roster list. */
import { Avatar, Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

export function InitialAvatar({ name }) {
  return (
    <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'text.primary' }}>
      {(name || '?').slice(0, 1).toUpperCase()}
    </Avatar>
  );
}

export function Roster({ roster }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {roster.map((r) => (
        <Box key={r.taster_key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 40 }}>
          <InitialAvatar name={r.name} />
          <Typography sx={{ flex: 1, fontSize: 15 }}>{r.name}{r.is_host ? ' · host' : ''}</Typography>
          <Typography variant="caption" sx={{ color: r.status === 'logged' ? 'success.main' : 'text.secondary' }}>{r.status}</Typography>
        </Box>
      ))}
    </Box>
  );
}
