/**
 * Reveal — what earns the next entry (spec §5.2). Two states:
 *
 * WAITING (a shared flight still open): "Logged", the roster, and — for the
 * host, or an admin holding a group admin — "Close flight & reveal".
 * Nobody sees anyone's scores, the host included, until the flight closes.
 *
 * REVEALED: per cup, thin data ("You're one of the first") under the
 * consensus threshold, else the average with spread, where you landed, the
 * descriptor split (you + others / just you / others said) and your read.
 */
import { useState } from 'react';
import { Box, Button, Typography, Alert } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ConfirmDialog from '../../../common/ConfirmDialog';
import { alpha } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LockIcon from '@mui/icons-material/Lock';
import Screen from '../../bits/Screen';
import Eyebrow from '../../bits/Eyebrow';
import Card from '../../bits/Card';
import Stars from '../../bits/Stars';
import ConsensusHeadline from '../../bits/ConsensusHeadline';
import YourRead from '../../bits/YourRead';
import { Roster } from '../../bits/People';
import CupStrip from '../../entry/CupStrip';
import { CONSENSUS_THRESHOLD } from '../../content';
import { tintOf } from '../../lexicon';
import { plural, scalePct } from '../../format';
import { useTastingIdentity } from '../../useTastingIdentity';

/** A destructive footer action behind a confirm. */
function DeleteAction({ onDelete, busy, label, title, message }) {
  const [confirm, setConfirm] = useState(false);
  if (!onDelete) return null;
  return (
    <>
      <Button color="error" size="small" startIcon={<DeleteOutlineIcon />} onClick={() => setConfirm(true)} disabled={busy} sx={{ alignSelf: 'center', minHeight: 44 }}>
        {label}
      </Button>
      <ConfirmDialog
        open={confirm}
        title={title}
        message={message}
        confirmLabel="Delete"
        confirmColor="error"
        onConfirm={() => { setConfirm(false); onDelete(); }}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}

/** "Delete this tasting" — my read of this flight. The copy states what the server will do. */
export function DeleteMine({ onDelete, busy, shared }) {
  return (
    <DeleteAction
      onDelete={onDelete}
      busy={busy}
      label="Delete this tasting"
      title="Delete this tasting?"
      message={shared
        ? "Your read of every cup in this flight goes. Everyone else's stays. While the flight is open you can taste it again from its link."
        : 'Your read of every cup in this flight goes, and the flight with it. The coffees stay.'}
    />
  );
}

/** "Delete this flight" once a shared flight has closed: an editor or admin, or the host nobody else joined. */
export function DeleteClosedFlight({ onDelete, busy }) {
  return (
    <DeleteAction
      onDelete={onDelete}
      busy={busy}
      label="Delete this flight"
      title="Delete this flight?"
      message="The flight and every read in it go. The coffees stay."
    />
  );
}

export function WaitingState({ flight, error, onClose, onCloseFlight, onDelete, onDeleteFlight, closing }) {
  const { canCloseAny } = useTastingIdentity();
  const total = flight.roster.length;
  const logged = flight.logged_count;
  const mayClose = flight.is_host || canCloseAny;
  return (
    <Screen
      title="Logged"
      onClose={onClose}
      footer={(
        <>
          {mayClose && (
            <Button variant="contained" size="large" startIcon={<LockIcon />} onClick={onCloseFlight} disabled={closing} sx={{ minHeight: 52 }}>
              {closing ? 'Closing…' : flight.is_host ? 'Close flight & reveal' : 'Close this flight (admin)'}
            </Button>
          )}
          <Button variant="outlined" size="large" onClick={onClose} sx={{ minHeight: 48 }}>Done for now</Button>
          <DeleteMine onDelete={onDelete} busy={closing} shared />
          <DeleteAction
            onDelete={onDeleteFlight}
            busy={closing}
            label="Delete this flight"
            title="Delete this flight?"
            message="Nobody else has logged yet. The flight, its link and your read go; the coffees stay."
          />
        </>
      )}
    >
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      <Box sx={{ textAlign: 'center', pt: 4, pb: 3 }}>
        <CheckCircleIcon sx={{ fontSize: 44, color: 'success.main' }} />
        <Typography variant="h3" sx={{ mt: 1 }}>Logged</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mx: 'auto', maxWidth: 360 }}>
          {flight.is_host
            ? "Your entries are in. Close the flight when the table's done and everyone gets the reveal."
            : `${flight.host_name} closes the flight when everyone's done. Until then nobody sees anyone else's scores — including ${flight.host_name}.`}
        </Typography>
      </Box>
      <Eyebrow sx={{ mb: 1 }}>{logged} of {total} logged</Eyebrow>
      <Roster roster={flight.roster} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Your entry is saved. You'll get the reveal here — and in your recent flights — once the flight closes.
      </Typography>
    </Screen>
  );
}

