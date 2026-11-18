/**
 * Entry — one cup. Four worded sliders ("How much — not how good"), Overall
 * stars (the only required field), the flavor picker, Defects on cupping prep,
 * a note last (an iOS keyboard eats half the viewport), and a sticky footer
 * with the cup strip in the thumb zone above the CTA.
 *
 * Switching cups is a state swap — every cup's draft is held in the reducer,
 * the same DOM stays mounted, so scroll position holds and no spinner ever
 * appears. The wheel path is kept across switches on purpose.
 *
 * Every child below is memoized and every callback is stable, so a slider
 * stop repaints one slider and a keystroke in the note repaints one field —
 * not the ~190 styled nodes of the whole entry (the shared device is 4–6× slower
 * than a laptop). The note (NoteField) commits on blur; Review/Log blur first.
 */
import { useCallback, useMemo } from 'react';
import { Box, Button, Chip, Divider, IconButton, Typography, Alert } from '@mui/material';
import { alpha } from '@mui/material/styles';
import IosShareIcon from '@mui/icons-material/IosShare';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Screen from '../../bits/Screen';
import AttributeSlider from '../../entry/AttributeSlider';
import OverallStars from '../../entry/OverallStars';
import FlavorPicker from '../../entry/FlavorPicker';
import DefectsCard from '../../entry/DefectsCard';
import CupStrip from '../../entry/CupStrip';
import NoteField from '../../entry/NoteField';
import { useEntryActions, blurActive } from '../../entry/useEntryActions';
import { entryFor, currentCoffee, canLog } from '../flightDraft';
import { prepWord } from '../../format';

const SLIDERS = [['Acidity', 'acidity'], ['Sweetness', 'sweetness'], ['Body', 'body']];

export default function EntryScreen({ draft, dispatch, onClose, onShare, onReview, onLog, online = true, busy = false, path = [], onPath }) {
  const coffee = currentCoffee(draft);
  const coffeeId = coffee?.id ?? null;
  const e = entryFor(draft, coffeeId);

  const { onSet, onOverall, onCycle, onRemove, onToggleDefect, onNote } = useEntryActions(dispatch, coffeeId);
  const onSelectCup = useCallback((cur) => { blurActive(); dispatch({ type: 'cur', cur }); }, [dispatch]);

  const cups = useMemo(() => draft.picked.map((c) => ({
    id: c.id, label: c.label || c.name, scored: entryFor(draft, c.id).vals.overall != null,
  })), [draft]);

  if (!coffee) {
    return (
      <Screen title="Tasting" onClose={onClose}>
        <Typography color="text.secondary" sx={{ py: 2 }}>No coffees in this flight.</Typography>
      </Screen>
    );
  }
  const n = draft.picked.length;
  const i = draft.picked.findIndex((c) => c.id === coffee.id);
  const title = draft.shared && draft.flightName ? draft.flightName : 'Tasting';
  const pill = draft.prep === 'cupping' ? 'Cupping' : `Bar · ${prepWord(draft.prep)}`;
  const review = () => { blurActive(); onReview(); };
  const log = () => { blurActive(); onLog(); };

  return (
    <Screen
      title={title}
      onClose={onClose}
      trailing={(
        <>
          {onShare && <IconButton aria-label="Share this flight" onClick={onShare}><IosShareIcon /></IconButton>}
          <Chip label={pill} size="small" sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.08), fontWeight: 500 }} />
        </>
      )}
      bodyProps={{ 'data-testid': 'entry-body' }}
      footer={(
        <>
          <CupStrip cups={cups} cur={i} onSelect={onSelectCup} />
          {n > 1 ? (
            <Button variant="contained" size="large" onClick={review} endIcon={<ArrowForwardIcon />} sx={{ minHeight: 52 }}>Review</Button>
          ) : (
            <Button variant="contained" size="large" onClick={log} disabled={!canLog(draft) || !online || busy} endIcon={<ArrowForwardIcon />} sx={{ minHeight: 52 }}>
              {busy ? 'Logging…' : 'Log it'}
            </Button>
          )}
        </>
      )}
    >
      <Box sx={{ pt: 2, pb: 1 }}>
        <Typography variant="h3" component="h3" sx={{ fontSize: 20 }}>{coffee.label || coffee.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {coffee.blind ? 'blind' : coffee.roaster}{n > 1 ? ` · cup ${i + 1} of ${n}` : ''}
        </Typography>
      </Box>
      <Typography sx={{ fontStyle: 'italic', fontSize: 13, color: 'text.secondary', mb: 1 }}>How much — not how good.</Typography>
      {SLIDERS.map(([label, attr]) => (
        <AttributeSlider key={attr} label={label} attr={attr} value={e.vals[attr] ?? null} onChange={onSet} />
      ))}
      <Divider sx={{ my: 1 }} />
      <AttributeSlider label="Balance" attr="balance" value={e.vals.balance ?? null} onChange={onSet} />
      <OverallStars value={e.vals.overall ?? null} onChange={onOverall} />

      <Box sx={{ mt: 2 }}>
        <FlavorPicker
          coffeeLabel={coffee.blind ? coffee.label : (coffee.label || coffee.name).split(' ')[0]}
          tags={e.tags}
          onCycle={onCycle}
          onRemove={onRemove}
          path={path}
          onPath={onPath}
        />
      </Box>

      {draft.prep === 'cupping' && (
        <Box sx={{ mt: 2 }}>
          <DefectsCard defects={e.defects} onToggle={onToggleDefect} />
        </Box>
      )}

      <NoteField key={coffee.id} note={e.note} onCommit={onNote} />
      {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
      {!online && <Alert severity="warning" sx={{ mt: 2 }}>No connection — your draft is kept here until you're back online.</Alert>}
    </Screen>
  );
}
