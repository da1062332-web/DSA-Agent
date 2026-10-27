import React, { cloneElement, type ReactElement } from 'react';
import { Tooltip } from '@mui/material';
import { useCan } from './Can';

export interface RowActionProps {
  /** Action id or permission code. The button is blurred (disabled) when the user lacks it. */
  action?: string;
  /** Record-state condition, e.g. status === 'ACTIVE'. The button is blurred when false. */
  allowed?: boolean;
  /** Tooltip text for a blurred control. Defaults to a message built from the permission or the record state. */
  reason?: string;
  /** A single button element. */
  children: ReactElement;
}

/**
 * Action button for table rows. An action the user cannot take on this record stays visible but disabled,
 * with a tooltip that says why, instead of disappearing from the row.
 */
export function RowAction({ action, allowed = true, reason: customReason, children }: RowActionProps) {
  const permitted = useCan(action ?? '');
  const hasPermission = !action || permitted;
  if (hasPermission && allowed) return children;

  const reason =
    customReason ?? (!hasPermission ? "You don't have permission for this action" : 'Not available for this record right now');
  const props = children.props as { to?: string };
  // Drop the link target so a blurred control cannot still navigate.
  const blurred = cloneElement(children, { disabled: true, to: undefined, ...(props.to ? { component: 'button' } : {}) });
  return (
    <Tooltip title={reason} arrow>
      <span style={{ display: 'inline-flex' }}>{blurred}</span>
    </Tooltip>
  );
}
