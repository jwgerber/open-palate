/**
 * The "All cups" bottom sheet — the log point of a Advanced flight. A 3-column grid
 * of cup tiles (total, n/10 or a dash; state; own vote; D/Q mark), a warning
 * naming half-done cups with a Clear each, and "Log N cups". A cup needs all
 * ten scores and a vote to log; skipped cups are fine.
 */
import { useState } from 'react';
import { Box, Button, ButtonBase, Drawer, Typography, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ConfirmDialog from '../../common/ConfirmDialog';
import { focusRing, shadeText } from '../bits/a11y';
import { BAR_VOTE_LABELS, ADV_CATEGORIES, ADV_DQ_VALUE } from '../content';
import { advancedNotesOnly, advancedScored, advancedState, advancedTotal, canLogAdvanced, entryFor } from '../log/flightDraft';

const STATE_TEXT = { done: 'done', half: 'half-done', empty: 'not started' };

function halfWarning(letters) {
  const one = letters.length === 1;
  const names = one ? `Cup ${letters[0]}` : `Cups ${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`;
  const them = one ? 'it' : 'them';
  return `${names} ${one ? 'is' : 'are'} half-done. Finish ${them}, or clear ${them} to skip — a cup needs all ${ADV_CATEGORIES.length} scores and a vote.`;
}

const joinLetters = (letters) => (letters.length === 1
  ? `Cup ${letters[0]} has`
  : `Cups ${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]} have`);

function tileLabel(r) {
  const parts = [`Cup ${r.letter}`, STATE_TEXT[r.state]];
  if (r.state === 'done') parts.push(advancedTotal(r.e).toFixed(1));
  else if (r.scored) parts.push(`${r.scored} of ${ADV_CATEGORIES.length} scored`);
  if (r.e.vote) parts.push(BAR_VOTE_LABELS[r.e.vote]);
  if (Object.values(r.e.advanced).includes(ADV_DQ_VALUE)) parts.push('D/Q');
  return parts.join(', ');
}

export default function AllCupsSheet({ open, draft, cups, cur, online, busy, onClose, onSelect, onClear, onLog, variant = 'live' }) {
  const [clearing, setClearing] = useState(null);
  // Closed, the sheet renders nothing worth computing; skip the per-cup work.
  const rows = open ? draft.picked.map((c, i) => {
    const e = entryFor(draft, c.id);
    return { id: c.id, letter: cups[i].letter, i, e, state: advancedState(e), scored: advancedScored(e) };
  }) : [];
  const stranded = open ? advancedNotesOnly(draft).map((c) => rows.find((r) => r.id === c.id)?.letter).filter(Boolean) : [];
  const half = rows.filter((r) => r.state === 'half');
  const doneCount = rows.filter((r) => r.state === 'done').length;
  const ok = canLogAdvanced(draft) && online && !busy;

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
      slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-label': 'All cups', sx: { maxHeight: '88%', borderRadius: '16px 16px 0 0' } } }}
    >
      <Box sx={{ p: 2, pb: 0, overflowY: 'auto' }}>
        <Typography variant="h3" component="h3" sx={{ fontSize: 20 }}>All cups</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {doneCount} done · {half.length} half-done · {rows.length - doneCount - half.length} not started
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          {rows.map((r) => (
            <ButtonBase
              key={r.id}
              onClick={() => onSelect(r.i)}
              aria-label={tileLabel(r)}
              aria-current={r.i === cur ? 'true' : undefined}
              sx={{
                minHeight: 92, p: 1.25, borderRadius: 2, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between',
                textAlign: 'left',
                border: r.i === cur ? '2px solid' : '1px solid', borderColor: r.state === 'half' ? 'warning.main' : r.i === cur ? 'primary.main' : 'divider',
                bgcolor: (t) => (r.i === cur ? alpha(t.palette.primary.main, 0.08) : t.palette.background.paper),
                ...focusRing,
              }}
            >
              <Typography sx={{ fontWeight: 600, fontSize: 18, lineHeight: 1 }}>{r.letter}</Typography>
              <Typography sx={{ fontWeight: 600, fontSize: 18 }}>
                {r.state === 'done' ? advancedTotal(r.e).toFixed(1) : r.scored ? `${r.scored}/${ADV_CATEGORIES.length}` : '—'}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                <Typography
                  variant="caption"
                  color={r.state === 'half' ? 'text.primary' : 'text.secondary'}
                  sx={r.state === 'half' ? { fontWeight: 600 } : undefined}
                >
                  {r.i !== cur ? STATE_TEXT[r.state] : r.state === 'empty' ? 'you are here' : `${STATE_TEXT[r.state]} · current`}
                </Typography>
                {r.e.vote && <Typography variant="caption" sx={{ fontWeight: 600 }}>{BAR_VOTE_LABELS[r.e.vote]}</Typography>}
                {Object.values(r.e.advanced).includes(ADV_DQ_VALUE) && (
                  <Typography variant="caption" sx={{ fontWeight: 600, color: shadeText('error') }}>D/Q</Typography>
                )}
              </Box>
            </ButtonBase>
          ))}
        </Box>
        {half.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {halfWarning(half.map((r) => r.letter))}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {half.map((r) => (
                <Button key={r.id} size="small" variant="outlined" color="warning"
                  sx={{ minHeight: 44, color: 'text.primary', borderColor: 'warning.main' }}
                  aria-label={`Clear Cup ${r.letter}`} onClick={() => setClearing(r)}>
                  Clear {r.letter}
                </Button>
              ))}
            </Box>
          </Alert>
        )}
        {stranded.length > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {joinLetters(stranded)} notes or flavors but no scores — they won't be logged.
          </Alert>
        )}
        {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
        {!online && <Alert severity="warning" sx={{ mt: 2 }}>No connection — your draft is kept here until you're back online.</Alert>}
      </Box>
      <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Button variant="contained" size="large" disabled={!ok} onClick={onLog} sx={{ minHeight: 52 }}>
          {variant === 'paper'
            ? (busy ? 'Saving…' : `Save ${doneCount} cup${doneCount === 1 ? '' : 's'}`)
            : (busy ? 'Logging…' : `Log ${doneCount} cup${doneCount === 1 ? '' : 's'}`)}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          {variant === 'paper'
            ? 'Skipping cups is fine. The sheet joins the summary when you save.'
            : 'Skipping cups is fine. Nothing is shared until the host closes.'}
        </Typography>
      </Box>
      <ConfirmDialog
        open={!!clearing}
        title={clearing ? (clearing.scored ? `Clear Cup ${clearing.letter}'s ${clearing.scored} score${clearing.scored === 1 ? '' : 's'}?` : `Clear Cup ${clearing.letter}'s vote?`) : ''}
        message="This removes its scores and vote. Flavors, defects and notes stay."
        confirmLabel="Clear"
        confirmColor="warning"
        sx={{ zIndex: (t) => t.zIndex.modal + 2 }}
        onConfirm={() => onClear(clearing.id)}
        onClose={() => setClearing(null)}
      />
    </Drawer>
  );
}
