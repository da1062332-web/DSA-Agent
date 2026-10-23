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
      <Typography variant="caption" color="text.secondary" fontWeight={500}>
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
  dataTestId,
}: TaskWorkQueueProps) {
  return (
    <Card
      data-testid={dataTestId}
      sx={{
        height: '100%',
        borderRadius: 2.5,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" fontWeight={700} sx={{ letterSpacing: '-0.01em' }}>
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
              <Typography variant="body2" color="text.secondary">
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
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              View all &rarr;
            </Button>
          )}
        </Stack>

        {isLoading ? (
          <Stack spacing={1.5} sx={{ my: 'auto' }}>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" width="100%" height={48} />
            ))}
          </Stack>
        ) : items.length === 0 ? (
          <Box
            sx={{
              my: 'auto',
              py: 5,
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
          <TableContainer sx={{ flex: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Task / Action
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Priority
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Entity
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    SLA / Due
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Action
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow
                    key={item.id}
                    hover
                    sx={{
                      transition: 'background-color 0.15s',
                      '&:last-child td, &:last-child th': { border: 0 },
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} color="text.primary">
                        {item.title}
                      </Typography>
                      {item.category && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {item.category}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={item.priority}
                        size="small"
                        color={getPriorityColor(item.priority)}
                        sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                      />
                    </TableCell>
                    <TableCell>
                      {item.entityLink ? (
                        <Chip
                          component={RouterLink}
                          to={item.entityLink.to}
                          label={item.entityLink.label}
                          size="small"
                          clickable
                          variant="outlined"
                          color="primary"
                          sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>{renderSlaBadge(item)}</TableCell>
                    <TableCell align="right">
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
                            px: 1.25,
                            height: 26,
                            textTransform: 'none',
                            fontWeight: 600,
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
