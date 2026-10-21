import React, { type ReactNode } from 'react';
import { hasPermission, useMe } from '../api/useMe';
import { type ActionId, canPerformAction } from './access';

export interface UseCanOptions {
  /** If specified and false, the action is denied regardless of user permissions */
  when?: boolean;
}

/**
 * Hook to check whether the authenticated user has permission to perform a specific action.
 * Fails closed: while useMe is loading, errored, or unauthenticated, returns false.
 */
export function useCan(action: ActionId | string, options?: UseCanOptions): boolean {
  const { data: me, isLoading, isError } = useMe();
  if (isLoading || isError || !me) {
    return false;
  }
  if (options?.when === false) {
    return false;
  }
  return canPerformAction(action, (code) => hasPermission(me, code));
}

export interface CanProps {
  /** Action identifier from ACTION_RULES or direct permission code */
  action: ActionId | string;
  /** Optional secondary condition (e.g. record state !== 'LOCKED') */
  when?: boolean;
  /** Fallback content when forbidden (defaults to null, hiding the control) */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Declarative component for guarding action buttons and mutating controls.
 * Hides children (or displays fallback) if the user lacks the required permission.
 */
export function Can({ action, when = true, fallback = null, children }: CanProps) {
  const allowed = useCan(action, { when });
  if (!allowed) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
