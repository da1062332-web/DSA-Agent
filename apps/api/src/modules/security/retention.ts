// apps/api/src/modules/security/retention.ts — Module 39: Security (MOD-SEC)
// Retention Policy, CERT-In Compliance, and Partitioning Boundaries

import { AppError } from '@dsa/contracts';

export const RETENTION_RULES = {
  /**
   * Mandatory CERT-In Cyber Security Directions (28 April 2022):
   * All security and system logs must be retained for at least 180 days within Indian jurisdiction.
   */
  CERT_IN_MINIMUM_DAYS: 180,

  /**
   * Default platform retention for audit logs and security monitoring.
   */
  PLATFORM_DEFAULT_DAYS: 365,
} as const;

export interface RetentionPolicyCheck {
  allowed: boolean;
  reason?: string;
  minimumDays: number;
}

/**
 * Validates whether a proposed retention or purge cutoff date satisfies regulatory requirements.
 */
export function validateRetentionPurge(
  cutoffDate: Date,
  now: Date = new Date(),
  minDays: number = RETENTION_RULES.CERT_IN_MINIMUM_DAYS,
): RetentionPolicyCheck {
  const minRetentionThreshold = new Date(now.getTime() - minDays * 24 * 60 * 60 * 1000);

  // If cutoffDate is newer than the minimum retention threshold, purging would delete logs < 180 days old
  if (cutoffDate.getTime() > minRetentionThreshold.getTime()) {
    return {
      allowed: false,
      reason: `Purge cutoff (${cutoffDate.toISOString()}) violates mandatory CERT-In ${minDays}-day retention policy. Oldest allowed purge cutoff is ${minRetentionThreshold.toISOString()}.`,
      minimumDays: minDays,
    };
  }

  return {
    allowed: true,
    minimumDays: minDays,
  };
}

/**
 * Asserts retention compliance; throws AppError('PRECONDITION_FAILED') if violating retention policies.
 */
export function assertRetentionCompliance(
  cutoffDate: Date,
  now: Date = new Date(),
  minDays: number = RETENTION_RULES.CERT_IN_MINIMUM_DAYS,
): void {
  const check = validateRetentionPurge(cutoffDate, now, minDays);
  if (!check.allowed) {
    throw AppError.of('VALIDATION_ERROR', check.reason ?? 'Retention policy violation.');
  }
}
