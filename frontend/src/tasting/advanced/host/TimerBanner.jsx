/**
 * The taster's view of the cupping timer: one slim band under the header with
 * the clock, the pass and a hint — time and pass only, never scores or who has
 * logged. Owns `useElapsed` so its 1 s tick repaints just this band, not the
 * entry screen. With `onOpenTimer` (the caller may run the timer) it is a
 * button that opens the host's timer.
 */
import { memo } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { useElapsed } from './useElapsed';
import { advancedPhase, formatClock } from './advancedTimer';
import { focusRing } from '../../bits/a11y';

const SEP = ' · ';

const bandSx = (started, clickable) => ({
  display: 'flex', alignItems: 'center', gap: 1.25, width: '100%', px: 2, py: 0.9, fontSize: 13, textAlign: 'left',
  bgcolor: started ? 'grey.900' : 'action.hover',
  color: started ? 'common.white' : 'text.primary',
  ...(clickable && { cursor: 'pointer', minHeight: 44, ...focusRing, '&.Mui-focusVisible': { ...focusRing['&.Mui-focusVisible'], outlineOffset: -3 } }),
});

function TimerBanner({ flight, onOpenTimer }) {
  const elapsed = useElapsed(flight);
  if (flight?.sheet !== 'advanced' || !flight.is_open) return null;

  const started = flight.adv_pass != null && elapsed != null;
  const phase = advancedPhase(elapsed ?? 0, flight.adv_pass);
  const content = (
    <>
      <TimerOutlinedIcon aria-hidden fontSize="small" />
      {/* aria-hidden: a polite live region would otherwise announce every second. */}
      {started && <Box component="b" aria-hidden sx={{ fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{formatClock(elapsed)}{SEP}</Box>}
      <Box component="span" sx={{ fontWeight: 600, color: started ? 'warning.light' : 'text.secondary' }}>{phase.name}</Box>
      <Box component="span" sx={{ opacity: 0.85 }}>{SEP}{phase.hint}</Box>
    </>
  );

  return (
    <Box role="status">
      {onOpenTimer
        ? (
          // The visible text stays in the name (WCAG 2.5.3); the prefix only says what the button does.
          <ButtonBase onClick={onOpenTimer} sx={bandSx(started, true)}>
            <span style={visuallyHidden}>Open the timer: </span>{content}
          </ButtonBase>
        )
        : <Box sx={bandSx(started, false)}>{content}</Box>}
    </Box>
  );
}

export default memo(TimerBanner);
