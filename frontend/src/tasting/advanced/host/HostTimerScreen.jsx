/**
 * The host's cupping timer: a dark face with the clock and phase, a "Now" card
 * with the step timeline, Start / Next pass. Every call returns the updated
 * flight, dispatched as `flightUpdated` so this screen (and the tasters' banner
 * on their next poll) follow without waiting. A 403/409 shows the server's
 * message and refetches the flight, since the likely cause is that it moved.
 */
import { useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import Screen from '../../bits/Screen';
import Card from '../../bits/Card';
import Eyebrow from '../../bits/Eyebrow';
import ConfirmDialog from '../../../common/ConfirmDialog';
import { useBusyAction } from '../../log/useBusyAction';
import { useElapsed } from './useElapsed';
import { ADV_STEPS, advancedPhase, formatClock, nextPass, stepStatus } from './advancedTimer';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';

// The face owns the 1 s tick so only it repaints each second.
function TimerFace({ flight }) {
  const elapsed = useElapsed(flight);
  const phase = advancedPhase(elapsed ?? 0, flight.adv_pass);
  return (
    <Box role="timer" aria-label="Cupping timer" sx={{ bgcolor: 'grey.900', color: 'common.white', borderRadius: 2, py: 3, px: 2, textAlign: 'center' }}>
      <Typography component="div" sx={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {formatClock(elapsed ?? 0)}
      </Typography>
      <Typography component="div" sx={{ fontWeight: 600, color: 'warning.light', mt: 0.5 }}>{phase.name}</Typography>
      <Typography component="div" variant="body2" sx={{ opacity: 0.85 }}>{phase.hint}</Typography>
    </Box>
  );
}

function NowCard({ flight }) {
  const elapsed = useElapsed(flight);
  const phase = advancedPhase(elapsed ?? 0, flight.adv_pass);
  return (
    <Card outlined sx={{ mt: 2 }}>
      <Eyebrow sx={{ mb: 0.5 }}>Now</Eyebrow>
      <Typography sx={{ fontWeight: 600, mb: 1 }}>{phase.name} · {phase.hint}</Typography>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {ADV_STEPS.map((step) => {
          const status = stepStatus(step, phase);
          return (
            <Box component="li" key={step.key} aria-current={status === 'now' ? 'step' : undefined}
              sx={{ display: 'flex', gap: 1.5, py: 0.75, opacity: status === 'done' ? 0.55 : 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 52 }}>{step.at}</Typography>
              <Box>
                <Typography sx={{ fontWeight: status === 'now' ? 700 : 400, color: status === 'now' ? 'primary.main' : 'text.primary' }}>{step.name}</Typography>
                {step.detail && <Typography variant="body2" color="text.secondary">{step.detail}</Typography>}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Card>
  );
}

export default function HostTimerScreen({ flight, dispatch, memberId, onMySheet }) {
  const [busy, run] = useBusyAction();
  const [error, setError] = useState(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const started = flight.adv_pass != null;
  // A closed cupping keeps its last pass; nothing here can move it any more.
  const closed = !flight.is_open;
  const locked = busy || closed;
  const next = nextPass(flight.adv_pass);

  const call = (action) => run(async () => {
    setError(null);
    try {
      dispatch({ type: 'flightUpdated', flight: await action() });
    } catch (e) {
      // A 409 carries a code under `error` and the line to show under `message`.
      setError(e?.response?.data?.message || apiErrorMessage(e, "Couldn't update the timer."));
      try {
        dispatch({ type: 'flightUpdated', flight: await tastingApi.getFlight(flight.id, { memberId }) });
      } catch { /* the next poll catches up */ }
    }
  });
  const start = () => call(() => tastingApi.startTimer(flight.id, { memberId }));
  const advance = () => call(() => tastingApi.setPass(flight.id, next.pass, { memberId }));

  return (
    <Screen
      title="Timer"
      onBack={onMySheet}
      trailing={started && <Button onClick={() => setConfirmRestart(true)} disabled={locked} sx={{ minHeight: 44 }}>Restart</Button>}
      footer={(
        <>
          {closed && <Typography align="center" color="text.secondary">This cupping is closed.</Typography>}
          {!started && <Button variant="contained" size="large" fullWidth disabled={locked} onClick={start} sx={{ minHeight: 52 }}>Start timer — pour now</Button>}
          {started && next && (
            <Button variant="contained" size="large" fullWidth disabled={locked} onClick={advance} sx={{ minHeight: 52 }}>Next pass: {next.label}</Button>
          )}
          {started && !next && <Typography align="center" color="text.secondary" data-testid="last-pass">Last pass — finish your scores.</Typography>}
          <Button variant="outlined" size="large" fullWidth onClick={onMySheet} sx={{ minHeight: 52 }}>My sheet</Button>
          <Typography variant="caption" color="text.secondary" align="center">
            Tasters see only the time and the pass. Passes move when you tap — cups cool at their own pace.
          </Typography>
        </>
      )}
    >
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Box sx={{ pt: 2 }}><TimerFace flight={flight} /></Box>
      <NowCard flight={flight} />
      <ConfirmDialog
        open={confirmRestart}
        title="Restart the timer?"
        message="Restart from 0:00? The pass goes back to the start."
        confirmLabel="Restart"
        onConfirm={start}
        onClose={() => setConfirmRestart(false)}
      />
    </Screen>
  );
}
