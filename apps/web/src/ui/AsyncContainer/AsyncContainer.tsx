import React from 'react';
import { Box, CircularProgress, Skeleton, Stack } from '@mui/material';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState, type ErrorStateProps } from './ErrorState';

export interface AsyncContainerProps {
  isLoading?: boolean;
  isError?: boolean;
  error?: string | Error | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  skeleton?: React.ReactNode;
  children: React.ReactNode;
  dataTestId?: string;
}

export function AsyncContainer({
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  emptyTitle = 'No records found',
  emptyDescription,
  emptyAction,
  emptyIcon,
  skeleton,
  children,
  dataTestId,
}: AsyncContainerProps) {
  if (isError) {
    return <ErrorState error={error} onRetry={onRetry} dataTestId={dataTestId ? `${dataTestId}.error` : undefined} />;
  }

  if (isLoading) {
    if (skeleton) return <>{skeleton}</>;
    return (
      <Box
        data-testid={dataTestId ? `${dataTestId}.loading` : undefined}
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}
      >
        <CircularProgress size={36} sx={{ color: 'primary.main' }} />
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        icon={emptyIcon}
        dataTestId={dataTestId ? `${dataTestId}.empty` : undefined}
      />
    );
  }

  return <>{children}</>;
}
