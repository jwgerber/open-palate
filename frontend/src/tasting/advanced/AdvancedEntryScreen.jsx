/**
 * Entry for the Advanced sheet — one long scroll per cup: ten score rows
 * under group headers, the bar vote, then flavors, defects and a note. Sticky
 * section pills jump around; the footer carries the running total, the cup
 * strip and "All N" / "Next". The last cup's Next opens the All-cups sheet,
 * where the flight is logged. Same props as EntryScreen.
 *
 * Every cup's draft lives in the reducer, so switching cups is a state swap;
 * rows are memoized behind the stable useEntryActions callbacks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import IosShareIcon from '@mui/icons-material/IosShare';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import Screen from '../bits/Screen';
import FlavorPicker from '../entry/FlavorPicker';
import DefectsCard from '../entry/DefectsCard';
import NoteField from '../entry/NoteField';
import { useEntryActions, blurActive } from '../entry/useEntryActions';
import { emptyEntry, entryFor, currentCoffee, advancedScored, advancedState, advancedTotal, unreadLabel } from '../log/flightDraft';
import { ADV_CATEGORIES, ADV_GROUPS, ADV_GUIDANCE } from '../content';
import AdvancedScoreRow from './AdvancedScoreRow';
import AdvancedSectionPills from './AdvancedSectionPills';
import AdvancedVote from './AdvancedVote';
import AdvancedCupStrip from './AdvancedCupStrip';
import AllCupsSheet from './AllCupsSheet';
import TimerBanner from './host/TimerBanner';
import { CUP_HINT } from './advancedCopy';

const groupTitle = (name) => (name === 'Aggregate' ? 'Balance' : name);
// A closed blind flight sends the coffee's name as `label`; its paper letter rides on blindLabel.
const cupLetter = (cup, i) => cup.blindLabel ?? /^Cup (\S+)$/.exec(cup.label || '')?.[1] ?? String.fromCharCode(65 + i);
// Paper on a closed blind cupping: the sheet in hand says "Cup A", so lead with that, then the name.
const cupHeading = (coffee, paper, blindFlight) => (paper && blindFlight && coffee.blindLabel && !coffee.blind
  ? `Cup ${coffee.blindLabel} · ${coffee.name}`
  : coffee.label || coffee.name);
const advancedSections = (scores, vote) => [
  ...ADV_GROUPS.map(([name, cats]) => ({
    key: name, label: groupTitle(name), total: cats.length, done: cats.filter((c) => scores[c] != null).length,
  })),
  { key: 'Vote', label: 'Vote', total: 0, done: vote ? 1 : 0 },
];
const SectionHead = ({ children }) => (
  <Typography component="h4" sx={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'primary.main', pt: 2, pb: 0.5, borderBottom: '2px solid', borderColor: 'text.primary' }}>
    {children}
  </Typography>
);

export default function AdvancedEntryScreen({ draft, dispatch, onClose, onShare, onLog, online = true, busy = false, path = [], onPath, onOpenTimer, variant = 'live', paperName, scanFlags = {}, tasterBanner }) {
  const paper = variant === 'paper';
  const coffee = currentCoffee(draft);
  const coffeeId = coffee?.id ?? null;
  const e = entryFor(draft, coffeeId);
  const { onCycle, onRemove, onToggleDefect, onNote, onAdvancedScore, onAdvancedVote } = useEntryActions(dispatch, coffeeId);
  const [allOpen, setAllOpen] = useState(false);
  const bodyRef = useRef(null);

  const n = draft.picked.length;
  const i = draft.picked.findIndex((c) => c.id === coffeeId);

  useEffect(() => { bodyRef.current?.scrollTo?.(0, 0); }, [coffeeId]);

  const { picked, entries } = draft;
  const cups = useMemo(() => picked.map((c, idx) => {
    const ent = entries[c.id] || emptyEntry();
    return { id: c.id, letter: cupLetter(c, idx), scored: advancedScored(ent), state: advancedState(ent) };
  }), [picked, entries]);

  // Not hand-memoized: the React Compiler memoizes this on e.advanced / e.vote, and a manual useMemo over `e` trips its lint.
  const sections = advancedSections(e.advanced, e.vote);

  const jump = useCallback((key) => {
    bodyRef.current?.querySelector(`[data-section="${key}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);
  const onSelectCup = useCallback((cur) => { blurActive(); dispatch({ type: 'cur', cur }); }, [dispatch]);
  const onClearCup = useCallback((id) => dispatch({ type: 'advancedClear', coffeeId: id }), [dispatch]);
  const pickFromSheet = (cur) => { setAllOpen(false); onSelectCup(cur); };

  if (!coffee) {
    return (
      <Screen title="Tasting" onClose={onClose}>
        <Typography color="text.secondary" sx={{ py: 2 }}>No coffees in this flight.</Typography>
      </Screen>
    );
  }
  const last = i >= n - 1;
  // scanFlags holds raw keys; a category or vote the host has since filled drops out of the warning.
  const unreadHere = (scanFlags[coffeeId] || [])
    .filter((k) => (k === 'vote' ? !e.vote : e.advanced[k] == null))
    .map(unreadLabel);
  const scored = advancedScored(e);
  const allScored = scored === ADV_CATEGORIES.length;
  const openAll = () => { blurActive(); setAllOpen(true); };
  const next = () => (last ? openAll() : onSelectCup(i + 1));
  const log = () => { blurActive(); onLog(); };

  return (
    <>
      <Screen
        title={paper ? `Paper sheet · ${paperName}` : draft.shared && draft.flightName ? draft.flightName : 'Tasting'}
        onClose={onClose}
        trailing={(
          <>
            {!paper && onShare && <IconButton aria-label="Share this flight" onClick={onShare}><IosShareIcon /></IconButton>}
            <Chip label="Cupping" size="small" sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.08), fontWeight: 500 }} />
          </>
        )}
        banner={paper ? undefined : <>{tasterBanner}<TimerBanner flight={draft.flight} onOpenTimer={onOpenTimer} /></>}
        bodyProps={{ ref: bodyRef, 'data-testid': 'entry-body' }}
        footer={(
          <>
            <Typography sx={{ fontSize: 14 }} aria-live="polite">
              <Box component="span" sx={{ fontSize: 20, fontWeight: 700 }}>{advancedTotal(e).toFixed(1)}</Box>
              {allScored ? ` / 100 · All ${ADV_CATEGORIES.length} scored ✓` : ` so far · ${scored} of ${ADV_CATEGORIES.length} scored`}
            </Typography>
            <AdvancedCupStrip cups={cups} cur={i} onSelect={onSelectCup} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              {n > 1 && <Button variant="outlined" size="large" onClick={openAll} sx={{ minHeight: 52 }}>All {n}</Button>}
              <Button variant="contained" size="large" onClick={next} endIcon={<ArrowForwardIcon />} sx={{ minHeight: 52, flex: 1 }}>
                {last ? 'Finish · all cups' : `Next: Cup ${cups[i + 1].letter}`}
              </Button>
            </Box>
          </>
        )}
      >
        <Box sx={{ pt: 2, pb: 1 }}>
          <Typography variant="h3" component="h3" sx={{ fontSize: 20 }}>{cupHeading(coffee, paper, draft.blind)}</Typography>
          <Typography variant="body2" color="text.secondary">
            {coffee.blind ? 'blind' : coffee.roaster}{n > 1 ? ` · cup ${i + 1} of ${n}` : ''}
          </Typography>
          <Typography sx={{ fontStyle: 'italic', fontSize: 13, color: 'text.secondary', mt: 0.5 }}>{CUP_HINT}</Typography>
        </Box>
        {unreadHere.length > 0 && <Alert severity="warning" sx={{ mt: 1 }}>{`Couldn't read: ${unreadHere.join(', ')} — check the sheet.`}</Alert>}
        <AdvancedSectionPills sections={sections} onJump={jump} />

        {ADV_GROUPS.map(([name, cats]) => (
          <Box key={name} data-section={name} sx={{ scrollMarginTop: 56 }}>
            <SectionHead>{groupTitle(name)}</SectionHead>
            {cats.map((cat) => (
              <AdvancedScoreRow key={`${coffee.id}-${cat}`} cat={cat} value={e.advanced[cat] ?? null} step={draft.advancedStep} onChange={onAdvancedScore} />
            ))}
          </Box>
        ))}

        <Box data-section="Vote" sx={{ scrollMarginTop: 56, mt: 1 }}>
          <SectionHead>Vote</SectionHead>
          <Box sx={{ mt: 1 }}><AdvancedVote value={e.vote} onChange={onAdvancedVote} /></Box>
        </Box>

        <Box sx={{ mt: 2 }}>
          <FlavorPicker
            coffeeLabel={coffee.blind ? coffee.label : (coffee.label || coffee.name).split(' ')[0]}
            tags={e.tags} onCycle={onCycle} onRemove={onRemove} path={path} onPath={onPath}
          />
        </Box>
        <Box sx={{ mt: 2 }}><DefectsCard defects={e.defects} onToggle={onToggleDefect} /></Box>
        <NoteField key={coffee.id} note={e.note} onCommit={onNote} />
        {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
        {!online && <Alert severity="warning" sx={{ mt: 2 }}>No connection — your draft is kept here until you're back online.</Alert>}
      </Screen>
      <AllCupsSheet
        open={allOpen} variant={variant} draft={draft} cups={cups} cur={i} online={online} busy={busy}
        onClose={() => setAllOpen(false)} onSelect={pickFromSheet} onClear={onClearCup} onLog={log}
      />
    </>
  );
}
