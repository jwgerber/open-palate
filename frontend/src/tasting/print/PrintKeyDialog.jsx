/**
 * Printable "which cup is which coffee" key for a blind flight, HOST ONLY.
 *
 * The names live in this component's state and nowhere else — never the flight
 * draft, the tastingApi cache, storage or a log — and every open asks the server
 * again (the route refuses anyone but the account-door host). The printer gets a
 * separate `.key-print-root` portal straight under <body>, the way PrintSheetsDialog
 * does it, so the key prints alone and the app behind it stays out of the page.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, GlobalStyles, Typography,
} from '@mui/material';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';

const HOST_ONLY = 'Host only — keep this off the table. Tasters must not see it.';

// Real CSS property names only (GlobalStyles is plain emotion). Every MUI Dialog is a portal under
// <body>, so print hides every body child but the key's own root.
const KEY_PRINT_CSS = {
  '.key-print-root': { display: 'none' },
  '@media print': {
    'body > *:not(.key-print-root)': { display: 'none !important' },
    body: { overflow: 'visible !important', margin: '0 !important' },
    '.key-print-root': { display: 'block !important', padding: '0.5in' },
  },
};

// `print` pins ink colours: a dark-mode theme would otherwise print light text on white paper.
function KeyList({ cups, print = false }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {cups.map((c) => (
        <Box component="li" key={c.position} sx={{ display: 'flex', gap: 2, py: 1, borderBottom: '1px solid', borderColor: print ? 'grey.400' : 'divider' }}>
          <Typography sx={{ fontWeight: 700, minWidth: 72 }}>{c.label}</Typography>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>
            <Typography variant="body2" color={print ? undefined : 'text.secondary'} sx={print ? { color: 'grey.800' } : undefined}>{[c.roaster, c.origin].filter(Boolean).join(' · ')}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default function PrintKeyDialog({ open, flightId, flightName, onClose }) {
  const [cups, setCups] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    tastingApi.getLabelKey(flightId)
      .then((key) => { if (live) { setCups([...key.cups].sort((a, b) => a.position - b.position)); setError(null); } })
      .catch((e) => { if (live) { setCups(null); setError(apiErrorMessage(e, "Couldn't load the label key.")); } });
    return () => {
      live = false;
      setCups(null);
      setError(null);
    };
  }, [open, flightId]);

  const loading = open && !cups && !error;

  return (
    <>
      {open && cups && <GlobalStyles styles={KEY_PRINT_CSS} />}
      {open && cups && createPortal(
        <Box className="key-print-root" aria-hidden="true" sx={{ bgcolor: 'common.white', color: 'common.black' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {`Host only — Label key${flightName ? ` — ${flightName}` : ''}`}
          </Typography>
          <Typography sx={{ fontWeight: 700, mb: 1 }}>{HOST_ONLY}</Typography>
          <KeyList cups={cups} print />
        </Box>,
        document.body,
      )}
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="print-key-title">
        <DialogTitle id="print-key-title">Label key</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle2" component="h3" color="error" sx={{ mb: 1 }}>{HOST_ONLY}</Typography>
          {flightName && <Typography sx={{ fontWeight: 600, mb: 1 }}>{flightName}</Typography>}
          {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress aria-label="Loading the label key" /></Box>}
          {error && <Alert severity="error">{error}</Alert>}
          {cups && <KeyList cups={cups} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>Close</Button>
          {cups && <Button variant="contained" onClick={() => window.print()} sx={{ minHeight: 44 }}>Print</Button>}
        </DialogActions>
      </Dialog>
    </>
  );
}
