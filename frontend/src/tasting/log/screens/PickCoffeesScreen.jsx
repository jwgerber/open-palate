/**
 * Pick coffees — multi-select in §5.7 order (on bar at this store · recent
 * cupping lots · somewhere else), then prep, then pour order.
 *
 * The picked box shows the POUR NUMBER; un-picking renumbers the rest. Pour
 * order is reordered by press-and-drag on the handle only (dnd-kit, the
 * activator is the handle), never by arrows. The list never shows a score or
 * a tag — only a tasting count (spec §5.1). The coffee list arrives from
 * FlightDialog (`coffees`, null while loading).
 */
import { useMemo, useState } from 'react';
import {
  Box, Button, ButtonBase, CircularProgress, IconButton, InputAdornment, TextField, Typography, Alert,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import IosShareIcon from '@mui/icons-material/IosShare';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext, PointerSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Screen from '../../bits/Screen';
import Eyebrow from '../../bits/Eyebrow';
import Segments from '../../bits/Segments';
import { PREPS, PREP_LABELS } from '../../content';
import { plural } from '../../format';

function CoffeeRow({ coffee, index, onToggle }) {
  const on = index >= 0;
  const meta = [coffee.roaster, coffee.lot_code ? `lot ${coffee.lot_code}` : null, plural(coffee.n ?? 0, 'tasting')].filter(Boolean).join(' · ');
  return (
    <ButtonBase
      onClick={() => onToggle(coffee)}
      aria-pressed={on}
      sx={{
        width: '100%', minHeight: 56, px: 1.5, gap: 1.5, borderRadius: 2, justifyContent: 'flex-start', textAlign: 'left',
        bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.06) : 'transparent'),
      }}
    >
      <Box sx={{
        width: 28, height: 28, borderRadius: 1, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1.5px solid', borderColor: on ? 'primary.main' : 'text.disabled', bgcolor: on ? 'primary.main' : 'transparent',
        color: 'primary.contrastText', fontSize: 13, fontWeight: 600,
      }} data-testid={`pick-box-${coffee.id}`}>
        {on ? index + 1 : ''}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 500 }} noWrap>{coffee.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{meta}</Typography>
      </Box>
    </ButtonBase>
  );
}

function PourRow({ coffee, index }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: coffee.id });
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, minHeight: 48, borderRadius: 2,
        bgcolor: (t) => (isDragging ? alpha(t.palette.primary.main, 0.12) : 'transparent'),
        boxShadow: (t) => (isDragging ? t.shadows[2] : 'none'), position: 'relative', zIndex: isDragging ? 1 : 'auto',
      }}
    >
      <Typography sx={{ width: 20, fontSize: 13, color: 'text.secondary' }}>{index + 1}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 15 }} noWrap>{coffee.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{coffee.roaster}</Typography>
      </Box>
      <IconButton
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${coffee.name}`}
        sx={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : 'grab', color: isDragging ? 'primary.main' : 'text.disabled' }}
      >
        <DragIndicatorIcon />
      </IconButton>
    </Box>
  );
}

const PREP_OPTIONS = PREPS.map((p) => [p, PREP_LABELS[p]]);
const SHEET_OPTIONS = [['basic', 'Basic read'], ['advanced', 'Advanced']];

export default function PickCoffeesScreen({ draft, dispatch, coffees, error, onClose, onSomethingElse, onStart, onShare }) {
  const [q, setQ] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const picked = draft.picked;
  const indexOf = (c) => picked.findIndex((p) => p.id === c.id);
  const sections = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const all = (coffees || []).filter((c) => !ql || `${c.name} ${c.roaster}`.toLowerCase().includes(ql));
    const house = all.filter((c) => c.kind === 'house');
    const lots = all.filter((c) => c.kind === 'cupping_lot');
    const ext = all.filter((c) => c.kind === 'external');
    return [
      { key: 'bar', label: 'On bar', rows: house },
      { key: 'lot', label: 'Recent cupping lots', rows: lots },
      { key: 'ext', label: 'Somewhere else', rows: ext },
    ].filter((s) => s.rows.length);
  }, [coffees, q]);

  const n = picked.length;
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    dispatch({ type: 'reorder', from: picked.findIndex((c) => c.id === active.id), to: picked.findIndex((c) => c.id === over.id) });
  };
  // Advanced is shared-only, so its primary action opens the Share screen, never the solo entry.
  const advanced = draft.sheet === 'advanced';
  const cta = n === 0 ? 'Pick at least one coffee'
    : advanced ? `Set up cupping · ${plural(n, 'coffee')}`
      : n === 1 ? 'Start tasting' : `Start flight · ${n} coffees`;

  return (
    <Screen
      title="Pick coffees"
      onClose={onClose}
      trailing={<Typography variant="body2" color="text.secondary">{n} selected</Typography>}
      footer={(
        <Box sx={{ display: 'flex', gap: 1 }}>
          {n > 0 && onShare && !advanced && (
            <Button variant="outlined" aria-label="Share this flight" onClick={onShare} sx={{ width: 52, minWidth: 52, height: 52, p: 0 }}><IosShareIcon /></Button>
          )}
          <Button variant="contained" size="large" disabled={n === 0} onClick={advanced ? onShare : onStart} sx={{ flex: 1, minHeight: 52 }}>{cta}</Button>
        </Box>
      )}
    >
      <TextField
        fullWidth
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or roaster"
        inputProps={{ 'aria-label': 'Search coffees', style: { fontSize: 16 } }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
        sx={{ my: 2 }}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!coffees && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {coffees && sections.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>{q ? 'Nothing matches.' : 'No coffees yet — add one below.'}</Typography>
      )}
      {sections.map((s) => (
        <Box key={s.key} sx={{ mb: 1.5 }}>
          <Eyebrow sx={{ mb: 0.5 }}>{s.label}</Eyebrow>
          {s.rows.map((c) => (
            <CoffeeRow key={c.id} coffee={c} index={indexOf(c)} onToggle={(coffee) => dispatch({ type: 'togglePick', coffee })} />
          ))}
        </Box>
      ))}
      <ButtonBase onClick={onSomethingElse} sx={{ width: '100%', minHeight: 48, justifyContent: 'flex-start', gap: 1.5, px: 1.5, borderRadius: 2, color: 'primary.main', fontWeight: 600, fontSize: 15 }}>
        <AddIcon /> Something else
      </ButtonBase>

      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 2, pt: 2 }}>
        <Eyebrow sx={{ mb: 1 }}>Prep</Eyebrow>
        <Segments ariaLabel="Prep" dense value={draft.prep} onChange={(prep) => dispatch({ type: 'prep', prep })} options={PREP_OPTIONS} />
        <Eyebrow sx={{ mt: 2, mb: 1 }}>Score sheet</Eyebrow>
        <Segments ariaLabel="Score sheet" dense value={draft.sheet} onChange={(sheet) => dispatch({ type: 'sheet', sheet })} options={SHEET_OPTIONS} />
        {advanced && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Advanced is a cupping sheet. Everyone scores on their own device, and you close the flight to see the summary.
          </Typography>
        )}
      </Box>

      {n > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {n > 1 ? 'Pour order — hold the handle and drag to reorder' : 'A flight of one — no review step'}
          </Typography>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={picked.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', py: 0.5 }} data-testid="pour-order">
                {picked.map((c, i) => <PourRow key={c.id} coffee={c} index={i} />)}
              </Box>
            </SortableContext>
          </DndContext>
        </Box>
      )}
    </Screen>
  );
}
