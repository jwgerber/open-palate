/**
 * A row of pill toggles over a small enum (kind, roast, prep). `options` is
 * [[value, label]]; `dense` is the 44px picker variant. A single-select group:
 * the parent decides whether re-tapping the lit pill clears it.
 */
import { Box, ButtonBase } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { focusRing, shadeText } from './a11y';

const pillSx = (on) => ({
  borderRadius: 9999, fontSize: 14, fontWeight: on ? 600 : 400,
  border: '1px solid', borderColor: on ? 'transparent' : 'divider',
  bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.12) : t.palette.background.paper),
  color: on ? shadeText('primary') : 'text.primary',
  ...focusRing,
});

export default function Segments({ options, value, onChange, ariaLabel, dense = false, disabled = false }) {
  return (
    <Box role="group" aria-label={ariaLabel} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <ButtonBase
            key={v}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(v)}
            sx={{ ...pillSx(on), ...(disabled ? { opacity: 0.6 } : {}), ...(dense ? { minHeight: 44, px: 2 } : { flex: '1 1 auto', minHeight: 44, px: 1.5 }) }}
          >
            {label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
