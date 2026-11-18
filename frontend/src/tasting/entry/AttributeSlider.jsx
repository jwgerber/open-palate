/**
 * One 1–5 worded attribute slider (Acidity / Sweetness / Body / Balance).
 *
 * Five snapping stops on a 36px-tall pointer track (6px visible rail, 28px
 * thumb). Untouched = `value == null`: the thumb sits centred at 30% opacity
 * with no fill and no word, and the cup saves NULL — never the midpoint.
 * Pointer down/move on the track maps x → 1..5. The track keeps `touch-action:
 * pan-y` (it sits in a scrolling body; `none` would trap vertical scrolls that
 * start on it) while the thumb, where deliberate drags start, is `none` so a
 * slightly diagonal drag is not claimed by the scroller. Arrow keys move one
 * stop for keyboards.
 *
 * The track rect is read once on pointer-down (its width cannot change during
 * a drag) and the thumb transition is off while dragging, so the thumb tracks
 * the finger instead of trailing it by 120ms. `onChange(attr, value)` takes a
 * stable callback so the whole component can be memoized.
 */
import { memo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { SCALE_WORDS } from '../content';
import { valueFromPointer } from './sliderMath';

const STOPS = [1, 2, 3, 4, 5];

function AttributeSlider({ label, attr, value, onChange }) {
  const words = SCALE_WORDS[attr];
  const untouched = value == null;
  const pct = untouched ? 50 : (value - 1) * 25;
  const rectRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const set = (v) => { if (v !== value) onChange(attr, v); };
  const fromEvent = (e) => set(valueFromPointer(e.clientX, rectRef.current ?? e.currentTarget.getBoundingClientRect()));
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    rectRef.current = e.currentTarget.getBoundingClientRect();
    setDragging(true);
    fromEvent(e);
  };
  const onPointerMove = (e) => {
    if (e.buttons !== 1) return;
    fromEvent(e);
  };
  const endDrag = () => { rectRef.current = null; setDragging(false); };
  const onKeyDown = (e) => {
    const cur = value ?? 3;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(Math.min(5, cur + 1)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(Math.max(1, cur - 1)); }
    if (e.key === 'Home') { e.preventDefault(); set(1); }
    if (e.key === 'End') { e.preventDefault(); set(5); }
  };

  return (
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'primary.main', minHeight: 20 }} data-testid={`word-${attr}`}>
          {untouched ? '' : words[value - 1]}
        </Typography>
      </Box>
      <Box
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={untouched ? undefined : value}
        aria-valuetext={untouched ? 'not set' : words[value - 1]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        data-testid={`slider-${attr}`}
        sx={{
          position: 'relative', height: 36, cursor: 'pointer', touchAction: 'pan-y', userSelect: 'none',
          outline: 'none', '&:focus-visible': { borderRadius: 1, boxShadow: (t) => `0 0 0 2px ${alpha(t.palette.primary.main, 0.4)}` },
        }}
      >
        <Box sx={{ position: 'absolute', left: 0, right: 0, top: 15, height: 6, borderRadius: 3, bgcolor: (t) => alpha(t.palette.primary.main, 0.2) }} />
        {!untouched && (
          <Box sx={{ position: 'absolute', left: 0, width: `${pct}%`, top: 15, height: 6, borderRadius: 3, bgcolor: 'primary.main' }} />
        )}
        {STOPS.map((s) => (
          <Box key={s} sx={{
            position: 'absolute', top: 15, height: 6, width: 2, bgcolor: 'background.paper',
            left: `${(s - 1) * 25}%`, transform: 'translateX(-50%)', opacity: s === 1 || s === 5 ? 0 : 0.9,
          }} />
        ))}
        <Box sx={{
          position: 'absolute', top: 4, width: 28, height: 28, borderRadius: '50%', touchAction: 'none',
          left: `${pct}%`, transform: 'translateX(-50%)', bgcolor: 'primary.main',
          opacity: untouched ? 0.3 : 1, transition: dragging ? 'none' : 'left 120ms ease-out, opacity 200ms ease-in-out',
          boxShadow: (t) => t.shadows[1],
        }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">{words[0]}</Typography>
        <Typography variant="caption" color="text.secondary">{words[4]}</Typography>
      </Box>
    </Box>
  );
}

export default memo(AttributeSlider);
