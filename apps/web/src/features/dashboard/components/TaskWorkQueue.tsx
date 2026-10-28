import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { NotSet } from '../../../ui/NotSet';

export interface TaskWorkQueueItem {
  id: string;
  title: string;
  category?: string;
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  dueDate?: string;
  isOverdue?: boolean;
  slaMinutesRemaining?: number;
  entityLink?: {
    label: string;
    to: string;
  };
  actionLabel?: string;
  onAction?: (item: TaskWorkQueueItem) => void;
}

export interface TaskWorkQueueProps {
  title: string;
  subtitle?: string;
  items: TaskWorkQueueItem[];
  isLoading?: boolean;
  emptyMessage?: string;
  viewAllTo?: string;
  maxItems?: number;
  dataTestId?: string;
}

function getPriorityColor(priority: TaskWorkQueueItem['priority']): 'error' | 'warning' | 'info' | 'default' {
  switch (priority) {
    case 'URGENT':
      return 'error';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    case 'LOW':
    default:
      return 'default';
  }
}

function renderSlaBadge(item: TaskWorkQueueItem) {
  if (item.isOverdue) {
    return <Chip label="Overdue" size="small" color="error" sx={{ height: 20, fontSize: 10, fontWeight: 700 }} />;
  }
  if (item.slaMinutesRemaining !== undefined) {
    if (item.slaMinutesRemaining <= 0) {
      return <Chip label="Overdue" size="small" color="error" sx={{ height: 20, fontSize: 10, fontWeight: 700 }} />;
    }
    if (item.slaMinutesRemaining <= 120) {
      return (
        <Chip
          label={`< ${Math.ceil(item.slaMinutesRemaining / 60)}h left`}
          size="small"
          color="warning"
          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
        />
      );
    }
  }
  if (item.dueDate) {
    return (
      <Typography variant="caption" color="text.secondary" fontWeight={500} sx={{ whiteSpace: 'nowrap' }}>
        {new Date(item.dueDate).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
      </Typography>
    );
  }
  return null;
}

export function TaskWorkQueue({
  title,
  subtitle,
  items,
  isLoading = false,
  emptyMessage = 'No tasks requiring immediate action',
  viewAllTo,
  maxItems = 4,
  dataTestId,
}: TaskWorkQueueProps) {
  const displayItems = items.slice(0, maxItems);

  return (
    <Card
      data-testid={dataTestId}
      sx={{
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                {title}
              </Typography>
              <Chip
                label={items.length}
                size="small"
                color={items.some((i) => i.priority === 'URGENT' || i.isOverdue) ? 'error' : 'primary'}
                sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              />
            </Stack>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {viewAllTo && (
            <Button
              component={RouterLink}
              to={viewAllTo}
              size="small"
              variant="text"
              sx={{ textTransform: 'none', fontWeight: 600, fontSize: 12, p: 0.5 }}
            >
              View all &rarr;
            </Button>
          )}
        </Stack>

        {isLoading ? (
          <Stack spacing={1.5} sx={{ py: 1 }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" width="100%" height={38} />
            ))}
          </Stack>
        ) : items.length === 0 ? (
          <Box
            sx={{
              py: 4,
              px: 2,
              textAlign: 'center',
              bgcolor: 'action.hover',
              borderRadius: 2,
              border: '1px dashed',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" fontWeight={600} color="text.primary" gutterBottom>
              {emptyMessage}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              All queue items and checklists are up to date.
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, px: 1 }}>
                    Task / Action
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, px: 1 }}>
                    Priority
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, px: 1 }}>
                    Entity
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, px: 1 }}>
                    SLA / Due
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, py: 0.75, px: 1 }}>
                    Action
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayItems.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{
                      transition: 'background-color 0.15s',
                      '&:last-child td, &:last-child th': { border: 0 },
                    }}
                  >
                    <TableCell sx={{ py: 1, px: 1 }}>
                      <Typography variant="body2" fontWeight={600} color="text.primary" sx={{ lineHeight: 1.25 }}>
                        {item.title}
                      </Typography>
                      {item.category && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {item.category}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 1, px: 1 }}>
                      <Chip
                        label={item.priority}
                        size="small"
                        color={getPriorityColor(item.priority)}
                        sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell sx={{ py: 1, px: 1 }}>
                      {item.entityLink ? (
                        <Chip
                          component={RouterLink}
                          to={item.entityLink.to}
                          label={item.entityLink.label}
                          size="small"
                          clickable
                          variant="outlined"
                          color="primary"
                          sx={{ height: 20, fontSize: 10, fontWeight: 600 }}
                        />
                      ) : (
                        <NotSet />
                      )}
                    </TableCell>
                    <TableCell sx={{ py: 1, px: 1 }}>{renderSlaBadge(item)}</TableCell>
                    <TableCell align="right" sx={{ py: 1, px: 1 }}>
                      {item.actionLabel && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => item.onAction?.(item)}
                          component={item.entityLink?.to ? RouterLink : 'button'}
                          to={item.entityLink?.to}
                          sx={{
                            fontSize: 11,
                            py: 0.25,
                            px: 1,
                            minWidth: 56,
                            height: 24,
                            textTransform: 'none',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.actionLabel}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
