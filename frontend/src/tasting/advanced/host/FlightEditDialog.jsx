/**
 * The host's edit of a blind flight before anyone has tasted: rename, add, reorder and
 * remove cups in one Save. Labels stay fixed down the left while the coffees move, so
 * Cup A stays first and the coffee behind it changes.
 *
 * The names live in this component's state ONLY, like the label key: never the flight
 * draft, the API cache or storage. Render it only while open, so closing forgets them.
 */
import { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, TextField, Typography,
} from '@mui/material';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddCoffeeForm from '../../log/screens/AddCoffeeForm';
import { useTastingIdentity } from '../../useTastingIdentity';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';

const MAX_CUPS = 26; // flight_csv.MAX_CUPS: past Z the letters run out.
const defaultLabel = (i) => `Cup ${String.fromCharCode(65 + i)}`;
const subtitle = (row) => [row.origin, row.roaster].filter(Boolean).join(' · ');

const rowFromKey = (c) => ({ coffeeId: c.coffee_id, name: c.name, savedName: c.name, roaster: c.roaster, origin: c.origin, isNew: false });
const rowFromCoffee = (c) => ({ coffeeId: c.id, name: c.name, savedName: c.name, roaster: c.roaster, origin: c.origin, isNew: true });

function move(rows, from, to) {
  const next = [...rows];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function CupRow({ row, index, count, label, labelInput, renamable, disabled, onName, onMove, onRemove }) {
  return (
    // On a phone the name takes its own line under the label and buttons; beside three
    // 44px buttons it would be about one letter wide.
    <Box data-testid="edit-row" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ width: 76, flexShrink: 0, mr: { xs: 'auto', sm: 0 } }}>
        {labelInput || <Typography data-testid="edit-label" sx={{ fontWeight: 700 }}>{label}</Typography>}
      </Box>
      <Box sx={{ order: { xs: 1, sm: 0 }, flexGrow: 1, flexBasis: { xs: '100%', sm: 0 }, minWidth: 0 }}>
        {renamable ? (
          <TextField
            fullWidth size="small" value={row.name} disabled={disabled} onChange={(e) => onName(e.target.value)}
            inputProps={{ 'aria-label': `Name of ${row.savedName}`, 'data-testid': 'edit-name', style: { fontSize: 16 } }}
          />
        ) : <Typography data-testid="edit-name" sx={{ fontWeight: 600 }}>{row.name}</Typography>}
        <Typography variant="body2" color="text.secondary" noWrap>{subtitle(row)}</Typography>
      </Box>
      <IconButton aria-label={`Move ${row.savedName} up`} disabled={disabled || index === 0} onClick={() => onMove(index - 1)} sx={{ width: 44, height: 44 }}><ArrowUpwardIcon /></IconButton>
      <IconButton aria-label={`Move ${row.savedName} down`} disabled={disabled || index === count - 1} onClick={() => onMove(index + 1)} sx={{ width: 44, height: 44 }}><ArrowDownwardIcon /></IconButton>
      <IconButton aria-label={`Remove ${row.savedName}`} disabled={disabled || count === 1} onClick={onRemove} sx={{ width: 44, height: 44 }}><DeleteOutlineIcon /></IconButton>
    </Box>
  );
}

