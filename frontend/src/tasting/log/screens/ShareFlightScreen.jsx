/**
 * Share this flight (host). Opening this screen CREATES the shared flight on
 * the server (coffees, pour order, prep, name, blind) — that is what mints the
 * link — so from here on the cups are fixed and the host logs through
 * `POST /flights/<id>/tastings` like everyone else. Name and Blind are sent on
 * create and locked afterwards: blind cannot flip mid-flight.
 *
 * The roster polls every 5s while this screen is up and visible (usePoll),
 * with a leading tick so the first scan shows the moment it lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Switch, TextField, Typography, Alert, CircularProgress } from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Screen from '../../bits/Screen';
import Eyebrow from '../../bits/Eyebrow';
import Segments from '../../bits/Segments';
import { Roster } from '../../bits/People';
import LabelKeyCard from '../../advanced/host/LabelKeyCard';
import { useTastingIdentity } from '../../useTastingIdentity';
import { ADV_STEPS } from '../../content';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';
import { buildFlightBody } from '../flightDraft';
import { useBusyAction } from '../useBusyAction';
import { usePoll } from '../../../common/usePoll';
import { POLL_MS, flightLink } from '../shareSupport';

const STEP_OPTIONS = ADV_STEPS.map((v) => [v, String(v)]);

export default function ShareFlightScreen({ draft, dispatch, memberId, onBack, onSetUpTable, backLabel = 'Back to the flight', onFlightEdited }) {
  const { isSharedDevice } = useTastingIdentity();
  const [creating, run] = useBusyAction();
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const created = !!draft.flightId;
  const f = draft.flight;
  // Advanced flights get the key on the Advanced host screen; showing it here too would put it on screen twice.
  const mayKey = created && !!f?.is_blind && !!f.is_host && f.sheet !== 'advanced' && !isSharedDevice;
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const create = () => run(async () => {
    if (draft.flightId) return;
    setError(null);
    try {
      const flight = await tastingApi.createFlight(buildFlightBody({ ...draft, shared: true }, { memberId }));
      dispatch({ type: 'sharedCreated', flight });
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't open the shared flight."));
    }
  });

  const flightId = draft.flightId;
  const loggedCount = draft.flight?.logged_count;
  const rosterSize = draft.flight?.roster?.length;
  const tick = useCallback((isLive) => tastingApi.getFlight(flightId, { memberId })
    .then((f) => {
      if (!isLive()) return;
      if (f.logged_count !== loggedCount || f.roster?.length !== rosterSize) dispatch({ type: 'flightUpdated', flight: f });
    })
    .catch(() => {}), [flightId, memberId, dispatch, loggedCount, rosterSize]);
  usePoll(created, tick, POLL_MS);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flightLink(draft.flightId));
      setCopied(true);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — long-press the link to copy it.');
    }
  };

  return (
    <Screen
      title="Share this flight"
      onBack={onBack}
      footer={<Button variant="outlined" size="large" fullWidth onClick={onBack} sx={{ minHeight: 52 }}>{backLabel}</Button>}
    >
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        Anyone with the link tastes the same coffees in the same pour order, and logs against this sitting. Nobody sees anyone's scores until you close it.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Eyebrow sx={{ mb: 0.5 }}>Flight name</Eyebrow>
      <TextField
        fullWidth
        value={draft.flightName}
        onChange={(e) => dispatch({ type: 'flightName', name: e.target.value })}
        disabled={created}
        placeholder="e.g. George Howell samples"
        inputProps={{ 'aria-label': 'Flight name', style: { fontSize: 16 } }}
        sx={{ mb: 2 }}
      />
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, py: 1.5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 600 }}>Blind</Typography>
          <Typography variant="body2" color="text.secondary">Tasters see only cup labels instead of names until the reveal</Typography>
        </Box>
        <Switch checked={!!draft.blind} disabled={created} onChange={(e) => dispatch({ type: 'blind', blind: e.target.checked })} inputProps={{ 'aria-label': 'Blind' }} />
      </Box>
      {draft.sheet === 'advanced' && (
        <Box sx={{ mb: 2 }}>
          <Eyebrow sx={{ mb: 0.5 }}>Score sheet</Eyebrow>
          <Typography sx={{ fontWeight: 600 }}>Advanced</Typography>
          <Box sx={{ mt: 1.5 }}>
            <Eyebrow sx={{ mb: 0.5 }}>Steps</Eyebrow>
            <Segments ariaLabel="Steps" options={STEP_OPTIONS} value={draft.advancedStep} disabled={created}
              onChange={(step) => dispatch({ type: 'advancedStep', step })} />
          </Box>
        </Box>
      )}

      {!created ? (
        <Button variant="contained" size="large" fullWidth onClick={create} disabled={creating} sx={{ minHeight: 52, mb: 2 }}>
          {creating ? <CircularProgress size={22} color="inherit" /> : 'Open the flight & get a link'}
        </Button>
      ) : (
        <>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', mb: 2 }}>
            <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'common.white', display: 'flex', alignItems: 'center' }}>
              <QRCodeSVG value={flightLink(draft.flightId)} size={96} bgColor="transparent" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography sx={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }} data-testid="flight-link">
                {flightLink(draft.flightId)}
              </Typography>
              <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={copy} sx={{ minHeight: 44 }}>{copied ? 'Copied' : 'Copy link'}</Button>
            </Box>
          </Box>
          <Eyebrow sx={{ mb: 0.5 }}>Who's in</Eyebrow>
          {draft.flight?.roster ? <Roster roster={draft.flight.roster} /> : null}
          {mayKey && <LabelKeyCard flightId={draft.flightId} flightName={f?.name || draft.flightName} memberId={memberId} flight={f} onFlightEdited={onFlightEdited} />}
          {onSetUpTable && <Button variant="outlined" fullWidth onClick={onSetUpTable} sx={{ minHeight: 44, mt: 2 }}>Set up the table</Button>}
        </>
      )}
    </Screen>
  );
}
