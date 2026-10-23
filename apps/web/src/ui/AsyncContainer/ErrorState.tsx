import React from 'react';
import { Alert, AlertTitle, Button } from '@mui/material';

export interface ErrorStateProps {
  error?: string | Error | null;
  title?: string;
  onRetry?: () => void;
  dataTestId?: string;
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  dataTestId,
}: ErrorStateProps) {
  const errorMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred while loading this data.';

  return (
    <Alert
      severity="error"
      data-testid={dataTestId}
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry} sx={{ fontWeight: 700 }}>
            Retry
          </Button>
        )
      }
      sx={{
        borderRadius: 2,
        alignItems: 'center',
        border: '1px solid #FECDD3',
        bgcolor: '#FFF1EC',
      }}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>{title}</AlertTitle>
      {errorMessage}
    </Alert>
  );
}
