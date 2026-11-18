/**
 * The flight-screen shell: a 56px header (Close or Back, a title, a trailing
 * slot), a scrolling body, and a sticky footer that clears the iPhone home
 * indicator. Every screen in the flight dialog and the edit-coffee dialog is
 * one of these, so the chrome is defined once.
 */
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export function ScreenHeader({ title, onBack, onClose, trailing }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, px: 1, minHeight: 56, flexShrink: 0,
      borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
    }}>
      {onBack && <IconButton aria-label="Back" onClick={onBack}><ArrowBackIcon /></IconButton>}
      {onClose && !onBack && <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>}
      <Typography variant="h4" component="h2" noWrap sx={{ flex: 1, minWidth: 0 }}>{title}</Typography>
      {trailing && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>{trailing}</Box>}
    </Box>
  );
}

export function ScreenFooter({ children, sx }) {
  return (
    <Box sx={{
      borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
      p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 1, ...sx,
    }}>
      {children}
    </Box>
  );
}

export default function Screen({ title, onBack, onClose, trailing, banner, footer, bodySx, bodyProps, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title={title} onBack={onBack} onClose={onClose} trailing={trailing} />
      {banner}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2, ...bodySx }} {...bodyProps}>{children}</Box>
      {footer && <ScreenFooter>{footer}</ScreenFooter>}
    </Box>
  );
}
