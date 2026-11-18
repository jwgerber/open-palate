/**
 * The flight — a full-screen sheet on a phone, a centred dialog above `sm`
 * (the IdeaDialog shell). Routes the draft's `screen` to one of the flight
 * screens and owns every network call the flow makes:
 *
 *   solo   : ONE POST /flights (coffees + every cup's entries) → reveal inline
 *   shared : host opens the flight from the Share screen (POST /flights,
 *            shared) → everyone, host included, POST /flights/<id>/tastings →
 *            waiting reveal polls until the host closes → GET /reveal
 *
 * The coffee list is fetched ONCE per flight here (cached a minute in the
 * API client) and handed to the picker and the add form. Online only: the
 * write buttons disable when the connection drops and the draft waits, in
 * memory and saved on the device against a refresh (decision 2026-09-10,
 * `useFlightDraft`). Nothing autofocuses.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Dialog, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfirmDialog from '../../common/ConfirmDialog';
import WhoScreen from './screens/WhoScreen';
import PickCoffeesScreen from './screens/PickCoffeesScreen';
import AddCoffeeForm from './screens/AddCoffeeForm';
import EntryScreen from './screens/EntryScreen';
import AdvancedEntryScreen from '../advanced/AdvancedEntryScreen';
import HostSetupScreen from '../advanced/host/HostSetupScreen';
import HostTimerScreen from '../advanced/host/HostTimerScreen';
import ReviewScreen from './screens/ReviewScreen';
import RevealScreen from './screens/RevealScreen';
import SummaryScreen from '../summary/SummaryScreen';
import Screen from '../bits/Screen';
import { LIVE_POLL_MS, POLL_MS } from './shareSupport';
import { usePoll } from '../../common/usePoll';
import { useBusyAction } from './useBusyAction';
import { buildFlightBody, buildEntries, isAdvancedFlight } from './flightDraft';
import { blurActive } from '../entry/useEntryActions';
import { useOnline } from '../../common/useOnline';
import { useTastingIdentity } from '../useTastingIdentity';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';

// Only a host who taps Share needs the QR encoder — keep it out of the Log tab's chunk.
const ShareFlightScreen = lazy(() => import('./screens/ShareFlightScreen'));

const Spinner = () => <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;

export default function FlightDialog({ draft, dispatch, onDone, restored = false, onFlightGone }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const online = useOnline();
  const { isPerson, canManage } = useTastingIdentity();
  const [busy, run] = useBusyAction();
  const [wheelPath, setWheelPath] = useState([]);   // survives the Review round-trip
  const [confirmClose, setConfirmClose] = useState(false);
  const [coffees, setCoffees] = useState(null);      // { coffees, roasters } | null while loading
  const [coffeesError, setCoffeesError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Closing: the draft is reset only once the sheet has faded out, so the
  // last screen fades rather than blanking first (`reset` would empty the body
  // in the same commit that starts the exit).
  const [closing, setClosing] = useState(false);
  // An account that is not a person (the shared device) names the taster; that id
  // rides on every write and identity-bearing read.
  const memberId = !isPerson ? draft.who?.id ?? null : null;
  const open = draft.screen !== 'landing' && !closing;
  const hasProgress = draft.picked.length > 0 && !draft.logged;
  const needsCoffees = open && (draft.screen === 'picker' || draft.screen === 'add');

  const go = (screen) => dispatch({ type: 'screen', screen });
  // The host or an editor runs the timer; the server is the authority, this only hides the way in.
  const mayRunTimer = isAdvancedFlight(draft) && !!draft.flightId && !!draft.flight && (!!draft.flight.is_host || canManage);
  const openTimer = () => go(draft.flight.timer_elapsed_s == null ? 'hostSetup' : 'hostTimer');
  const finish = () => setClosing(true);
  const onExited = () => {
    if (!closing) return;
    setClosing(false);
    dispatch({ type: 'reset' });
    setWheelPath([]);
    onDone?.();
  };
  const requestClose = () => {
    if (draft.logged || !hasProgress) finish(); else setConfirmClose(true);
  };

  useEffect(() => {
    if (!needsCoffees) return undefined;
    let live = true;
    tastingApi.getCoffees()
      .then((d) => { if (live) { setCoffees(d); setCoffeesError(null); } })
      .catch((e) => { if (live) setCoffeesError(apiErrorMessage(e, "Couldn't load coffees.")); });
    return () => { live = false; };
  }, [needsCoffees, reloadToken]);

  // A draft saved before a refresh holds an old copy of the flight: re-read it once. The read may
  // have gone in just before the refresh, or the flight may be gone. Any other failure keeps the
  // scores on screen; Log reports the real problem. No cleanup: this runs only once, so a
  // StrictMode remount must not cancel it.
  const recheckRestored = useRef(restored);
  useEffect(() => {
    if (!recheckRestored.current) return;
    recheckRestored.current = false;
    if (!draft.flightId) return;
    const flightId = draft.flightId;
    tastingApi.getFlight(flightId, { memberId })
      .then((flight) => dispatch({ type: 'restoreChecked', flightId, flight }))
      .catch((e) => {
        if (e?.response?.status !== 404) return;
        dispatch({ type: 'restoreChecked', flightId, flight: null });
        onFlightGone?.();
      });
  }, [draft.flightId, memberId, dispatch, onFlightGone]);

  const logFlight = () => run(async () => {
    if (!online) return;
    dispatch({ type: 'error', error: null });
    try {
      if (draft.shared && draft.flightId) {
        const flight = await tastingApi.logTastings(draft.flightId, buildEntries(draft), { memberId });
        dispatch({ type: 'logged', flight });
      } else {
        const res = await tastingApi.createFlight(buildFlightBody(draft, { memberId }));
        dispatch({ type: 'logged', flight: res, result: res.reveal });
      }
    } catch (e) {
      const code = e?.response?.status === 409 ? e.response.data?.error : null;
      if (code === 'already_logged') {
        // Already in (a double tap, or logged from another device): straight to the wait.
        // The 409 proves a read of mine exists, though the flight we hold predates it.
        dispatch({ type: 'logged', flight: draft.flight && { ...draft.flight, you_logged: true } });
      } else if (code === 'flight_closed') {
        dispatch({ type: 'error', error: 'The host closed this cupping.' });
      } else {
        // A 409's `error` is a code; its `message` is the line meant for people.
        const message = e?.response?.data?.message || apiErrorMessage(e, "Couldn't log the flight. Your draft is still here.");
        dispatch({ type: 'error', error: message });
      }
    }
  });

  const closeFlight = () => run(async () => {
    if (!draft.flightId) return;
    try {
      await tastingApi.closeFlight(draft.flightId, { memberId });
      const result = await tastingApi.getFlightResult({ id: draft.flightId, sheet: draft.sheet }, { memberId });
      dispatch({ type: 'revealed', result });
    } catch (e) {
      dispatch({ type: 'error', error: apiErrorMessage(e, "Couldn't close the flight.") });
    }
  });

  // The host saved an edit to the cups: rebuild the draft's cup list from the server.
  // A failure reaches the edit dialog, which is what the host is looking at.
  const flightEdited = async () => {
    dispatch({ type: 'flightEdited', flight: await tastingApi.getFlight(draft.flightId, { memberId }) });
  };

  // A paper sheet typed in (or removed) after the reveal: re-read the summary in place.
  const refreshResult = async () => {
    try {
      const result = await tastingApi.getFlightResult({ id: draft.flightId, sheet: draft.sheet }, { memberId });
      dispatch({ type: 'revealed', result });
    } catch (e) {
      dispatch({ type: 'error', error: apiErrorMessage(e, "Couldn't refresh the summary.") });
    }
  };

  // "Delete this tasting": my read of this flight (every cup). A solo flight
  // goes with it; a shared flight stays for everyone else. Mirrors the
  // server's gates: only when I logged a read (`you_logged` — opening a closed
  // flight from Recent marks the draft logged either way, and a host who only
  // typed paper sheets in has no read of their own), never from the shared device
  // door, and not after a shared flight has been revealed unless an editor or admin.
  const flightNow = draft.result?.flight || draft.flight;
  const revealedShared = draft.shared && flightNow && !flightNow.is_open && (flightNow.logged_count ?? 0) > 1;
  const mayDeleteMine = isPerson && draft.logged && !!draft.flightId && !!flightNow?.you_logged
    && (canManage || !revealedShared);
  const deleteMine = () => run(async () => {
    try {
      await tastingApi.deleteTastings(draft.flightId);
      finish();
    } catch (e) {
      dispatch({ type: 'error', error: apiErrorMessage(e, "Couldn't delete the tasting.") });
    }
  });
  // The host tears the whole shared flight down while nobody else has logged;
  // an editor or admin may also delete a closed shared one (test cleanup), as
  // delete_flight allows. A solo flight already goes with "Delete this tasting".
  const hostAlone = draft.shared && flightNow?.is_host
    && (flightNow.logged_count ?? 0) <= (flightNow.you_logged ? 1 : 0);
  const closedForManager = canManage && draft.shared && flightNow?.is_open === false;
  const mayDeleteFlight = isPerson && !!draft.flightId && !!(hostAlone || closedForManager);
  const deleteWholeFlight = () => run(async () => {
    try {
      await tastingApi.deleteFlight(draft.flightId);
      finish();
    } catch (e) {
      dispatch({ type: 'error', error: apiErrorMessage(e, "Couldn't delete the flight.") });
    }
  });

  // Waiting reveal: poll the flight until it closes, then fetch the reveal.
  const waiting = draft.screen === 'reveal' && draft.logged && !draft.result && !!draft.flightId;
  const flightId = draft.flightId;
  const sheet = draft.sheet;
  const loggedCount = draft.flight?.logged_count;
  const rosterSize = draft.flight?.roster?.length;
  const tick = useCallback(async (isLive) => {
    try {
      const f = await tastingApi.getFlight(flightId, { memberId });
      if (!isLive()) return;
      if (f.is_open) {
        // Only repaint the sheet when the roster actually moved.
        if (f.logged_count !== loggedCount || f.roster?.length !== rosterSize) dispatch({ type: 'flightUpdated', flight: f });
        return;
      }
      const result = await tastingApi.getFlightResult({ id: flightId, sheet }, { memberId });
      if (isLive()) dispatch({ type: 'revealed', result });
    } catch { /* keep polling */ }
  }, [flightId, sheet, memberId, dispatch, loggedCount, rosterSize]);
  usePoll(waiting, tick, POLL_MS);

  // Live poll: while a taster scores an open Advanced cupping, follow the host's timer and passes.
  // It only dispatches `flightUpdated` (never the reveal), so a close mid-entry hides the
  // banner and leaves the taster on their sheet; logging then gets the 409 flight_closed path.
  // `timer_elapsed_s` is deliberately not compared — it grows every poll and useElapsed re-anchors itself.
  const live = draft.flight?.sheet === 'advanced' && !!draft.flight.is_open && !draft.logged
    && ['entry', 'hostSetup', 'hostTimer'].includes(draft.screen);
  const timerStartedAt = draft.flight?.timer_started_at;
  const advancedPass = draft.flight?.adv_pass;
  const isOpen = draft.flight?.is_open;
  const liveTick = useCallback(async (isLive) => {
    try {
      const f = await tastingApi.getFlight(flightId, { memberId });
      if (!isLive()) return;
      const changed = f.timer_started_at !== timerStartedAt || f.adv_pass !== advancedPass || f.is_open !== isOpen
        || f.logged_count !== loggedCount || f.roster?.length !== rosterSize;
      if (changed) dispatch({ type: 'flightUpdated', flight: f });
    } catch { /* keep polling */ }
  }, [flightId, memberId, dispatch, timerStartedAt, advancedPass, isOpen, loggedCount, rosterSize]);
  usePoll(live, liveTick, LIVE_POLL_MS);

  let body;
  switch (draft.screen) {
    case 'who':
      body = (
        <WhoScreen onClose={requestClose}
          onPick={(person) => { dispatch({ type: 'who', who: person }); go('picker'); }} />
      );
      break;
    case 'picker':
      body = (
        <PickCoffeesScreen
          draft={draft} dispatch={dispatch}
          coffees={coffees?.coffees ?? null} error={coffeesError}
          onClose={requestClose} onSomethingElse={() => go('add')} onStart={() => go('entry')}
          onShare={() => go('share')}
        />
      );
      break;
    case 'add':
      body = (
        <Screen title="Something else" onBack={() => go('picker')} bodySx={{ pt: 2 }}>
          <AddCoffeeForm
            mode="picker" roasters={coffees?.roasters ?? []}
            onUseExisting={(coffee) => {
              if (!draft.picked.some((c) => c.id === coffee.id)) dispatch({ type: 'togglePick', coffee });
              go('picker');
            }}
            onAdded={(coffee) => { dispatch({ type: 'togglePick', coffee: { ...coffee, n: 0 } }); setReloadToken((t) => t + 1); go('picker'); }}
          />
        </Screen>
      );
      break;
    case 'share':
      body = (
        <Suspense fallback={<Spinner />}>
          <ShareFlightScreen
            draft={draft} dispatch={dispatch} memberId={memberId}
            onBack={() => go(draft.flightId ? 'entry' : 'picker')}
            backLabel={draft.flightId ? 'Back to tasting' : 'Back to the flight'}
            onSetUpTable={mayRunTimer ? () => go('hostSetup') : undefined}
            onFlightEdited={flightEdited}
          />
        </Suspense>
      );
      break;
    case 'entry': {
      const Entry = isAdvancedFlight(draft) ? AdvancedEntryScreen : EntryScreen;
      body = (
        <Entry
          draft={draft} dispatch={dispatch} online={online} busy={busy} onClose={requestClose}
          onShare={draft.shared && !draft.viaLink ? () => { blurActive(); go('share'); } : undefined}
          onReview={() => go('review')} onLog={logFlight} path={wheelPath} onPath={setWheelPath}
          onOpenTimer={mayRunTimer ? () => { blurActive(); openTimer(); } : undefined}
        />
      );
      break;
    }
    case 'hostSetup':
      body = (
        <HostSetupScreen
          flight={draft.flight} memberId={memberId}
          onBack={() => go('entry')} onOpenTimer={() => go('hostTimer')} onFlightEdited={flightEdited}
        />
      );
      break;
    case 'hostTimer':
      body = <HostTimerScreen flight={draft.flight} dispatch={dispatch} memberId={memberId} onMySheet={() => go('entry')} />;
      break;
    case 'review':
      body = <ReviewScreen draft={draft} dispatch={dispatch} online={online} busy={busy} onBack={() => go('entry')} onLog={logFlight} />;
      break;
    case 'reveal': {
      // A Advanced flight's result is a cupping summary (`coffees`), which RevealScreen can't read (`cups`).
      const Result = isAdvancedFlight(draft) ? SummaryScreen : RevealScreen;
      body = (
        <Result
          draft={draft} onDone={finish} onCloseFlight={closeFlight} closing={busy}
          onDelete={mayDeleteMine ? deleteMine : undefined}
          onDeleteFlight={mayDeleteFlight ? deleteWholeFlight : undefined}
          onRefreshResult={refreshResult} memberId={memberId}
        />
      );
      break;
    }
    default:
      body = null;
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        fullScreen={fullScreen}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: { 'aria-label': 'Tasting flight', sx: { height: fullScreen ? '100%' : 'min(844px, 92vh)', bgcolor: 'background.default' } },
          transition: { onExited },
        }}
      >
        {body}
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        title="Discard this flight?"
        message="Nothing has been logged yet. Closing throws away what you've entered so far."
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={() => { setConfirmClose(false); finish(); }}
        onClose={() => setConfirmClose(false)}
      />
    </>
  );
}