export default function FlightEditDialog({ open, flight, memberId, onSaved, onClose }) {
  const { canManage } = useTastingIdentity();
  const [rows, setRows] = useState(null);
  const [slots, setSlots] = useState([]);
  const [newLabels, setNewLabels] = useState([]);
  const [coffees, setCoffees] = useState([]);
  const [roasters, setRoasters] = useState([]);
  const [addingNew, setAddingNew] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [reprint, setReprint] = useState(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let live = true;
    tastingApi.getLabelKey(flight.id, { memberId })
      .then((key) => {
        if (!live) return;
        setRows(key.cups.map(rowFromKey));
        setSlots(key.cups.map((c) => c.label));
        setSavedIds(key.cups.map((c) => c.coffee_id));
      })
      .catch((e) => { if (live) setError(apiErrorMessage(e, "Couldn't load this flight.")); });
    // No store filter: an uploaded flight has no store, and a host may pour any coffee.
    tastingApi.getCoffees()
      .then((list) => {
        if (!live) return;
        setCoffees(list.coffees);
        setRoasters(list.roasters);
      })
      .catch((e) => { if (live) setError(apiErrorMessage(e, "Couldn't load the coffee list.")); });
    return () => { live = false; };
  }, [flight.id, memberId]);

  const count = rows?.length ?? 0;
  const custom = slots.some((label, i) => label !== defaultLabel(i));
  const extraSlots = Math.max(0, count - slots.length);
  const slotLabel = (i) => slots[i] ?? defaultLabel(i);
  const inFlight = new Set((rows ?? []).map((r) => r.coffeeId));
  const options = coffees.filter((c) => !inFlight.has(c.id));
  const blankName = canManage && (rows ?? []).some((r) => !r.isNew && !r.name.trim());
  const missingLabel = custom && newLabels.slice(0, extraSlots).filter((l) => l?.trim()).length < extraSlots;
  // My own unsaved scores are keyed to slots, so only moving the cups costs them.
  const cupsMoved = (rows ?? []).map((r) => r.coffeeId).join() !== savedIds.join();
  const canSave = count > 0 && !saving && !locked && !blankName && !missingLabel;

  const addCoffee = (coffee) => {
    setRows((prev) => (prev.some((r) => r.coffeeId === coffee.id) ? prev : [...prev, rowFromCoffee(coffee)]));
    setAddingNew(false);
  };

  const save = async () => {
    const cups = rows.map((r) => {
      const name = r.name.trim();
      return canManage && !r.isNew && name !== r.savedName
        ? { coffee_id: r.coffeeId, name } : { coffee_id: r.coffeeId };
    });
    if (!cupsMoved && !cups.some((c) => 'name' in c)) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await tastingApi.putFlightCups(flight.id, {
        cups,
        newLabels: custom ? newLabels.slice(0, extraSlots).map((l) => l.trim()) : [],
        memberId,
      });
      // Sheets carry only labels, so they survive unless the count changed; a key names the coffees.
      setReprint(count === slots.length
        ? 'Saved. Reprint the label key if you’ve already printed it: it shows the old cups.'
        : 'Saved. Reprint any sheets or label key you’ve already printed: they show the old cups.');
    } catch (e) {
      // A 409's `error` is a code; its `message` is the line meant for people.
      setError(e?.response?.data?.message || apiErrorMessage(e, "Couldn't save the flight."));
      if (e?.response?.data?.error === 'flight_locked') setLocked(true);
      setSaving(false);
      return;
    }
    try {
      await onSaved?.({ cupsMoved });
    } catch {
      setRefreshFailed(true);
    } finally {
      setSaving(false);
    }
  };

  // A tap outside would throw away every edit, and closing mid-save would hide that it landed.
  const closeUnlessBusy = (_event, reason) => {
    if (saving || reason === 'backdropClick') return;
    onClose();
  };

  const labelInputFor = (i) => (custom && i >= slots.length ? (
    <TextField
      size="small" value={newLabels[i - slots.length] ?? ''} disabled={locked}
      onChange={(e) => setNewLabels((prev) => { const next = [...prev]; next[i - slots.length] = e.target.value; return next; })}
      inputProps={{ 'aria-label': `Label for cup ${i + 1}`, maxLength: 4, style: { fontSize: 16 } }}
    />
  ) : null);

  return (
    <Dialog open={open} onClose={closeUnlessBusy} fullWidth maxWidth="sm" aria-labelledby="flight-edit-title">
      <DialogTitle id="flight-edit-title">Edit flight</DialogTitle>
      <DialogContent>
        {reprint ? (
          <>
            <Alert severity="success">{reprint}</Alert>
            {refreshFailed && <Alert severity="warning" sx={{ mt: 1 }}>This screen couldn’t refresh. Close and reopen this flight before scoring.</Alert>}
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">You&apos;ll know the cups — your scores still count.</Typography>
            <Typography variant="body2" color="text.secondary">If anyone has started scoring, don&apos;t change this flight.</Typography>
            {cupsMoved && <Typography variant="body2" color="text.secondary">Saving clears any scores you&apos;ve started on this device.</Typography>}
            <Box sx={{ mb: 1.5 }} />
            {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
            {(rows ?? []).map((row, i) => (
              <CupRow
                key={row.coffeeId} row={row} index={i} count={count} label={slotLabel(i)}
                labelInput={labelInputFor(i)} renamable={canManage && !row.isNew} disabled={locked}
                onName={(name) => setRows((prev) => prev.map((r) => (r.coffeeId === row.coffeeId ? { ...r, name } : r)))}
                onMove={(to) => setRows((prev) => move(prev, i, to))}
                onRemove={() => {
                  setRows((prev) => prev.filter((r) => r.coffeeId !== row.coffeeId));
                  // A typed label belongs to its slot; when the slot goes, so does the label.
                  setNewLabels((prev) => prev.slice(0, Math.max(0, count - 1 - slots.length)));
                }}
              />
            ))}
            {rows && !locked && count >= MAX_CUPS && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>A flight holds {MAX_CUPS} cups at most.</Typography>
            )}
            {rows && !locked && count < MAX_CUPS && (
              <Box sx={{ mt: 2 }}>
                {addingNew ? (
                  <>
                    <AddCoffeeForm
                      mode="picker" roasters={roasters} defaultKind="cupping_lot" allowTaste={false}
                      onUseExisting={addCoffee}
                      onAdded={(c) => { setCoffees((prev) => [...prev, c]); addCoffee(c); }}
                    />
                    <Button onClick={() => setAddingNew(false)} sx={{ mt: 1, minHeight: 44 }}>Back to the list</Button>
                  </>
                ) : (
                  <>
                    <Autocomplete
                      key={count} options={options} value={null} blurOnSelect
                      getOptionLabel={(c) => (c.roaster ? `${c.name} · ${c.roaster}` : c.name)}
                      isOptionEqualToValue={(a, b) => a.id === b.id}
                      renderOption={({ key: _labelKey, ...props }, c) => (
                        <li {...props} key={c.id}>{c.roaster ? `${c.name} · ${c.roaster}` : c.name}</li>
                      )}
                      onChange={(_e, c) => { if (c) addCoffee(c); }}
                      renderInput={(params) => <TextField {...params} label="Add a coffee" inputProps={{ ...params.inputProps, 'aria-label': 'Add a coffee', style: { fontSize: 16 } }} />}
                    />
                    <Button onClick={() => setAddingNew(true)} sx={{ mt: 1, minHeight: 44 }}>Something else…</Button>
                  </>
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {reprint ? <Button onClick={onClose} sx={{ minHeight: 44 }}>Done</Button> : (
          <>
            <Button onClick={onClose} disabled={saving} sx={{ minHeight: 44 }}>Cancel</Button>
            <Button variant="contained" disabled={!canSave} onClick={save} sx={{ minHeight: 44 }}>Save</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
