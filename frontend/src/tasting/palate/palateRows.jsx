/** Shared pieces of the My palate sections: a tappable row and a short empty-state line. */
import { Box, ButtonBase, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Card from '../bits/Card';

export function ShortLine({ children }) {
  return <Card><Typography variant="body2" color="text.secondary">{children}</Typography></Card>;
}

/** One row: title + meta on the left, a bold score on the right, a marker track beneath. */
export function PalateRow({ first, onClick, title, meta, score, scoreLabel, children, ...rest }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{ width: '100%', display: 'block', textAlign: 'left', px: 2, py: 1, minHeight: 56, borderTop: first ? 'none' : '1px solid', borderColor: 'divider' }}
      {...rest}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 15 }}>{title}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{meta}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontWeight: 600 }}>{score}</Typography>
          {scoreLabel && <Typography variant="caption" color="text.secondary">{scoreLabel}</Typography>}
        </Box>
        <ChevronRightIcon sx={{ color: 'text.disabled' }} />
      </Box>
      {children}
    </ButtonBase>
  );
}
