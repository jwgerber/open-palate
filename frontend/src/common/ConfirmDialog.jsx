import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';

/**
 * Reusable confirmation dialog to replace native window.confirm() calls.
 *
 * @param {boolean} open - Whether the dialog is visible
 * @param {string} title - Dialog title
 * @param {string} message - Body text (supports \n via whiteSpace: pre-line)
 * @param {Function} onConfirm - Called when the user confirms
 * @param {Function} onClose - Called when the user cancels or closes
 * @param {string} [confirmLabel='Confirm'] - Label for the confirm button
 * @param {string} [cancelLabel='Cancel'] - Label for the cancel button
 * @param {string} [confirmColor='primary'] - MUI color for the confirm button
 * @param {React.ReactNode} [children] - Optional content rendered below the message
 * @param {object} [sx] - Optional sx for the Dialog root (e.g. a zIndex to stack above a Drawer)
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  children,
  onConfirm,
  onClose,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'primary',
  sx,
}) {
  const handleConfirm = () => {
    onConfirm?.();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth sx={sx}>
      {title && <DialogTitle>{title}</DialogTitle>}
      <DialogContent>
        <DialogContentText sx={{ whiteSpace: 'pre-line' }}>
          {message}
        </DialogContentText>
        {children}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button onClick={handleConfirm} variant="contained" color={confirmColor} autoFocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
