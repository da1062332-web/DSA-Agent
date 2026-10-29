import React from 'react';
import { Box, Chip } from '@mui/material';

export type CanonicalStatusCategory = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export interface StatusBadgeProps {
  label?: string;
  status?: CanonicalStatusCategory | string;
  variant?: 'subtle' | 'solid' | 'outlined';
  size?: 'small' | 'medium';
  dot?: boolean;
  dataTestId?: string;
}

const CATEGORY_MAP: Record<string, CanonicalStatusCategory> = {
  // Success / Positive
  VERIFIED: 'success',
  APPROVED: 'success',
  DISBURSED: 'success',
  PAID: 'success',
  QUALIFIED: 'success',
  CONVERTED: 'success',
  ACTIVE: 'success',
  RESOLVED: 'success',
  COMPLETED: 'success',
  SUCCESS: 'success',
  PAYMENT_RECORDED: 'success',
  SANCTIONED: 'success',
  PARTIALLY_DISBURSED: 'success',

  // Warning / In-flight
  CONTACT_ATTEMPTED: 'warning',
  IN_PROGRESS: 'warning',
  PENDING: 'warning',
  SUBMITTED: 'warning',
  ISSUED: 'warning',
  IN_REVIEW: 'warning',
  UNDERWRITING: 'warning',
  UNDER_REVIEW: 'warning',
  DOCUMENTS_PENDING: 'warning',
  WARNING: 'warning',
  HIGH: 'warning',

  // Error / Blocked / Negative
  REJECTED: 'error',
  DISQUALIFIED: 'error',
  NOT_CONTACTABLE: 'error',
  VOID: 'error',
  PAYMENT_FAILED: 'error',
  FAILED: 'error',
  CANCELLED: 'error',
  ERROR: 'error',
  URGENT: 'error',
  HIGH_RISK: 'error',
  OVERDUE: 'error',

  // Info / New
  NEW: 'info',
  DRAFT: 'info',
  OPEN: 'info',
  SCHEDULED: 'info',
  INFO: 'info',
  READY_FOR_SUBMISSION: 'info',
  LOW: 'info',
  MEDIUM: 'info',

  // Neutral
  ARCHIVED: 'neutral',
  CLOSED: 'neutral',
  WITHDRAWN: 'neutral',
  INACTIVE: 'neutral',
  NONE: 'neutral',
  DEFAULT: 'neutral',
};

// Green = done / healthy, amber = needs attention, red = failed / blocked, blue = new / informational, grey = inactive.
const PALETTE = {
  success: {
    bg: '#F0FDF4',
    text: '#166534',
    dot: '#16A34A',
    border: '#BBF7D0',
    solidBg: '#15803D',
  },
  warning: {
    bg: '#FFFBEB',
    text: '#92400E',
    dot: '#F59E0B',
    border: '#FDE68A',
    solidBg: '#D97706',
  },
  error: {
    bg: '#FEF2F2',
    text: '#991B1B',
    dot: '#DC2626',
    border: '#FECACA',
    solidBg: '#DC2626',
  },
  info: {
    bg: '#EFF6FF',
    text: '#1E40AF',
    dot: '#3B82F6',
    border: '#BFDBFE',
    solidBg: '#2563EB',
  },
  neutral: {
    bg: '#F8FAFC',
    text: '#475569',
    dot: '#94A3B8',
    border: '#E2E8F0',
    solidBg: '#64748B',
  },
};

export function resolveStatusCategory(input?: string): CanonicalStatusCategory {
  if (!input) return 'neutral';
  const upper = input.toUpperCase().replace(/\s+/g, '_');
  if (upper in CATEGORY_MAP) {
    return CATEGORY_MAP[upper]!;
  }
  return 'neutral';
}

export function StatusBadge({
  label,
  status,
  variant = 'subtle',
  size = 'small',
  dot = true,
  dataTestId,
}: StatusBadgeProps) {
  const category = (
    status && ['success', 'warning', 'error', 'info', 'neutral'].includes(status)
      ? status
      : resolveStatusCategory(status || label)
  ) as CanonicalStatusCategory;

  const displayLabel = label ?? (status ? status.replace(/_/g, ' ') : '');
  const colors = PALETTE[category] ?? PALETTE.neutral;

  let sxProps: any = {
    fontWeight: 600,
    fontSize: size === 'small' ? '0.725rem' : '0.8125rem',
    height: size === 'small' ? 22 : 28,
    borderRadius: '6px',
    letterSpacing: '0.01em',
    transition: 'all 0.15s ease',
  };

  if (variant === 'solid') {
    sxProps = {
      ...sxProps,
      bgcolor: colors.solidBg,
      color: '#ffffff',
    };
  } else if (variant === 'outlined') {
    sxProps = {
      ...sxProps,
      bgcolor: 'transparent',
      color: colors.text,
      border: `1px solid ${colors.border}`,
    };
  } else {
    // subtle
    sxProps = {
      ...sxProps,
      bgcolor: colors.bg,
      color: colors.text,
      border: `1px solid ${colors.border}`,
    };
  }

  const dotIcon = dot ? (
    <Box
      component="span"
      sx={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        bgcolor: variant === 'solid' ? '#ffffff' : colors.dot,
        mr: 0.75,
        ml: 0.25,
        display: 'inline-block',
      }}
    />
  ) : null;

  return (
    <Chip
      size={size}
      label={
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {dotIcon}
          <span>{displayLabel}</span>
        </Box>
      }
      data-testid={dataTestId}
      sx={sxProps}
    />
  );
}
