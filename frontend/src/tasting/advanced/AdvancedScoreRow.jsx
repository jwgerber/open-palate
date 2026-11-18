/**
 * One Advanced score row: label, (i) guidance toggle, value, D/Q pill, a
 * 7.5-10 slider and (at step 0.1 only) -/+ nudge buttons.
 *
 * Untouched = `value == null`: a ghost thumb sits on 8.0 and nothing is saved.
 * D/Q is the sentinel 7 and greys the track. Pointer handling mirrors
 * AttributeSlider (rect read once on pointer-down, no transition while
 * dragging). `onChange(cat, value|null)` must be a stable callback so the memo
 * holds across the ten rows of a cup.
 */
import { memo, useRef, useState } from 'react';
import { Box, ButtonBase, IconButton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { ADV_ANCHOR, ADV_DQ_VALUE, ADV_GUIDANCE, ADV_MAX, ADV_MIN } from '../content';
import { advancedHints, advancedNudge, advancedPct, advancedValueFromPointer } from './advancedSlider';
import { CLEAN_TEXT } from './advancedCopy';
import { focusRing, shadeText } from '../bits/a11y';

const TOUCH_SLOP = 6;
const HINT_PREFIX = { plus: '+ ', minus: '− ', dq: 'D/Q: ' };

function AdvancedScoreRow({ cat, value, step, onChange }) {
  const guide = ADV_GUIDANCE[cat];
  const untouched = value == null;
  const dq = value === ADV_DQ_VALUE;
  const rectRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);

  const set = (v) => { if (v !== value) onChange(cat, v); };
  const fromEvent = (e) => set(advancedValueFromPointer(e.clientX, rectRef.current ?? e.currentTarget.getBoundingClientRect(), step));
  // Touch: ten tracks are stacked in a scrolling column, so a finger landing on one
  // while panning must not set a score. Touch commits only on a horizontal drag or a
  // completed tap; pointercancel (the browser took the pan) commits nothing.
  const touchRef = useRef(null);
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    rectRef.current = e.currentTarget.getBoundingClientRect();
    if (e.pointerType === 'touch') {
      touchRef.current = { x: e.clientX, y: e.clientY, dragged: false };
      return;
    }
    setDragging(true);
    fromEvent(e);
  };
  const onPointerMove = (e) => {
    const touch = touchRef.current;
    if (touch) {
      const dx = Math.abs(e.clientX - touch.x);
      if (!touch.dragged && !(dx > TOUCH_SLOP && dx > Math.abs(e.clientY - touch.y))) return;
      if (!touch.dragged) { touch.dragged = true; setDragging(true); }
      fromEvent(e);
    } else if (e.buttons === 1) fromEvent(e);
  };
  const endDrag = () => { rectRef.current = null; touchRef.current = null; setDragging(false); };
  const onPointerUp = (e) => {
    if (touchRef.current && !touchRef.current.dragged) fromEvent(e);
    endDrag();
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(advancedNudge(value, 1, step)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(advancedNudge(value, -1, step)); }
    else if (e.key === 'Home') { e.preventDefault(); set(ADV_MIN); }
    else if (e.key === 'End') { e.preventDefault(); set(ADV_MAX); }
  };

  const pct = advancedPct(value);
  const anchorPct = advancedPct(ADV_ANCHOR);
  const valueText = untouched ? '—' : dq ? 'D/Q' : value.toFixed(1);
  const hints = advancedHints(value, open);

  return (
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{guide.label}</Typography>
        <IconButton
          size="small"
          aria-label={`${guide.label} guidance`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          sx={{ width: 44, height: 44 }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
        <Box sx={{ flex: 1 }} />
        <Typography
          sx={{ fontSize: 15, fontWeight: 700, minWidth: 36, textAlign: 'right', color: dq ? 'error.main' : 'text.primary' }}
          data-testid={`advanced-value-${cat}`}
        >
          {valueText}
        </Typography>
        <ButtonBase
          onClick={() => onChange(cat, dq ? null : ADV_DQ_VALUE)}
          aria-pressed={dq}
          aria-label={`${guide.label} D/Q below ${ADV_MIN}`}
          sx={{ ml: 0.5, minHeight: 44, minWidth: 44, px: 0.5, borderRadius: 22, ...focusRing }}
        >
          <Box
            component="span"
            sx={{
              display: 'flex', alignItems: 'center', px: 1.25, minHeight: 32, borderRadius: 16, fontSize: 12, fontWeight: 700,
              border: 1, borderColor: 'error.main',
              color: dq ? 'error.contrastText' : shadeText('error'),
              bgcolor: (t) => (dq ? t.palette.error.main : alpha(t.palette.error.main, 0.08)),
            }}
          >
            D/Q &lt;{ADV_MIN}
          </Box>
        </ButtonBase>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {step === 0.1 && (
          <IconButton
            aria-label={`Decrease ${guide.label}`}
            onClick={() => set(advancedNudge(value, -1, step))}
            sx={{ width: 44, height: 44, fontSize: 20 }}
          >
            −
          </IconButton>
        )}
        <Box
          role="slider"
          tabIndex={0}
          aria-label={guide.label}
          aria-valuemin={ADV_MIN}
          aria-valuemax={ADV_MAX}
          aria-valuenow={untouched || dq ? undefined : value}
          aria-valuetext={untouched ? 'not set' : dq ? 'Disqualified' : value.toFixed(1)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          data-testid={`advanced-slider-${cat}`}
          sx={{
            position: 'relative', flex: 1, height: 36, cursor: 'pointer', touchAction: 'pan-y', userSelect: 'none',
            outline: 'none', opacity: dq ? 0.4 : 1,
            '&:focus-visible': { borderRadius: 1, outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
          }}
        >
          <Box sx={{ position: 'absolute', left: 0, right: 0, top: 15, height: 6, borderRadius: 3, bgcolor: (t) => alpha(t.palette.primary.main, 0.2) }} />
          {!untouched && !dq && (
            <Box sx={{ position: 'absolute', left: 0, width: `${pct}%`, top: 15, height: 6, borderRadius: 3, bgcolor: 'primary.main' }} />
          )}
          <Box sx={{ position: 'absolute', top: 10, height: 16, width: 2, left: `${anchorPct}%`, transform: 'translateX(-50%)', bgcolor: 'text.secondary' }} />
          <Box sx={{
            position: 'absolute', top: 4, width: 28, height: 28, borderRadius: '50%', touchAction: 'none',
            left: `${pct}%`, transform: 'translateX(-50%)', bgcolor: 'primary.main',
            opacity: untouched || dq ? 0.3 : 1,
            transition: dragging ? 'none' : 'left 120ms ease-out, opacity 200ms ease-in-out',
            boxShadow: (t) => t.shadows[1],
          }} />
        </Box>
        {step === 0.1 && (
          <IconButton
            aria-label={`Increase ${guide.label}`}
            onClick={() => set(advancedNudge(value, 1, step))}
            sx={{ width: 44, height: 44, fontSize: 20 }}
          >
            +
          </IconButton>
        )}
      </Box>

      {hints.map((h) => (
        <Typography key={h} variant="caption" color={h === 'dq' ? undefined : 'text.secondary'} sx={{ display: 'block', ...(h === 'dq' ? { color: shadeText('error') } : {}) }}>
          {h === 'clean' ? CLEAN_TEXT : `${HINT_PREFIX[h]}${guide[h]}`}
        </Typography>
      ))}
    </Box>
  );
}

export default memo(AdvancedScoreRow);
