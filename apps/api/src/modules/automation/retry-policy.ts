// apps/api/src/modules/automation/retry-policy.ts — owner: Dev 1 / Dev 6 (MOD-WFA)
import type { ErrorClassification } from '@dsa/contracts';
import type { RetryPolicyConfig } from './types';

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  // 1 minute, 5 minutes, 30 minutes, 2 hours
  delaysMs: [60_000, 300_000, 1_800_000, 7_200_000],
  maxAttempts: 4,
  jitterFraction: 0.1, // +/- 10%
};

/**
 * Calculates the backoff delay in ms for a given attempt (1-based index).
 * E.g.:
 * attempt 1 -> ~60,000 ms (1m)
 * attempt 2 -> ~300,000 ms (5m)
 * attempt 3 -> ~1,800,000 ms (30m)
 * attempt 4 -> ~7,200,000 ms (2h)
 */
export function calculateRetryDelay(
  attempt: number,
  config: Partial<RetryPolicyConfig> = {},
  randomFn: () => number = Math.random,
): number {
  const merged = { ...DEFAULT_RETRY_CONFIG, ...config };
  const idx = Math.min(Math.max(1, attempt) - 1, merged.delaysMs.length - 1);
  const baseDelay = merged.delaysMs[idx] ?? 60_000;

  if (merged.jitterFraction <= 0) {
    return baseDelay;
  }

  // Jitter range: baseDelay * (1 +/- jitterFraction)
  const delta = baseDelay * merged.jitterFraction;
  const jitterOffset = (randomFn() * 2 - 1) * delta;
  return Math.max(1000, Math.round(baseDelay + jitterOffset));
}

/**
 * Classifies an error into RETRYABLE, PERMANENT, or AMBIGUOUS.
 */
export function classifyError(error: unknown): ErrorClassification {
  if (!error || typeof error !== 'object') {
    return 'PERMANENT';
  }

  const err = error as Record<string, unknown>;

  // Explicit classification if attached
  if (err.classification && typeof err.classification === 'string') {
    const c = err.classification.toUpperCase();
    if (c === 'RETRYABLE' || c === 'PERMANENT' || c === 'AMBIGUOUS') {
      return c as ErrorClassification;
    }
  }

  const code = String(err.code || '');
  const status = Number(err.httpStatus || err.status || 0);
  const message = String(err.message || '').toLowerCase();

  // Retryable patterns: transient transport, 502/503/504, DB pool timeout
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'RATE_LIMIT_EXCEEDED' ||
    message.includes('timeout') ||
    message.includes('deadlock') ||
    message.includes('connection reset')
  ) {
    return 'RETRYABLE';
  }

  // Ambiguous patterns: request dispatched but response interrupted/unconfirmed
  if (
    code === 'AMBIGUOUS_RESPONSE' ||
    message.includes('indeterminate') ||
    message.includes('unconfirmed') ||
    message.includes('socket hang up after send')
  ) {
    return 'AMBIGUOUS';
  }

  // Permanent by default for validation errors, 4xx, business rule violations
  return 'PERMANENT';
}

/**
 * Redacts potential sensitive data from error metadata before saving.
 */
export function sanitizeErrorDetails(details: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = [
    'password',
    'secret',
    'token',
    'authorization',
    'apikey',
    'api_key',
    'pan',
    'aadhaar',
    'account_number',
    'accountnumber',
    'cvv',
  ];

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeErrorDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
