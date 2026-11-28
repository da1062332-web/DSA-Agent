// packages/contracts/src/ports/bureau-port.ts — owner: Prathamesh (MOD-INT Integrations provides; added 2026-11-28, additive, Contracts §15,
// P1-05). Lets the verification module pull a credit-bureau summary without reading the integration tables or the vendor adapters. It runs
// inside the caller's transaction, so the caller's Idempotency-Key row and advisory lock cover the vendor call.
import type { CreditBureau, CreditReportOutcome } from '../credit-report';
import type { RequestContext, Tx } from '../kernel';
import type { Money } from '../money';

export interface BureauPullRequest {
  bureau: CreditBureau;
  /** The name to match. It goes to the vendor and nowhere else. */
  name: string;
  /** The full PAN. It goes to the vendor and nowhere else. */
  pan: string;
  /** YYYY-MM-DD. It goes to the vendor and nowhere else. */
  dateOfBirth: string;
  /** The vendor's case id. Stable for one Idempotency-Key, so a retry reaches the vendor with the same id. */
  caseId: string;
}

/** The summary of a SCORED report. */
export interface BureauSummary {
  /** 300 to 900. */
  score: number;
  activeAccounts: number;
  monthlyEmi: Money;
  maxDpd12m: number;
  enquiries6m: number;
}

/** What a pull came to. It carries no personal data: no PAN, date of birth or name, and never the raw report. */
export interface BureauPullResult {
  /** The provider that answered, e.g. CRIF. */
  provider: string;
  outcome: CreditReportOutcome;
  /** YYYY-MM-DD, as the bureau gives it. */
  reportDate: string;
  /** The summary of a SCORED report; null for NO_HISTORY. A score is never invented. */
  summary: BureauSummary | null;
  /** The vendor's request id, or null when it sent none. */
  vendorRef: string | null;
  /** The unit cost from the connection's configuration; null when none is configured. */
  unitCost: Money | null;
}

export interface BureauPullPort {
  /**
   * Pulls one report at the tenant's active bureau provider. A report (scored, or no history) is returned. Everything else is thrown as
   * an AppError and nothing is recorded: no active provider connection (422 VALIDATION_ERROR), a timeout or an unavailable vendor
   * (503 DEPENDENCY_UNAVAILABLE), a rate limit (429 RATE_LIMITED), a refused credential or an answer it does not recognise (500). Only
   * RATE_LIMITED and DEPENDENCY_UNAVAILABLE are retryable. An error is never a score. A pull is attempted once.
   */
  pull(tx: Tx, ctx: RequestContext, request: BureauPullRequest): Promise<BureauPullResult>;
}
