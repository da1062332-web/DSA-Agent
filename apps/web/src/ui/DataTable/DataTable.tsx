import React from 'react';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { EmptyState } from '../AsyncContainer/EmptyState';
import { ErrorState } from '../AsyncContainer/ErrorState';

export interface ColumnDef<T> {
  id: string;
  header?: React.ReactNode;
  label?: React.ReactNode;
  accessor?: (row: T) => React.ReactNode;
  render?: (row: T) => React.ReactNode;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
}

export type Column<T> = ColumnDef<T>;

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor?: (item: T, idx?: number) => string | number;
  isLoading?: boolean;
  loading?: boolean;
  isError?: boolean;
  error?: string | Error | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  pagination?: {
    page?: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    onNext: () => void;
    onPrev: () => void;
    nextTestId?: string;
    prevTestId?: string;
  };
  onRowClick?: (item: T) => void;
  dataTestId?: string;
  elevation?: number;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  loading = false,
  isError = false,
  error,
  onRetry,
  emptyTitle = 'No records found',
  emptyMessage,
  emptyDescription = 'There are no items to display matching the current criteria.',
  emptyAction,
  pagination,
  onRowClick,
  dataTestId,
  elevation = 0,
}: DataTableProps<T>) {
  const effectiveLoading = isLoading || loading;
  const effectiveEmptyTitle = emptyMessage || emptyTitle;
  const getKey = keyExtractor ?? ((item: any, idx?: number) => item?.id ?? item?.key ?? (idx !== undefined ? `row-${idx}` : JSON.stringify(item)));
  if (isError) {
    return (
      <Box sx={{ my: 2 }}>
        <ErrorState error={error} onRetry={onRetry} />
      </Box>
    );
  }

  return (
    <Card
      elevation={elevation}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2.5,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <TableContainer>
        <Table data-testid={dataTestId}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'grey.50' }}>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align ?? 'left'}
                  sx={{
                    width: col.width,
                    color: 'info.main', // BG/700 Deep Blue
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    py: 1.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.header ?? col.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {effectiveLoading ? (
              // Skeletons
              Array.from({ length: 5 }).map((_, rIdx) => (
                <TableRow key={`skeleton-${rIdx}`}>
                  {columns.map((col, cIdx) => (
                    <TableCell key={`col-${cIdx}`} align={col.align ?? 'left'}>
                      <Skeleton variant="text" width={col.width ? '80%' : '60%'} height={24} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              // Empty
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6, border: 0 }}>
                  <EmptyState
                    title={effectiveEmptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                    compact
                  />
                </TableCell>
              </TableRow>
            ) : (
              // Data Rows
              data.map((row, rIdx) => {
                const key = getKey(row, rIdx);
                const isClickable = Boolean(onRowClick);
                return (
                  <TableRow
                    key={key}
                    hover
                    onClick={isClickable ? () => onRowClick?.(row) : undefined}
                    sx={{
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'background-color 0.15s ease',
                      '&:last-child td': { borderBottom: 0 },
                    }}
                  >
                    {columns.map((col) => {
                      const content = col.accessor
                        ? col.accessor(row)
                        : col.render
                          ? col.render(row)
                          : (row as any)[col.id];
                      return (
                        <TableCell
                          key={col.id}
                          align={col.align ?? 'left'}
                          sx={{
                            py: 1.5,
                            fontSize: '0.875rem',
                            borderColor: 'grey.100',
                          }}
                        >
                          {content}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {pagination && (
        <Box
          sx={{
            p: 1.5,
            px: 2.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'grey.50',
          }}
        >
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            {pagination.page !== undefined && pagination.totalPages !== undefined
              ? `Page ${pagination.page} of ${pagination.totalPages}`
              : `Showing ${data.length} records`}
          </Typography>

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={pagination.hasPrevPage === false}
              onClick={pagination.onPrev}
              data-testid={pagination.prevTestId}
              sx={{
                borderRadius: 1.5,
                borderColor: 'divider',
                fontSize: 12,
                px: 1.5,
                py: 0.3,
                bgcolor: 'background.paper',
              }}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={pagination.hasNextPage === false}
              onClick={pagination.onNext}
              data-testid={pagination.nextTestId}
              sx={{
                borderRadius: 1.5,
                borderColor: 'divider',
                fontSize: 12,
                px: 1.5,
                py: 0.3,
                bgcolor: 'background.paper',
              }}
            >
              Next
            </Button>
          </Stack>
        </Box>
      )}
    </Card>
  );
}