function ConsensusAxis({ avg, spread, yours }) {
  const lo = Math.max(1, avg - spread);
  const hi = Math.min(5, avg + spread);
  return (
    <Box sx={{ position: 'relative', height: 28, my: 1.5 }} aria-hidden>
      <Box sx={{ position: 'absolute', left: 0, right: 0, top: 13, height: 2, bgcolor: 'divider' }} />
      <Box sx={{ position: 'absolute', top: 8, height: 12, borderRadius: 6, left: scalePct(lo), width: `calc(${scalePct(hi)} - ${scalePct(lo)})`, bgcolor: (t) => alpha(t.palette.primary.main, 0.12) }} />
      <Box sx={{ position: 'absolute', top: 6, width: 2, height: 16, bgcolor: 'primary.main', left: scalePct(avg), transform: 'translateX(-50%)' }} />
      {yours != null && (
        <Box sx={{ position: 'absolute', top: 5, width: 18, height: 18, borderRadius: '50%', border: '2px solid', borderColor: 'text.primary', bgcolor: 'background.paper', left: scalePct(yours), transform: 'translateX(-50%)' }} />
      )}
    </Box>
  );
}

const pillSx = (kind, term) => {
  if (kind === 'shared') return { bgcolor: 'primary.main', color: 'primary.contrastText' };
  if (kind === 'yours') return { bgcolor: 'background.paper', color: 'text.primary', border: '1px solid', borderColor: 'primary.main' };
  return { bgcolor: (t) => t.palette.action.selected, color: 'text.secondary', outline: `2px solid ${tintOf(term)}`, outlineOffset: -2 };
};

export function RevealedCup({ cup }) {
  const c = cup.consensus;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ pt: 2 }}>
        <Typography variant="h3" sx={{ fontSize: 20 }}>{cup.name}</Typography>
        <Typography variant="body2" color="text.secondary">{cup.roaster}</Typography>
      </Box>
      {!c ? (
        <Card outlined>
          <Typography sx={{ fontWeight: 600 }}>You're one of the first.</Typography>
          <Typography variant="body2" color="text.secondary">
            {plural(cup.n, 'tasting')} so far — consensus shows at {CONSENSUS_THRESHOLD}. Your read is saved and will anchor nobody.
          </Typography>
        </Card>
      ) : (
        <Card outlined>
          <ConsensusHeadline
            consensus={c}
            countLabel={plural(c.n, 'tasting')}
            spreadSuffix=" staff"
            trailing={cup.yours && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Stars value={cup.yours.overall} size={16} />
                <Typography variant="caption" color="text.secondary">you</Typography>
              </Box>
            )}
          />
          <ConsensusAxis avg={c.avg_overall} spread={c.spread} yours={cup.yours?.overall} />
          {cup.verdict && <Typography variant="body2" color="text.secondary">{cup.verdict}</Typography>}
        </Card>
      )}
      {cup.descriptors?.length > 0 && (
        <Card outlined>
          <Eyebrow>Descriptors</Eyebrow>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
            {cup.descriptors.map((d) => (
              <Box key={d.term} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 32, px: 1.5, borderRadius: 9999, fontSize: 13, fontWeight: 500, ...pillSx(d.kind, d.term) }}>
                {d.label}
                {d.pct != null && <Typography component="span" sx={{ fontSize: 11, opacity: 0.8 }}>{d.pct}%</Typography>}
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mt: 1.5 }}>
            {[['shared', 'you + others'], ['yours', 'just you'], ['others', 'others said']].map(([kind, label]) => (
              <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: 5, ...pillSx(kind, 'Other'), outline: 'none', border: kind === 'yours' ? '1.5px solid' : 'none', borderColor: 'primary.main' }} />
                <Typography variant="caption" color="text.secondary">{label}</Typography>
              </Box>
            ))}
          </Box>
        </Card>
      )}
      {cup.yours && (
        <Card outlined>
          <YourRead read={cup.yours} />
        </Card>
      )}
    </Box>
  );
}

export default function RevealScreen({ draft, onDone, onCloseFlight, onDelete, onDeleteFlight, closing = false }) {
  const [cur, setCur] = useState(0);
  const flight = draft.result?.flight || draft.flight;
  const cups = draft.result?.cups;
  if (!cups) {
    if (!flight) return null;
    return (
      <WaitingState
        flight={flight} error={draft.error} onClose={onDone} onCloseFlight={onCloseFlight}
        onDelete={onDelete} onDeleteFlight={onDeleteFlight} closing={closing}
      />
    );
  }
  const idx = Math.min(cur, cups.length - 1);
  const cup = cups[idx];
  return (
    <Screen
      title="Reveal"
      onClose={onDone}
      footer={(
        <>
          <CupStrip cups={cups.map((c) => ({ id: c.coffee_id ?? c.position, label: c.name, scored: true }))} cur={idx} onSelect={setCur} />
          <Button variant="contained" size="large" onClick={onDone} sx={{ minHeight: 52 }}>Done</Button>
          <DeleteMine onDelete={onDelete} busy={closing} shared={!!draft.shared} />
          <DeleteClosedFlight onDelete={onDeleteFlight} busy={closing} />
        </>
      )}
    >
      {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
      <RevealedCup cup={cup} />
    </Screen>
  );
}
