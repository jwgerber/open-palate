/**
 * "Explore with sample data" — offered to a group admin while the group has no coffees at all
 * (archived ones count, as on the server). Loading is one request; `onLoaded` lets the host tab
 * reload so the new coffees and flight show up.
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import api from '../../api';
import { apiErrorMessage } from '../../apiError';
import { tastingApi } from '../tastingApi';
import { useTastingIdentity } from '../useTastingIdentity';
import Card from './Card';

const REFUSALS = {
  not_empty: "This group already has coffees, so sample data isn't available.",
  already_loaded: 'Sample data is already loaded.',
};

export default function SampleDataCard({ onLoaded, hasCoffees }) {
  const { isAdmin } = useTastingIdentity();
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // The host may already know the group has a (non-archived) coffee. Otherwise ask the server on
  // mount and whenever the window regains focus, so the card goes once a coffee is added elsewhere.
  const known = hasCoffees === true;
  useEffect(() => {
    if (!isAdmin) return undefined;
    if (known) { setEmpty(false); return undefined; }
    let live = true;
    const check = () => tastingApi.getCoffees({ includeArchived: true })
      .then((d) => { if (live) setEmpty((d?.coffees ?? []).length === 0); })
      // A failed check just means no card: the app works the same without it.
      .catch((e) => console.warn('Sample data card: could not check for coffees', e));
    check();
    window.addEventListener('focus', check);
    return () => { live = false; window.removeEventListener('focus', check); };
  }, [isAdmin, known]);

  if (!isAdmin || !empty) return null;

  const load = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/group/sample-data');
    } catch (e) {
      const code = e.response?.data?.error;
      if (code === 'already_loaded') setLoaded(true);
      if (code === 'not_empty') setEmpty(false);  // can't succeed: the group has coffees now
      setError(REFUSALS[code] ?? apiErrorMessage(e, "Couldn't load sample data."));
      setBusy(false);
      return;
    }
    tastingApi.invalidateCoffees();
    setEmpty(false);
    setBusy(false);
    onLoaded?.();
  };

  return (
    <Card>
      <Typography variant="h3" sx={{ fontSize: 18 }}>Explore with sample data</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
        Adds 5 example coffees and two finished blind flights tasted by three sample tasters, one of them a cupping on the advanced sheet. Remove it any time in Group settings.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      <Button variant="outlined" onClick={load} disabled={busy || loaded} sx={{ minHeight: 44 }}>Load sample data</Button>
    </Card>
  );
}
