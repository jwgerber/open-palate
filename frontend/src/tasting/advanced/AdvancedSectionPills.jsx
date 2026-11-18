/**
 * Sticky section pills above one cup's scroll: Aromatic n/3 · Taste · Tactile ·
 * Balance · Vote. A tap jumps to the section; a complete one gains a check.
 * `sections` is [{ key, label, done, total }] (total 0 = no count, e.g. Vote).
 */
import { memo } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { focusRing, shadeText } from '../bits/a11y';

function AdvancedSectionPills({ sections, onJump }) {
  return (
    <Box
      role="group"
      aria-label="Sections"
      sx={{
        position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 0.75, overflowX: 'auto', py: 1, mx: -2, px: 2, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
        bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider',
      }}
    >
      {sections.map((s) => {
        const complete = s.done >= Math.max(1, s.total);
        const count = s.total > 1 ? ` ${s.done}/${s.total}` : '';
        return (
          <ButtonBase
            key={s.key}
            onClick={() => onJump(s.key)}
            sx={{
              flexShrink: 0, minHeight: 44, px: 1.5, borderRadius: 9999, fontSize: 13, fontWeight: complete ? 600 : 500,
              border: '1px solid', borderColor: complete ? 'transparent' : 'divider',
              bgcolor: (t) => (complete ? alpha(t.palette.success.main, 0.14) : t.palette.background.paper),
              color: complete ? shadeText('success') : 'text.primary',
              ...focusRing,
            }}
          >
            {`${s.label}${count}${complete ? ' ✓' : ''}`}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export default memo(AdvancedSectionPills);
