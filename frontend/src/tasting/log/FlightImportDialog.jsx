/**
 * Preview-then-apply dialog for uploading blind cupping flights from a CSV
 * (the coffee import's shape: `coffees/CoffeeImportDialog.jsx`). The server
 * returns one entry per flight in the file; the uploader ticks the ones to
 * open now. Apply re-sends the file with the plan hash and the ticked names,
 * so a stale preview is refused (409) instead of written. After Apply the body
 * becomes the ready-to-run screen (`FlightsReady`) with no way back to the
 * preview; Done, Escape and the backdrop all call `onApplied` so recent flights reload.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Typography,
} from '@mui/material';
import { tastingApi } from '../tastingApi';
import { plural, prepWord, rowErrorText } from '../format';
import FlightsReady from './FlightsReady';

const GENERIC_ERROR = 'Something went wrong with the flight upload.';
const sheetWord = (sheet) => (sheet === 'advanced' ? 'Advanced' : 'Basic');

export default function FlightImportDialog({ open, file, onClose, onApplied }) {
  const [plan, setPlan] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [shuffle, setShuffle] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!open || !file) return undefined;
    let cancelled = false;
    const formData = new FormData();
    formData.append('file', file);
    tastingApi.previewFlightImport(formData)
      .then((result) => {
        if (cancelled) return;
        setPlan(result);
        setTicked(new Set());
        setError(null);
        setStale(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlan(null);
        setError(err.response?.data?.error || GENERIC_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, file, attempt]);

  const rePreview = () => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  };

  const toggle = (name) => setTicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('plan_hash', plan.plan_hash);
      formData.append('flights', JSON.stringify([...ticked]));
      formData.append('shuffle', shuffle ? 'true' : 'false');
      const result = await tastingApi.importFlights(formData);
      setCreated(result.flights ?? []);
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 422 && data) {
        setPlan(data);
        setTicked(new Set());
      } else if (status === 409) {
        setStale(true);
        setError(data?.message || 'Data changed since preview — re-preview');
      } else {
        setError(data?.error || GENERIC_ERROR);
      }
    } finally {
      setApplying(false);
    }
  };

  const fileErrors = plan?.file_errors ?? [];
  const rowErrors = plan?.row_errors ?? [];
  const warnings = plan?.warnings ?? [];
  const flights = plan?.flights ?? [];
  // A file error blocks everything; a row error blocks only its own flight (error_count). A row error
  // naming no listed flight (an over-long flight name) is still shown above, but blocks nothing.
  const anyOwnLabels = flights.some((f) => f.custom_labels);
  const fileBlocked = fileErrors.length > 0;
  const blocked = (f) => fileBlocked || f.error_count > 0;
  const canApply = !!plan && ticked.size > 0 && flights.every((f) => !ticked.has(f.name) || !blocked(f))
    && !loading && !applying && !stale;
  const hasErrors = fileBlocked || rowErrors.length > 0;
  const finish = () => onApplied(created);
  const handleClose = created ? finish : onClose;

  return (
    <Dialog open={open} onClose={applying ? undefined : handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{created ? 'Flights are open' : 'Upload flights CSV'}</DialogTitle>
      <DialogContent dividers>
        {created && <FlightsReady flights={created} />}
        {!created && loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading preview" />
          </Box>
        )}

        {!created && !loading && error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={stale && <Button color="inherit" size="small" onClick={rePreview} sx={{ minHeight: 44 }}>Re-preview</Button>}
          >
            {error}
          </Alert>
        )}

        {!created && !loading && plan && (
          <>
            {hasErrors && (
              <Alert severity="error" sx={{ mb: 2 }}>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {fileErrors.map((msg, i) => <li key={`f-${i}`}>{msg}</li>)}
                  {rowErrors.map((e, i) => <li key={`r-${i}`}>{rowErrorText(e)}</li>)}
                </Box>
              </Alert>
            )}

            {warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {warnings.map((w, i) => <li key={`w-${i}`}>{`${w.row != null ? `Row ${w.row}: ` : ''}${w.message}`}</li>)}
                </Box>
              </Alert>
            )}

            {flights.length === 0 && !hasErrors && <Typography>No flights in this file.</Typography>}

            {flights.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Flights to open</Typography>
                <Stack role="group" aria-label="Flights to open" sx={{ mb: 1 }}>
                  {flights.map((f) => (
                    <FormControlLabel
                      key={f.name}
                      sx={{ minHeight: 44, alignItems: 'center', mx: 0 }}
                      control={<Checkbox checked={ticked.has(f.name)} onChange={() => { if (!blocked(f)) toggle(f.name); }} disabled={applying || blocked(f)} />}
                      label={(
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.name}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {[plural(f.cup_count, 'cup'), prepWord(f.prep), sheetWord(f.sheet)].join(' · ')}
                          </Typography>
                          {f.custom_labels && <Chip size="small" label="Your labels" sx={{ mt: 0.5 }} />}
                          {f.new_coffee_count > 0 && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {plural(f.new_coffee_count, 'new coffee')}
                            </Typography>
                          )}
                          {f.error_count > 0 && (
                            <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                              {plural(f.error_count, 'error')}
                            </Typography>
                          )}
                        </Box>
                      )}
                    />
                  ))}
                </Stack>

                <FormControlLabel
                  sx={{ minHeight: 44, mx: 0 }}
                  control={<Checkbox checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} disabled={applying} />}
                  label="Shuffle pour order"
                />
                {!shuffle && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Labels will follow the file order, which can give the roaster away.
                  </Typography>
                )}
                {anyOwnLabels && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Flights with their own labels keep the file's order either way.
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  Ticked flights open now and close in 48 hours.
                </Typography>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {created ? (
          <Button variant="contained" onClick={finish} sx={{ minHeight: 44 }}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={applying} sx={{ minHeight: 44 }}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleApply}
              disabled={!canApply}
              startIcon={applying ? <CircularProgress size={14} color="inherit" /> : null}
              sx={{ minHeight: 44 }}
            >
              Apply
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
