// apps/api/src/modules/automation/lifecycle.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import { AppError, type ExecutionStatus } from '@dsa/contracts';

/**
 * Valid execution state transitions:
 * - PENDING: Initial state, can transition to RUNNING (worker claims) or CANCELLED (operator aborts).
 * - RUNNING: Active execution, can transition to WAITING (timer/approval), RETRYING (transient error),
 *            SUCCEEDED (all steps done), FAILED (fatal error/timeout), DEAD_LETTERED (retries exhausted/ambiguous),
 *            or CANCELLED.
 * - WAITING: Paused awaiting external trigger/timer, can resume to RUNNING, or transition to FAILED/CANCELLED.
 * - RETRYING: Scheduled for backoff retry, transitions to RUNNING when claimed, or DEAD_LETTERED/FAILED/CANCELLED.
 * - DEAD_LETTERED: Operator intervention required, can transition to RUNNING/RETRYING (retry action) or CANCELLED.
 * - SUCCEEDED, FAILED, CANCELLED: Terminal states; no further transitions allowed.
 */
export const VALID_EXECUTION_TRANSITIONS: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  PENDING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['WAITING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED'],
  WAITING: ['RUNNING', 'FAILED', 'CANCELLED'],
  RETRYING: ['RUNNING', 'DEAD_LETTERED', 'FAILED', 'CANCELLED'],
  DEAD_LETTERED: ['RUNNING', 'RETRYING', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.includes(status);
}

export function isValidTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  if (from === to) return true; // Idempotent no-op
  const allowed = VALID_EXECUTION_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
  executionId?: string,
): void {
  if (!isValidTransition(from, to)) {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot transition execution${executionId ? ` '${executionId}'` : ''} from state '${from}' to '${to}'.`,
    );
  }
}
