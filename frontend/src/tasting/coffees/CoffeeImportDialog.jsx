/**
 * Preview-then-apply dialog for the coffee CSV import (the staff import's
 * shape: `admin/staff/StaffImportDialog.jsx`). The server returns a plan —
 * new coffees, per-coffee field changes, warnings, errors, plan_hash — and
 * Apply re-sends the file with that hash, so a stale preview is refused (409)
 * instead of written.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Stack, Typography,
} from '@mui/material';
import { tastingApi } from '../tastingApi';
import { rowErrorText } from '../format';

const BLANK = '(blank)';
const GENERIC_ERROR = 'Something went wrong with the coffee import.';

function formatValue(value) {
  if (value === null || value === undefined || value === '') return BLANK;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length ? value.join('|') : BLANK;
  return String(value);
}

const fieldValue = (change, column) => change.fields.find((f) => f.column === column)?.new;

function Section({ title, children }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  );
}

export default function CoffeeImportDialog({ open, file, onClose, onApplied }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !file) return undefined;
    let cancelled = false;
    const formData = new FormData();
    formData.append('file', file);
    tastingApi.previewCoffeeImport(formData)
      .then((result) => {
        if (cancelled) return;
        setPlan(result);
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

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('plan_hash', plan.plan_hash);
      onApplied(await tastingApi.importCoffees(formData));
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 422 && data) {
        setPlan(data);
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
  const creates = plan?.creates ?? [];
  const updates = plan?.updates ?? [];
  const skipped = plan?.skipped ?? [];
  const hasErrors = fileErrors.length > 0 || rowErrors.length > 0;
  const nothing = creates.length === 0 && updates.length === 0;
  const canApply = !!plan && !hasErrors && !nothing && !loading && !applying && !stale;

  return (
    <Dialog open={open} onClose={applying ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Import coffees CSV</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading preview" />
          </Box>
        )}

        {!loading && error && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={stale && <Button color="inherit" size="small" onClick={rePreview}>Re-preview</Button>}
          >
            {error}
          </Alert>
        )}

        {!loading && plan && (
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
                  {warnings.map((w, i) => <li key={`w-${i}`}>{`Row ${w.row}: ${w.message}`}</li>)}
                </Box>
              </Alert>
            )}

            {!hasErrors && nothing && <Typography>Nothing to change.</Typography>}
            {!nothing && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {`${creates.length} new · ${updates.length} changed · ${plan.unchanged_count} unchanged · ${skipped.length} skipped`}
              </Typography>
            )}

            {creates.length > 0 && (
              <Section title={`New coffees (${creates.length})`}>
                {creates.map((c) => {
                  const roaster = fieldValue(c, 'roaster');
                  return (
                    <Typography key={c.row} variant="body2" sx={{ pl: 1.5 }}>
                      {roaster ? `${c.name} · ${roaster}` : c.name}
                    </Typography>
                  );
                })}
              </Section>
            )}

            {skipped.length > 0 && (
              <Section title={`Already in your coffees, skipped (${skipped.length})`}>
                <Typography variant="body2" color="text.secondary" sx={{ pl: 1.5 }}>
                  A skipped row's other columns aren't applied; add the coffee's id to update it.
                </Typography>
                {skipped.map((r) => (
                  <Typography key={r.row} variant="body2" sx={{ pl: 1.5 }}>
                    {`Row ${r.row}: ${r.message}`}
                  </Typography>
                ))}
              </Section>
            )}

            {updates.length > 0 && (
              <Section title={`Changes (${updates.length})`}>
                <Stack spacing={1}>
                  {updates.map((c) => (
                    <Box key={c.coffee_id}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.name}</Typography>
                      {c.fields.map((f) => (
                        <Typography key={f.column} variant="body2" sx={{ pl: 1.5 }}>
                          {`${f.column}: ${formatValue(f.old)} → ${formatValue(f.new)}`}
                        </Typography>
                      ))}
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={applying}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleApply}
          disabled={!canApply}
          startIcon={applying ? <CircularProgress size={14} color="inherit" /> : null}
        >
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
