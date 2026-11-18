/**
 * Photograph (or choose) a printed Advanced sheet to pre-fill paper entry. One page: picking a photo reads it
 * at once. Two pages: collect both, then "Read the sheet". The input has no `capture` attribute so iOS
 * offers both the camera and the photo library.
 */
import { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import CameraAltOutlinedIcon from '@mui/icons-material/CameraAltOutlined';

export default function ScanBlock({ pages, online, busy, error, onRead }) {
  const inputRef = useRef(null);
  const [photos, setPhotos] = useState([]);
  const disabled = !online || busy;

  const onPick = (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = ''; // the same photo can be chosen again
    if (!file) return;
    if (pages === 1) { onRead([file]); return; }
    // A third pick starts over rather than silently replacing one page.
    setPhotos((prev) => (prev.length < pages ? [...prev, file] : [file]));
  };

  const next = photos.length < pages ? photos.length + 1 : null;
  const pickLabel = pages === 1 ? 'Scan the sheet' : photos.length === 0 ? 'Photo of page 1' : next ? `Add page ${next}` : 'Start over';

  return (
    <Box sx={{ mb: 3 }} aria-busy={busy}>
      <input ref={inputRef} type="file" accept="image/*" hidden data-testid="scan-input" aria-label="Photo of the paper sheet" onChange={onPick} />
      {pages > 1 && photos.map((_, i) => (
        <Typography key={i} sx={{ fontSize: 14, mb: 0.5 }}>{`Photo of page ${i + 1} ✓`}</Typography>
      ))}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined" disabled={disabled} onClick={() => inputRef.current?.click()}
          startIcon={busy ? <CircularProgress size={18} /> : <CameraAltOutlinedIcon />} sx={{ minHeight: 48 }}
        >
          {busy ? 'Reading…' : pickLabel}
        </Button>
        {pages > 1 && (
          <Button variant="contained" disabled={disabled || photos.length === 0} onClick={() => onRead(photos)} sx={{ minHeight: 48 }}>
            Read the sheet
          </Button>
        )}
      </Box>
      <Typography role="status" aria-live="polite" sx={visuallyHidden}>{busy ? 'Reading the sheet' : ''}</Typography>
      {!online && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Scanning needs a connection.</Typography>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}
