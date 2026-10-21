// packages/contracts/src/errors.ts — owner: Dev 1 — frozen at Gate 1 (Contracts §6)
import { z } from 'zod';

export const ERROR_HTTP_STATUS = {
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
  DUPLICATE_LEAD: 409,
  CUSTOMER_MATCH_FOUND: 409,
  ACTIVE_CASE_EXISTS: 409,
  INVALID_CASE_STATUS: 409,
  DOCUMENT_QUARANTINED: 409,
  TENANT_SLUG_TAKEN: 409,
  INACTIVE_SANCTION: 409,
  SANCTION_EXPIRED: 409,
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
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

/** Codes marked "Retryable: Yes" in Contracts §6. */
export const RETRYABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
]);

export const ErrorDetail = z.object({
  field: z.string().optional(),
  issue: z.string(),
  meta: z.record(z.unknown()).optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    httpStatus: z.number().int(),
    correlationId: z.string(),
    details: z.array(ErrorDetail).optional(),
    retryable: z.boolean(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
