/**
 * "Something else" — add a coffee with three fields (name, roaster, kind).
 * Everything else is optional and editable later from the coffee's page.
 *
 * A fuzzy match on the server (name ≥ 3 chars) surfaces a cream-tinted nudge:
 * "Did you mean {name}?" — one tap uses the existing coffee instead of making
 * a near-duplicate. Used from the picker (`mode="picker"`, one CTA "Add to
 * flight") and from the Coffees tab (`mode="coffees"`, "Add & taste it →" +
 * "Just add it").
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, TextField, Typography, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';
import { KINDS, KIND_LABELS } from '../../content';
import Eyebrow from '../../bits/Eyebrow';
import Segments from '../../bits/Segments';
import { plural } from '../../format';

const KIND_OPTIONS = KINDS.map((k) => [k, KIND_LABELS[k]]);

export default function AddCoffeeForm({ mode = 'picker', roasters = [], defaultKind = 'house', allowTaste = true, onUseExisting, onAdded, onAddAndTaste }) {
  const [name, setName] = useState('');
  const [roaster, setRoaster] = useState('');
  const [kind, setKind] = useState(defaultKind);
  const [match, setMatch] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    let live = true;   // a slow response for an abandoned query must not land
    const q = name.trim();
    timer.current = setTimeout(() => {
      if (q.length < 3) { setMatch(null); return; }
      tastingApi.matchCoffee(q)
        .then((r) => { if (live) setMatch(r?.match || null); })
        .catch(() => { if (live) setMatch(null); });
    }, q.length < 3 ? 0 : 300);
    return () => { live = false; clearTimeout(timer.current); };
  }, [name]);

  const suggestions = roasters.filter((r) => !roaster || r.toLowerCase().includes(roaster.toLowerCase())).slice(0, 4);
  const canAdd = name.trim().length > 0 && !saving;

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), roaster: roaster.trim(), kind };
      return await tastingApi.createCoffee(body);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't add that coffee."));
      return null;
    } finally {
      setSaving(false);
    }
  };
  const add = async () => { const c = await create(); if (c) onAdded?.(c); };
  const addAndTaste = async () => { const c = await create(); if (c) onAddAndTaste?.(c); };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Eyebrow sx={{ mb: 0.5 }}>Coffee name</Eyebrow>
        <TextField
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Guji Shakiso"
          inputProps={{ 'aria-label': 'Coffee name', style: { fontSize: 16 } }}
        />
        {match && (
          <Box sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: (t) => alpha(t.palette.warning.main, 0.14), display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid="fuzzy-nudge">
            <Typography sx={{ fontSize: 14, flex: 1, minWidth: 160 }}>
              {mode === 'picker' ? 'Did you mean ' : 'Already in your coffees: '}
              <strong>{match.name}</strong>{match.roaster ? ` · ${match.roaster}` : ''} · {plural(match.n, 'tasting')}
            </Typography>
            <Button size="small" variant="text" onClick={() => onUseExisting?.(match)}>{mode === 'picker' ? 'Use it' : 'Open it'}</Button>
          </Box>
        )}
      </Box>
      <Box>
        <Eyebrow sx={{ mb: 0.5 }}>Roaster</Eyebrow>
        <TextField
          fullWidth
          value={roaster}
          onChange={(e) => setRoaster(e.target.value)}
          placeholder="e.g. Barrington"
          inputProps={{ 'aria-label': 'Roaster', style: { fontSize: 16 } }}
        />
        {suggestions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {suggestions.map((r) => (
              <Chip key={r} label={r} clickable onClick={() => setRoaster(r)} variant={roaster === r ? 'filled' : 'outlined'} sx={{ minHeight: 36 }} />
            ))}
          </Box>
        )}
      </Box>
      <Box>
        <Eyebrow sx={{ mb: 0.5 }}>Kind</Eyebrow>
        <Segments ariaLabel="Kind" value={kind} onChange={setKind} options={KIND_OPTIONS} />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
        {mode === 'picker' ? (
          <Button variant="contained" size="large" disabled={!canAdd} onClick={add} sx={{ minHeight: 52 }}>Add to flight</Button>
        ) : (
          <>
            {allowTaste && <Button variant="contained" size="large" disabled={!canAdd} onClick={addAndTaste} sx={{ minHeight: 52 }}>Add &amp; taste it →</Button>}
            <Button variant={allowTaste ? 'outlined' : 'contained'} size="large" disabled={!canAdd} onClick={add} sx={{ minHeight: allowTaste ? 48 : 52 }}>Just add it</Button>
          </>
        )}
      </Box>
    </Box>
  );
}
