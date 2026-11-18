/**
 * Defects — cupping prep only. A collapsible outlined card of 40px pill chips;
 * its own column, never counted against the five-flavor cap.
 */
import { memo, useState } from 'react';
import { Box, ButtonBase, Collapse, Typography, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { DEFECT_TERMS } from '../content';

function DefectsCard({ defects, onToggle }) {
  const [open, setOpen] = useState(false);
  const count = Object.keys(defects || {}).length;
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
      <ButtonBase onClick={() => setOpen((o) => !o)} sx={{ width: '100%', justifyContent: 'space-between', px: 2, py: 1.5, textAlign: 'left' }} aria-expanded={open}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          Defects
          <Typography component="span" sx={{ ml: 1, fontSize: 13, fontWeight: 500, color: count ? 'error.dark' : 'text.secondary' }}>
            {count ? `${count} noted` : 'none'}
          </Typography>
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
          <Typography variant="caption">outside the cap</Typography>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </Box>
      </ButtonBase>
      <Collapse in={open}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, pb: 2 }}>
          {DEFECT_TERMS.map((term) => {
            const on = !!defects?.[term];
            return (
              <Chip
                key={term}
                label={term}
                clickable
                onClick={() => onToggle(term)}
                aria-pressed={on}
                sx={{
                  height: 40, borderRadius: 9999, fontSize: 14, fontWeight: on ? 600 : 400,
                  border: '1px solid', borderColor: on ? 'error.main' : 'divider',
                  bgcolor: (t) => (on ? alpha(t.palette.error.main, 0.1) : t.palette.background.paper),
                  color: on ? 'error.dark' : 'text.primary',
                  '&:hover': { bgcolor: (t) => (on ? alpha(t.palette.error.main, 0.14) : alpha(t.palette.primary.main, 0.06)) },
                }}
              />
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
}

export default memo(DefectsCard);
