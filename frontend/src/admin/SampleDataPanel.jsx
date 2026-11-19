/** Admin: remove the sample coffees, tasters and flight loaded for a first look. */
import { useState } from 'react';
import { Alert, Button, Paper, Typography } from '@mui/material';
import api from '../api';
import { apiErrorMessage } from '../apiError';
import { tastingApi } from '../tasting/tastingApi';
import ConfirmDialog from '../common/ConfirmDialog';

export default function SampleDataPanel({ onRemoved }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setError(null); setBusy(true);
    try { await api.delete('/group/sample-data'); }
    catch (e) { setError(apiErrorMessage(e, "Couldn't remove the sample data.")); setBusy(false); return; }
    // The coffee list is cached for a minute; the sample coffees must not linger in it.
    tastingApi.invalidateCoffees();
    onRemoved();
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Typography variant="h2" sx={{ fontSize: 18, mb: 0.5 }}>Sample data</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Example coffees, tasters and a flight are loaded in this group.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <Button variant="outlined" color="error" onClick={() => setConfirming(true)} disabled={busy}>Remove sample data</Button>
      <ConfirmDialog
        open={confirming} title="Remove sample data?" confirmLabel="Remove" confirmColor="error"
        message="Removes the sample coffees, tasters and flight. Real tastings stay."
        onConfirm={remove} onClose={() => setConfirming(false)}
      />
    </Paper>
  );
}
