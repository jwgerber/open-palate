/**
 * A coffee's page — its facts, three summary cards (cuppings, basic sheet, your
 * lean against the room) and every tasting session of the coffee, newest first.
 * Per-person names and scores live only in the sessions list, where the server
 * decides what each viewer may see (spec §5.1).
 *
 * The pencil (Editor or admin) opens EditCoffeeDialog; "+ Taste this coffee" hands the
 * coffee to the Log tab.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import ConfirmDialog from '../../common/ConfirmDialog';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import { CONSENSUS_THRESHOLD } from '../content';
import Card from '../bits/Card';
import { useTastingIdentity } from '../useTastingIdentity';
import { plural } from '../format';
import EditCoffeeDialog from './EditCoffeeDialog';
import { TopCards } from './CoffeeReads';
import CoffeeSessions from './sessions/CoffeeSessions';
import { factChips, blankFacts } from './coffeeSupport';

export default function CoffeePage() {
  const { coffeeId } = useParams();
  const navigate = useNavigate();
  // canManage mirrors @require_permission(editor or admin) on PATCH/archive; the
  // "Taste" hand-off needs an account that logs as itself (a signed-in person).
  const { canManage: canEdit, isPerson } = useTastingIdentity();
  const [coffee, setCoffee] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  // { flightId, tasterKey?, who } — a read waiting on the delete confirm.
  // `who` is a possessive ("Your", "Robin's") for the confirm copy.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // A failed delete is shown inline; `error` is reserved for a failed page load.
  const [deleteError, setDeleteError] = useState(null);
  // Bumped after a delete so the sessions list refetches from page 1.
  const [sessionsKey, setSessionsKey] = useState(0);

  const load = useCallback(() => tastingApi.getCoffee(Number(coffeeId))
    .then((c) => { setCoffee(c); setError(null); })
    .catch((e) => setError(apiErrorMessage(e, "Couldn't load this coffee."))), [coffeeId]);
  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await tastingApi.deleteTastings(target.flightId, target.tasterKey ? { tasterKey: target.tasterKey } : {});
      await load();
      setSessionsKey((k) => k + 1);
    } catch (e) {
      setDeleteError(apiErrorMessage(e, "Couldn't delete that tasting."));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!coffee) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

  const c = coffee.consensus;
  const facts = factChips(coffee);
  const blanks = blankFacts(coffee);
  const meta = [coffee.roaster, coffee.lot_code ? `lot ${coffee.lot_code}` : null].filter(Boolean).join(' · ');
  const thinLead = coffee.n > 0 ? `${plural(coffee.n, 'tasting')} so far — averages` : 'Averages';

  return (
    <Box sx={{ pb: 12 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <IconButton aria-label="Back" onClick={() => navigate('/coffees')}><ArrowBackIcon /></IconButton>
        <Typography variant="h3" sx={{ flex: 1, minWidth: 0 }} noWrap>{coffee.name}</Typography>
        {canEdit && <IconButton aria-label="Edit details" onClick={() => setEditing(true)}><EditIcon /></IconButton>}
      </Box>
      {coffee.archived_at && <Chip label="Archived — kept for its history, off the picker" size="small" sx={{ mb: 1 }} />}
      {meta && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{meta}</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
        {facts.map((f) => <Chip key={f.key} label={f.label} size="small" sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }} />)}
        {canEdit && blanks.length > 0 && (
          <Chip label={`+ ${blanks.slice(0, 2).join(' · ')}`} size="small" variant="outlined" clickable onClick={() => setEditing(true)} sx={{ borderStyle: 'dashed', color: 'text.secondary' }} />
        )}
      </Box>
      {coffee.notes && <Typography sx={{ mb: 2 }}>{coffee.notes}</Typography>}
      <TopCards coffee={coffee} />

      {!c && (
        <Card>
          <Typography sx={{ fontWeight: 600 }}>Not enough basic tastings yet.</Typography>
          <Typography variant="body2" color="text.secondary">
            {thinLead} and descriptors show at {CONSENSUS_THRESHOLD}.{coffee.cupping ? '' : ' Individual reads stay private until then.'}
          </Typography>
        </Card>
      )}

      {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)} sx={{ mb: 1.5 }}>{deleteError}</Alert>}
      <CoffeeSessions coffeeId={coffee.id} onDeleteRead={setPendingDelete} canManage={canEdit} isPerson={isPerson} reloadKey={sessionsKey} />

      {!coffee.archived_at && isPerson && (
        <Box sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))', bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="contained" size="large" fullWidth startIcon={<AddIcon />} onClick={() => navigate(`/log?taste=${coffee.id}`)} sx={{ minHeight: 52, maxWidth: 608, display: 'flex', mx: 'auto' }}>
            Taste this coffee
          </Button>
        </Box>
      )}
      <EditCoffeeDialog open={editing} coffee={coffee} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      <ConfirmDialog
        open={!!pendingDelete && !deleting}
        title="Delete this tasting?"
        message={`${pendingDelete?.who ?? 'The'} read of every cup in that flight goes; a solo flight goes with it. The coffee stays.`}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={confirmDelete}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
      />
    </Box>
  );
}
