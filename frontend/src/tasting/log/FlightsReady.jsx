/**
 * The ready-to-run screen shown after a flights upload is applied: for each
 * opened flight, the link (QR + copy), the host's printable label key, and the
 * Advanced score sheets. Print sheets is a plain new-tab link: that page fetches the
 * flight itself, since the create response carries no cups. The label key is
 * fetched by PrintKeyDialog itself, on open.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { plural, prepWord } from '../format';
import { flightLink, sheetsLink } from './shareSupport';
import { closesText } from './logTabSupport';

const FlightQr = lazy(() => import('./FlightQr'));
const PrintKeyDialog = lazy(() => import('../print/PrintKeyDialog'));

const QR_SIZE = 96;

function ReadyFlight({ flight, onPrintKey }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flightLink(flight.id));
      setCopyError(false);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  };
  const closes = closesText(flight.closes_at);

  return (
    <Box role="group" aria-label={flight.name} sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontWeight: 600 }}>{flight.name}</Typography>
      <Typography variant="body2" color="text.secondary">
        {[plural(flight.cup_count, 'cup'), prepWord(flight.prep), closes && `Closes ${closes}`].filter(Boolean).join(' · ')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, mt: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ p: 1, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'common.white', boxSizing: 'content-box', width: QR_SIZE, height: QR_SIZE }}>
          <Suspense fallback={null}>
            <FlightQr value={flightLink(flight.id)} size={QR_SIZE} label={`QR code for ${flight.name}`} />
          </Suspense>
        </Box>
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="outlined" onClick={() => onPrintKey(flight)} sx={{ minHeight: 44 }}>Print key</Button>
          {flight.sheet === 'advanced' && (
            <Button variant="outlined" component="a" href={sheetsLink(flight.id)} target="_blank" rel="noopener" sx={{ minHeight: 44 }}>Print sheets</Button>
          )}
        </Stack>
      </Box>
      {copyError && <Alert severity="error" sx={{ mt: 1 }}>Copy failed — scan the QR code instead.</Alert>}
    </Box>
  );
}

export default function FlightsReady({ flights }) {
  const [keyFor, setKeyFor] = useState(null);
  return (
    <>
      <Typography sx={{ mb: 1 }}>
        {flights.length === 1 ? 'The flight is open.' : `${flights.length} flights are open.`} Share the link or QR with tasters, and print what the table needs.
      </Typography>
      {flights.map((f) => (
        <ReadyFlight
          key={f.id}
          flight={f}
          onPrintKey={setKeyFor}
        />
      ))}
      {keyFor && (
        <Suspense fallback={null}>
          <PrintKeyDialog open flightId={keyFor.id} flightName={keyFor.name} onClose={() => setKeyFor(null)} />
        </Suspense>
      )}
    </>
  );
}
