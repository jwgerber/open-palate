/**
 * Log tab — start a flight, see your recent flights, and (from a shared link
 * or an open invite) taste a flight someone else set up.
 *
 * Recent flights never show a score. A closed flight opens its reveal read-only; an open shared flight
 * the user is part of reopens its waiting state.
 *
 * Two identity facts drive this screen and they are NOT the same thing:
 * `isPerson` (a signed-in account — may log as itself; otherwise the flow starts by
 * naming a taster and there is no personal "recent" list) and
 * `isSharedDevice` (the shared tablet: no remembered picks).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, ButtonBase, Chip, CircularProgress, IconButton, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LinkIcon from '@mui/icons-material/Link';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import { useFlightDraft } from './useFlightDraft';
import { loadDraft } from './draftStorage';
import FlightDialog from './FlightDialog';
import FlightImportDialog from './FlightImportDialog';
import ConfirmDialog from '../../common/ConfirmDialog';
import { blankSheetsLink } from './shareSupport';
import { flightMeta, closesText } from './logTabSupport';
import { useTastingIdentity } from '../useTastingIdentity';
import { plural, prepWord } from '../format';
import Eyebrow from '../bits/Eyebrow';
import Card from '../bits/Card';
import SampleDataCard from '../bits/SampleDataCard';

const PrintSheetsDialog = lazy(() => import('../print/PrintSheetsDialog'));

export default function LogTab() {
  const { isPerson, isSharedDevice, canManage, user } = useTastingIdentity();
  const navigate = useNavigate();
  const { flightId: linkFlightId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tasteId = Number(searchParams.get('taste')) || null;
  const [draft, dispatch, restoredDraft] = useFlightDraft(user?.id ?? null, { flightId: Number(linkFlightId) || null });
  const [recent, setRecent] = useState(isPerson ? null : []);
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [pendingTaste, setPendingTaste] = useState(null);   // a coffee waiting on the discard confirm
  const [printingBlank, setPrintingBlank] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const fileInput = useRef(null);
  const [openingId, setOpeningId] = useState(null);         // a recent flight whose reveal is loading
  const [deleting, setDeleting] = useState(null);           // an open flight waiting on the delete confirm (kept while the dialog fades)
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const loadRecent = useCallback(() => {
    if (!isPerson) return Promise.resolve();   // "recent" needs an identity the shared device has not named yet
    return tastingApi.getRecentFlights()
      .then((d) => { setRecent(d.flights); setMe(d.me); setError(null); })
      .catch((e) => setError(apiErrorMessage(e, "Couldn't load your recent flights.")));
  }, [isPerson]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  // A shared link: /f/:id
  useEffect(() => {
    if (!linkFlightId) return undefined;
    let live = true;
    tastingApi.getFlight(Number(linkFlightId))
      .then((f) => { if (live) { setInvite(f); setInviteError(null); } })
      .catch((e) => { if (live) { setInvite(null); setInviteError(apiErrorMessage(e, "That flight link doesn't work.")); } });
    return () => { live = false; };
  }, [linkFlightId]);

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // picking the same file again must still fire onChange
    if (file) setImportFile(file);
  };
  const importDone = () => { setImportFile(null); loadRecent(); };

  const start = () => {
    // A solo flight saved before a QR link opened this page: pick it back up rather than overwrite it.
    const saved = isPerson ? loadDraft(user?.id ?? null, { flightId: 'new' }) : null;
    dispatch(saved ? { type: 'resume', draft: saved } : { type: 'screen', screen: isPerson ? 'picker' : 'who' });
  };

  // "+ Taste this coffee" from the Coffees tab: seed a flight of one and open
  // the entry — after a confirm if a flight is already in progress. The shared
  // shared device never gets the CTA (it must name a taster first), so just drop the param.
  const seedTaste = useCallback((c) => {
    dispatch({ type: 'reset' });
    dispatch({ type: 'togglePick', coffee: c });
    dispatch({ type: 'screen', screen: 'entry' });
  }, [dispatch]);
  useEffect(() => {
    if (!tasteId) return undefined;
    if (isSharedDevice) { setSearchParams({}, { replace: true }); return undefined; }
    let live = true;
    tastingApi.getCoffee(tasteId).then((c) => {
      if (!live) return;
      setSearchParams({}, { replace: true });
      if (draft.picked.length > 0 && !draft.logged) setPendingTaste(c); else seedTaste(c);
    }).catch((e) => { if (live) setError(apiErrorMessage(e, "Couldn't open that coffee.")); });
    return () => { live = false; };
    // draft is read once at the moment the link resolves, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasteId, isSharedDevice, seedTaste, setSearchParams]);

  const openFlight = async (f) => {
    setOpeningId(f.id);   // the row answers the tap before the network does
    try {
      if (!f.is_open) {
        const result = await tastingApi.getFlightResult(f);
        dispatch({ type: 'seedFromFlight', flight: f });
        dispatch({ type: 'logged', flight: f });
        dispatch({ type: 'revealed', result });
      } else if (f.you_logged) {
        dispatch({ type: 'seedFromFlight', flight: f });
        dispatch({ type: 'logged', flight: f });
      } else {
        // A shared device's account is many tasters, so one person's saved scores are never offered to the next.
        const resume = isPerson ? loadDraft(user?.id ?? null, { flightId: f.id }) : null;
        dispatch({ type: 'seedFromFlight', flight: f, resume });
      }
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't open that flight."));
    } finally {
      setOpeningId(null);
    }
  };
  const tasteInvite = () => {
    if (!invite) return;
    openFlight(invite);
    setInvite(null);
    navigate('/log', { replace: true });
  };

  // Cancel an in-process flight from its card. Mirrors the server's delete_flight gate: the host
  // while nobody else has logged, an editor or admin always; never through the shared-device door.
  const mayDeleteOpen = (f) => isPerson && f.is_open
    && (canManage || (f.is_host && (f.logged_count ?? 0) <= (f.you_logged ? 1 : 0)));
  const askDelete = (f) => { setDeleteError(null); setDeleting(f); setConfirmingDelete(true); };
  const deleteOpenFlight = async (f) => {
    setConfirmingDelete(false);
    try {
      await tastingApi.deleteFlight(f.id);
      if (draft.flightId === f.id) dispatch({ type: 'reset' });
      if (invite?.id === f.id) { setInvite(null); navigate('/log', { replace: true }); }
    } catch (e) {
      setDeleteError(apiErrorMessage(e, "Couldn't delete the flight."));
    }
    // Either way the server is the truth: a refused delete (someone logged, it closed, it's gone) reconciles the card.
    await loadRecent();
  };

  const flightGone = useCallback(() => {
    setDeleteError('That flight was deleted, so the scores saved for it on this device are gone.');
  }, []);

  const shownInvite = linkFlightId ? invite : null;
  const openInvites = (recent || []).filter((f) => f.is_shared && f.is_open && f.id !== shownInvite?.id);
  const whoLine = isSharedDevice
    ? 'Shared device · pick your name to taste'
    : `Logged in as ${me?.name || user?.display_name || user?.email?.split('@')[0] || 'you'}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 4 }}>
      <Card>
        <Typography variant="h3" sx={{ fontSize: 18 }}>What did you taste?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>About 30 seconds a cup. Pick the coffees, describe each, log it.</Typography>
        <Button variant="contained" size="large" fullWidth startIcon={<AddIcon />} onClick={start} sx={{ minHeight: 52 }}>
          Start a tasting
        </Button>
        {isSharedDevice
          // A shared device stays in-app: it is locked with no deep links.
          ? <Button fullWidth size="small" onClick={() => setPrintingBlank(true)} sx={{ mt: 0.5, minHeight: 44 }}>Print a blank cupping sheet</Button>
          : <Button fullWidth size="small" component="a" href={blankSheetsLink()} target="_blank" rel="noopener" sx={{ mt: 0.5, minHeight: 44 }}>Print a blank cupping sheet</Button>}
        {canManage && isPerson && (
          <>
            <Button fullWidth size="small" onClick={() => fileInput.current?.click()} sx={{ minHeight: 44 }}>Upload flights</Button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={pickFile} data-testid="flight-csv-input" />
          </>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.5, color: 'text.secondary', flexWrap: 'wrap' }}>
          <PersonOutlineIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption">{whoLine}</Typography>
        </Box>
      </Card>

      <SampleDataCard onLoaded={loadRecent} />

      {inviteError && <Alert severity="error">{inviteError}</Alert>}
      {deleteError && <Alert severity="error" onClose={() => setDeleteError(null)}>{deleteError}</Alert>}
      {(shownInvite || openInvites.length > 0) && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {[shownInvite, ...openInvites].filter(Boolean).map((f) => (
            <Card key={f.id} outlined sx={{ borderColor: 'primary.main' }} data-testid={`invite-${f.id}`}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'primary.main' }}>
                <LinkIcon sx={{ fontSize: 16 }} />
                <Eyebrow sx={{ color: 'primary.main', flex: 1 }}>Shared with you</Eyebrow>
                {mayDeleteOpen(f) && (
                  <IconButton
                    aria-label={`Delete flight ${f.name || f.title || 'this flight'}`}
                    onClick={() => askDelete(f)}
                    sx={{ color: 'error.main', m: -1, width: 44, height: 44 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Typography variant="h3" sx={{ fontSize: 18, mt: 0.5 }}>{f.name || f.title || 'A shared flight'}</Typography>
              <Typography variant="body2" color="text.secondary">
                Set up by {f.host_name} · {plural(f.cups.length, 'coffee')} · {prepWord(f.prep)}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, my: 1 }}>
                {f.cups.map((c) => <Chip key={c.position} size="small" label={`${c.position} · ${c.label}`} />)}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {f.logged_count} of {f.roster.length} have logged · closes when {f.is_host ? 'you close it' : `${f.host_name} closes it`}{f.closes_at ? `, or by ${closesText(f.closes_at)}` : ''}
              </Typography>
              <Button variant="contained" fullWidth endIcon={<ArrowForwardIcon />} sx={{ mt: 1.5, minHeight: 48 }} onClick={() => (f === shownInvite ? tasteInvite() : openFlight(f))}>
                {f.you_logged ? 'See who\'s logged' : 'Taste this flight'}
              </Button>
            </Card>
          ))}
        </Box>
      )}

      {isPerson && (
        <Box>
          <Eyebrow sx={{ mb: 1 }}>Your recent flights</Eyebrow>
          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
          {recent === null && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>}
          {recent?.length === 0 && <Typography variant="body2" color="text.secondary">Nothing logged yet — your flights will show up here.</Typography>}
          {recent?.length > 0 && (
            <Card sx={{ p: 0 }}>
              {recent.map((f, i) => (
                <ButtonBase
                  key={f.id}
                  onClick={() => openFlight(f)}
                  disabled={openingId != null}
                  sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, textAlign: 'left', borderTop: i ? '1px solid' : 'none', borderColor: 'divider' }}
                  data-testid={`recent-${f.id}`}
                >
                  <Box sx={{ width: 36, height: 36, borderRadius: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }}>{f.cup_count}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: 15 }}>{f.title}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{flightMeta(f)}</Typography>
                  </Box>
                  {openingId === f.id ? <CircularProgress size={18} /> : <ChevronRightIcon sx={{ color: 'text.disabled' }} />}
                </ButtonBase>
              ))}
            </Card>
          )}
        </Box>
      )}

      {printingBlank && (
        <Suspense fallback={null}>
          <PrintSheetsDialog open flight={null} onClose={() => setPrintingBlank(false)} />
        </Suspense>
      )}
      {importFile && (
        <FlightImportDialog open file={importFile} onClose={() => setImportFile(null)} onApplied={importDone} />
      )}
      <FlightDialog
        draft={draft} dispatch={dispatch} onDone={loadRecent}
        restored={restoredDraft} onFlightGone={flightGone}
      />
      <ConfirmDialog
        open={!!pendingTaste}
        title="Discard the flight in progress?"
        message={`You have a flight with ${plural(draft.picked.length, 'cup')} half done. Tasting ${pendingTaste?.name || 'this coffee'} on its own throws that away.`}
        confirmLabel="Discard and taste"
        confirmColor="error"
        onConfirm={() => { seedTaste(pendingTaste); setPendingTaste(null); }}
        onClose={() => setPendingTaste(null)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this flight?"
        message={deleteMessage(deleting)}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={() => deleteOpenFlight(deleting)}
        onClose={() => setConfirmingDelete(false)}
      />
    </Box>
  );
}

/** What deleting an open flight takes with it — the copy states what the server will do. */
function deleteMessage(f) {
  if (!f) return '';
  const n = f.logged_count ?? 0;
  const reads = n === 0 ? 'Nobody has logged yet.'
    : n === 1 && f.you_logged ? 'Your read goes with it.'
      : n === 1 ? "1 person's read goes with it." : `${n} people's reads go with it.`;
  return `${reads} The flight and its link go; the coffees stay.`;
}
