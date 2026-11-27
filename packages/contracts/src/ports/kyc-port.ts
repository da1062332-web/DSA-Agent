// packages/contracts/src/ports/kyc-port.ts — owner: Prathamesh (MOD-INT Integrations provides; added 2026-11-27, additive, Contracts §15,
// P1-06). Lets the verification module run a provider KYC check (PAN, GSTIN, bank-account penny drop) without reading the integration
// tables or the vendor adapters. It runs inside the caller's transaction, so the caller's Idempotency-Key row covers the vendor call: a
// concurrent duplicate request waits and then replays, and the vendor is never called twice for one key.
import type { RequestContext, Tx } from '../kernel';
import type { MinimalResult, VerificationResult } from '../verification';

interface KycCheckRequestBase {
  /** The name to compare with the one the vendor holds (free text, never stored); omitted means no name check. */
  name?: string;
  /** The vendor's case id. Stable for one Idempotency-Key, so a retry reaches the vendor with the same id. */
  caseId: string;
}

/** A PAN or GSTIN lookup. It only reads a register, so it may be repeated. */
export interface KycLookupRequest extends KycCheckRequestBase {
  check: 'PAN' | 'GST';
  /** The full PAN or GSTIN. It goes to the vendor and nowhere else. */
  idNumber: string;
}

/** The penny drop: the vendor transfers Rs 1 to the account and returns the name the bank holds. It moves money. */
export interface KycBankAccountRequest extends KycCheckRequestBase {
  check: 'BANK_ACCOUNT';
  /** The full account number, digits only. It goes to the vendor and nowhere else. */
  accountNumber: string;
  /** The branch's IFSC code, upper case. A public code, not personal data. */
  ifsc: string;
}

export type KycCheckRequest = KycLookupRequest | KycBankAccountRequest;

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
  /** ABCDE****F for a PAN, 27ABCDE****F1Z5 for a GSTIN, ********1234 for a bank account. */
  identifierMasked: string;
  /** The vendor's request id, or null when it sent none. */
  referenceId: string | null;
  /** A fixed reason code (NAME_MISMATCH, ID_INVALID, GST_NOT_ACTIVE, BANK_TXN_FAILED, OUTCOME_UNKNOWN, ...), or null for a verified check. */
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
   *
   * The money rule (BANK_ACCOUNT only). The penny drop moves Rs 1, so the same request must never reach the vendor twice by
   * accident. When it cannot be known whether the Rs 1 was sent (a timeout, a dropped connection, HTTP 408 or 5xx, an answer that
   * cannot be read, an answer the adapter does not recognise) the port does NOT throw: it returns outcome FAILED, verificationResult
   * INCONCLUSIVE and reason OUTCOME_UNKNOWN, which the caller stores, so the Idempotency-Key is used up and a retry with it replays
   * the stored record. A new key is a deliberate new attempt. Only an answer that says nothing was done is still thrown (our own
   * validation, no connection, a refused credential, HTTP 400, 404, 422 or 429, the vendor's own "source busy or unavailable").
   * PAN and GST are never treated this way: for them every error is thrown and the same key can be retried.
   */
  run(tx: Tx, ctx: RequestContext, request: KycCheckRequest): Promise<KycCheckResult>;
}
