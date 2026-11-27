// packages/contracts/src/ports/kyc-port.ts — owner: Prathamesh (MOD-INT Integrations provides; added 2026-11-27, additive, Contracts §15,
// P1-06). Lets the verification module run a provider KYC check (PAN, GSTIN) without reading the integration tables or the vendor
// adapters. It runs inside the caller's transaction, so the caller's Idempotency-Key row covers the vendor call: a concurrent
// duplicate request waits and then replays, and the vendor is never called twice for one key.
import type { RequestContext, Tx } from '../kernel';
import type { KycRunnableCheck, MinimalResult, VerificationResult } from '../verification';

export interface KycCheckRequest {
  check: KycRunnableCheck;
  /** The full PAN or GSTIN. It goes to the vendor and nowhere else. */
  idNumber: string;
  /** The name to compare with the one the vendor holds (free text, never stored); omitted means no name check. */
  name?: string;
  /** The vendor's case id. Stable for one Idempotency-Key, so a retry reaches the vendor with the same id. */
  caseId: string;
}

/** What the check came to: the vendor said valid (and the name matched), said not valid or no match, or could not decide. */
export type KycCheckOutcome = 'VERIFIED' | 'MISMATCH' | 'FAILED';

/** The result of a check that reached a decision. It carries no personal data: the identifier is masked, the name is only a score. */
export interface KycCheckResult {
  /** The provider that answered, e.g. KARZA. */
  provider: string;
  outcome: KycCheckOutcome;
  /** The value a verification record stores: VERIFIED, REJECTED (a mismatch) or INCONCLUSIVE (the vendor could not decide). */
  verificationResult: VerificationResult;
  /** Name-match score 0 to 100, or null when no name was asked for or none could be compared. Never a default. */
  matchScore: number | null;
  /** ABCDE****F for a PAN, 27ABCDE****F1Z5 for a GSTIN. */
  identifierMasked: string;
  /** The vendor's request id, or null when it sent none. */
  referenceId: string | null;
  /** A fixed reason code (NAME_MISMATCH, ID_INVALID, GST_NOT_ACTIVE, ...), or null for a verified check. */
  reason: string | null;
  /** Ready to store as verification.minimal_result. */
  minimalResult: MinimalResult;
}

export interface KycCheckPort {
  /**
   * Runs one check at the tenant's active provider. A decision (verified, mismatch, failed) is returned. Everything else is thrown
   * as an AppError and nothing is recorded: no active provider connection (422 VALIDATION_ERROR), a timeout or an unavailable vendor
   * (503 DEPENDENCY_UNAVAILABLE), a rate limit (429 RATE_LIMITED), a refused credential or an answer it does not recognise (500).
   * Only RATE_LIMITED and DEPENDENCY_UNAVAILABLE are retryable; an error is never a verified result.
   */
  run(tx: Tx, ctx: RequestContext, request: KycCheckRequest): Promise<KycCheckResult>;
}
