import React from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  severity?: 'primary' | 'warning' | 'error';
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
  children?: React.ReactNode;
  dataTestId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  disablePortal?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'primary',
  onConfirm,
  onClose,
  isLoading = false,
  children,
  dataTestId,
  confirmTestId,
  cancelTestId,
  disablePortal = false,
}: ConfirmDialogProps) {
  const getButtonColor = () => {
    if (severity === 'error') return 'error';
    if (severity === 'warning') return 'warning';
    return 'primary';
  };

  return (
    <Dialog
      open={open}
      onClose={isLoading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      disablePortal={disablePortal}
      data-testid={dataTestId}
      PaperProps={{
        sx: {
          borderRadius: 3,
          p: 1,
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: '1.125rem' }}>{title}</DialogTitle>
      <DialogContent>
        {description && (
          <DialogContentText sx={{ color: 'text.secondary', fontSize: '0.9375rem', mb: children ? 2 : 0 }}>
            {description}
          </DialogContentText>
        )}
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          variant="text"
          color="inherit"
          onClick={onClose}
          disabled={isLoading}
          data-testid={cancelTestId}
          sx={{ borderRadius: 1.5, color: 'text.secondary', fontWeight: 600 }}
        >
          {cancelLabel}
        </Button>
        <Button
          variant="contained"
          color={getButtonColor()}
          onClick={onConfirm}
          disabled={isLoading}
          data-testid={confirmTestId}
          sx={{
            borderRadius: 1.5,
            fontWeight: 700,
            px: 2.5,
            minWidth: 100,
          }}
        >
          {isLoading ? <CircularProgress size={18} color="inherit" /> : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
