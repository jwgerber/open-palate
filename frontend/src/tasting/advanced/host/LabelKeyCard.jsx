/**
 * The host's label key for a blind cupping: tap to fetch "which cup is which coffee",
 * Hide to forget it. The names live in this component's state ONLY — never the
 * draft, the API cache or storage — and every tap asks the server again.
 */
import { lazy, Suspense, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import Card from '../../bits/Card';
import Eyebrow from '../../bits/Eyebrow';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';
import { flightEditLock } from './flightEditLock';

const PrintKeyDialog = lazy(() => import('../../print/PrintKeyDialog'));
const FlightEditDialog = lazy(() => import('./FlightEditDialog'));

const WARNING = "You'll know the cups — your scores still count.";

export default function LabelKeyCard({ flightId, flightName, memberId, flight, onFlightEdited }) {
  const [cups, setCups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const lockReason = flight ? flightEditLock(flight) : null;

  const reveal = async () => {
    setLoading(true);
    setError(null);
    try {
      const key = await tastingApi.getLabelKey(flightId, { memberId });
      setCups(key.cups);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't load the label key."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card outlined sx={{ mt: 2 }}>
      <Eyebrow sx={{ mb: 0.5 }}>Blind cups</Eyebrow>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Everyone sees only the cup labels — never a name — until you close. Need to know which bowl is which while setting out?
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {cups ? (
        <>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {cups.map((c) => (
              <Box component="li" key={c.position} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ fontWeight: 700, minWidth: 52 }}>{c.label}</Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>{c.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{[c.origin, c.roaster].filter(Boolean).join(' · ')}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>Only on this device. Nobody else gets it.</Typography>
          <Button onClick={() => setCups(null)} sx={{ minHeight: 44 }}>Hide</Button>
          <Button onClick={() => setPrinting(true)} sx={{ minHeight: 44 }}>Print key</Button>
        </>
      ) : (
        <>
          <Button variant="outlined" onClick={reveal} disabled={loading} sx={{ minHeight: 44 }}>Label key…</Button>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>{WARNING}</Typography>
        </>
      )}
      {flight && (
        <Box sx={{ mt: 1.5 }}>
          <Button variant="outlined" disabled={!!lockReason} onClick={() => setEditing(true)} sx={{ minHeight: 44 }}>Edit flight…</Button>
          {lockReason && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>{lockReason}</Typography>}
        </Box>
      )}
      {editing && (
        <Suspense fallback={null}>
          <FlightEditDialog
            open flight={flight} memberId={memberId} onClose={() => setEditing(false)}
            onSaved={async ({ cupsMoved }) => {
              setCups(null);
              if (cupsMoved) await onFlightEdited?.();
            }}
          />
        </Suspense>
      )}
      {printing && (
        <Suspense fallback={null}>
          <PrintKeyDialog open flightId={flightId} flightName={flightName} onClose={() => setPrinting(false)} />
        </Suspense>
      )}
    </Card>
  );
}
