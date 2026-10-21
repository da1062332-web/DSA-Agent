import { describe, expect, it } from 'vitest';
import { ERROR_HTTP_STATUS, RETRYABLE_ERROR_CODES } from './errors';
import { AppError } from './kernel';

// The Contracts §6 catalogue, transcribed independently so a change to errors.ts must be made twice on purpose.
const CONTRACTS_SECTION_6: Record<string, number> = {
  MALFORMED_REQUEST: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  STEP_UP_REQUIRED: 401,
  FORBIDDEN: 403,
  SOD_VIOLATION: 403,
  MODULE_NOT_ENABLED: 403,
  NOT_FOUND: 404,
  DECISION_KEY_UNKNOWN: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  INVALID_STATE: 409,
  INVALID_CASE_STATUS: 409,
  DOCUMENT_QUARANTINED: 409,
  TENANT_SLUG_TAKEN: 409,
  INACTIVE_SANCTION: 409,
  SANCTION_EXPIRED: 409,
  DUPLICATE_LEAD: 409,
  CUSTOMER_MATCH_FOUND: 409,
  ACTIVE_CASE_EXISTS: 409,
  EFFECTIVE_OVERLAP: 409,
  CONTENT_HASH_MISMATCH: 409,
  RULE_SET_EXISTS: 409,
  DRAFT_LIMIT_REACHED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  VALIDATION_ERROR: 422,
  EXCEEDS_SANCTION: 422,
  CONSENT_REQUIRED: 422,
  COMPLETENESS_FAILED: 422,
  DECISION_FAILED_CLOSED: 422,
  EMPANELMENT_INACTIVE: 422,
  LENDER_PAUSED: 422,
  INVALID_ASSIGNEE: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  TESTS_FAILING: 422,
  VALIDATION_STALE: 422,
  EVIDENCE_MISSING: 422,
  QUORUM_NOT_MET: 422,
  SCOPE_NOT_ALLOWED: 422,
  SCHEMA_INVALID: 422,
  INPUT_INVALID: 422,
  SEND_BLOCKED: 422,
  USAGE_LIMIT_EXCEEDED: 422,
  MALWARE_DETECTED: 422,
  LINK_EXPIRED: 410,
  LINK_LOCKED: 423,
  RATE_LIMITED: 429,
  TENANT_CONTEXT_MISSING: 500,
  INTERNAL_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503,
};

describe('error catalogue', () => {
  it('TEST-KRN-001 every ErrorCode has an HTTP status matching the Contracts §6 table', () => {
    expect(ERROR_HTTP_STATUS).toEqual(CONTRACTS_SECTION_6);
  });

  it('TEST-KRN-001 only the §6 retryable codes are retryable', () => {
    expect([...RETRYABLE_ERROR_CODES].sort()).toEqual(
      ['DEPENDENCY_UNAVAILABLE', 'IDEMPOTENCY_IN_PROGRESS', 'RATE_LIMITED'].sort(),
    );
  });

  it('AppError.of takes the HTTP status and retryable flag from the catalogue', () => {
    const err = AppError.of('RATE_LIMITED', 'slow down');
    expect(err).toBeInstanceOf(Error);
    expect(err.httpStatus).toBe(429);
    expect(err.retryable).toBe(true);
    expect(AppError.of('NOT_FOUND', 'x').retryable).toBe(false);
  });
});
