/**
 * Edit details (Editor or admin). Everything optional: fill in what the bag tells you.
 * THE COFFEE (origin, region, variety, altitude, lot, process, roast) and 
 * WHERE IT IS (kind, roaster's notes). Archive is a coral row with a
 * confirm; archived coffees leave the picker but keep every tasting.
 */
import { useState } from 'react';
import { Alert, Box, Button, ButtonBase, Dialog, TextField, Typography, useMediaQuery } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import ConfirmDialog from '../../common/ConfirmDialog';
import Screen from '../bits/Screen';
import Eyebrow from '../bits/Eyebrow';
import Segments from '../bits/Segments';
import ToggleChip from '../bits/ToggleChip';
import { KINDS, KIND_LABELS, PROCESSES, PROCESS_LABELS, ROASTS, ROAST_LABELS } from '../content';
import { formFor } from './coffeeSupport';

const KIND_OPTIONS = KINDS.map((k) => [k, KIND_LABELS[k]]);
const ROAST_OPTIONS = ROASTS.map((r) => [r, ROAST_LABELS[r]]);

const TEXT_FIELDS = [
  ['origin', 'Origin', 'e.g. Ethiopia'], ['region', 'Region / farm', 'e.g. Guji, Shakiso'],
  ['variety', 'Variety', 'e.g. Heirloom'], ['altitude', 'Altitude', 'e.g. 1,900 m'], ['lot_code', 'Lot / bag code', 'e.g. GH-2261'],
];

export default function EditCoffeeDialog({ open, coffee, onClose, onSaved, onArchived }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [form, setForm] = useState(() => formFor(coffee));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  // Reset the form each time the dialog opens (derived-state-on-prop-change, not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) { setForm(formFor(coffee)); setError(null); }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, process: form.process || null, roast_level: form.roast_level || null };
      const saved = await tastingApi.updateCoffee(coffee.id, body);
      onSaved?.(saved);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save."));
    } finally {
      setSaving(false);
    }
  };
  const setArchived = async (archived) => {
    setConfirmArchive(false);
    setSaving(true);
    try {
      const saved = await (archived ? tastingApi.archiveCoffee(coffee.id) : tastingApi.unarchiveCoffee(coffee.id));
      (onArchived || onSaved)?.(saved);
    } catch (e) {
      setError(apiErrorMessage(e, archived ? "Couldn't archive." : "Couldn't unarchive."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" slotProps={{ paper: { 'aria-label': 'Edit details' } }}>
      <Screen
        title={coffee?.name || 'Edit details'}
        onClose={onClose}
        trailing={<Button onClick={save} disabled={saving}>Save</Button>}
        footer={<Button variant="contained" size="large" fullWidth onClick={save} disabled={saving} sx={{ minHeight: 52 }}>Save details</Button>}
      >
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>Everything here is optional. Fill in what the bag tells you; leave the rest.</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Eyebrow sx={{ mb: 1 }}>The coffee</Eyebrow>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
          {TEXT_FIELDS.map(([k, label, ph]) => (
            <TextField key={k} label={label} value={form[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} fullWidth inputProps={{ style: { fontSize: 16 } }} />
          ))}
          <Box>
            <Typography variant="body2" sx={{ mb: 0.75 }}>Process</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }} role="group" aria-label="Process">
              {PROCESSES.map((p) => (
                <ToggleChip key={p} label={PROCESS_LABELS[p]} on={form.process === p} onClick={() => set('process', form.process === p ? null : p)} />
              ))}
            </Box>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ mb: 0.75 }}>Roast</Typography>
            <Segments ariaLabel="Roast" value={form.roast_level} onChange={(v) => set('roast_level', form.roast_level === v ? null : v)} options={ROAST_OPTIONS} />
          </Box>
        </Box>

        <Eyebrow sx={{ mb: 1 }}>Where it is</Eyebrow>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
          <Box>
            <Typography variant="body2" sx={{ mb: 0.75 }}>Kind</Typography>
            <Segments ariaLabel="Kind" value={form.kind} onChange={(v) => set('kind', v)} options={KIND_OPTIONS} />
          </Box>
          <TextField label="Roaster's notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} multiline minRows={2} fullWidth
            helperText="What's on the bag — for the menu card, not the tasting" inputProps={{ style: { fontSize: 16 } }} />
        </Box>

        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
          {!coffee?.archived_at ? (
            <>
              <ButtonBase onClick={() => setConfirmArchive(true)} sx={{ width: '100%', justifyContent: 'flex-start', minHeight: 44, px: 1, borderRadius: 2, color: 'error.main', fontWeight: 600, fontSize: 15, '&:hover': { bgcolor: (t) => alpha(t.palette.error.main, 0.06) } }}>
                Archive this coffee
              </ButtonBase>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1 }}>
                Archived coffees leave the picker but keep every tasting. Nothing here changes anyone's scores.
              </Typography>
            </>
          ) : (
            <>
              <ButtonBase onClick={() => setArchived(false)} disabled={saving} sx={{ width: '100%', justifyContent: 'flex-start', minHeight: 44, px: 1, borderRadius: 2, color: 'primary.main', fontWeight: 600, fontSize: 15 }}>
                Put it back on the picker
              </ButtonBase>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1 }}>
                Archived — kept for its history. Unarchiving lists it again; nothing else changes.
              </Typography>
            </>
          )}
        </Box>
      </Screen>
      <ConfirmDialog open={confirmArchive} title="Archive this coffee?" message="It leaves the picker and the lists. Every tasting stays."
        confirmLabel="Archive" confirmColor="error" onConfirm={() => setArchived(true)} onClose={() => setConfirmArchive(false)} />
    </Dialog>
  );
}
