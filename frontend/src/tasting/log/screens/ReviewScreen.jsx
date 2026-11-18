/**
 * Last look — not a ranking, a side-by-side read of every cup so "fruity" on
 * all three can be sharpened. Tap a card to go back and revise. One write for
 * the whole flight; Log stays disabled while any Overall is missing.
 */
import { Box, Button, ButtonBase, Typography, Alert } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import Screen from '../../bits/Screen';
import Stars from '../../bits/Stars';
import AttributeBars from '../../bits/AttributeBars';
import TermChip from '../../entry/TermChip';
import { entryFor, missingOverall, canLog } from '../flightDraft';

export function ReviewCard({ index, coffee, entry, onOpen }) {
  const missing = entry.vals.overall == null;
  const tags = Object.entries(entry.tags);
  const defects = Object.keys(entry.defects);
  return (
    <ButtonBase
      onClick={onOpen}
      sx={{
        width: '100%', textAlign: 'left', display: 'block', p: 2, borderRadius: 2, bgcolor: 'background.paper',
        border: '1px solid', borderColor: missing ? 'error.main' : 'divider', boxShadow: (t) => t.shadows[1],
      }}
      data-testid={`review-card-${coffee.id}`}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          <Typography component="span" variant="overline" sx={{ mr: 1, fontSize: 11, letterSpacing: '0.1em', color: 'text.secondary' }}>Cup {index + 1}</Typography>
          {coffee.label || coffee.name}
        </Typography>
        {missing ? <Typography sx={{ color: 'error.main', fontWeight: 600 }}>—</Typography> : <Stars value={entry.vals.overall} />}
      </Box>
      <AttributeBars vals={entry.vals} sx={{ mt: 1.5 }} />
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
          {tags.map(([term, strength]) => <TermChip key={term} term={term} strength={strength} size="sm" />)}
        </Box>
      )}
      {defects.length > 0 && (
        <Typography variant="caption" sx={{ color: 'error.dark', display: 'block', mt: 1 }}>defects: {defects.join(', ')}</Typography>
      )}
      {missing && <Typography sx={{ color: 'error.main', fontSize: 14, mt: 1.5 }}>Overall missing — tap to add</Typography>}
    </ButtonBase>
  );
}

export default function ReviewScreen({ draft, dispatch, onBack, onLog, online = true, busy = false, tasterBanner }) {
  const missing = missingOverall(draft);
  const ok = canLog(draft);
  return (
    <Screen
      title="Last look"
      onBack={onBack}
      banner={tasterBanner}
      trailing={<Typography variant="body2" color="text.secondary">{draft.picked.length} cups</Typography>}
      footer={(
        <>
          <Typography variant="caption" color={ok ? 'text.secondary' : 'error.main'} sx={{ display: 'block', textAlign: 'center' }}>
            {!online ? 'No connection — your draft is kept here' : ok ? 'One write for the whole flight' : `Overall missing on ${missing.map((c) => c.label || c.name).join(', ')}`}
          </Typography>
          <Button variant="contained" size="large" fullWidth disabled={!ok || !online || busy} onClick={onLog} endIcon={<CheckIcon />} sx={{ minHeight: 52 }}>
            {busy ? 'Logging…' : 'Log flight'}
          </Button>
        </>
      )}
    >
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        Not a ranking — a side-by-side read so you can catch "fruity" on all three and sharpen it. Tap a card to go back and revise.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {draft.picked.map((c, i) => (
          <ReviewCard
            key={c.id}
            index={i}
            coffee={c}
            entry={entryFor(draft, c.id)}
            onOpen={() => { dispatch({ type: 'cur', cur: i }); dispatch({ type: 'screen', screen: 'entry' }); }}
          />
        ))}
      </Box>
      {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
    </Screen>
  );
}
