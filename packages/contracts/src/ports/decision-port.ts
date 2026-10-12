// packages/contracts/src/ports/decision-port.ts — owner: Dev 2 — frozen at Gate 1 (Contracts §4.2)
// Consumers: Dev 5 (lead/customer duplicate, routing), Dev 3 (checklist, completeness), Dev 6 (SLA target).
// Fake: fakes/fake-decision.ts — TODO(Dev 2, Gate 1) with the deterministic fixtures in Contracts §4.5.
import type { Iso8601, RequestContext, Tx } from '../kernel';
import type { DecisionKey, Facts, Outputs } from './decision-keys';

export type DecisionStatus = 'OK' | 'NO_MATCH' | 'UNKNOWN' | 'ERROR' | 'TIMEOUT' | 'NO_VERSION';

export interface DecisionRequest<K extends DecisionKey = DecisionKey> {
  decisionKey: K;
  scope: { branchId?: string; lenderId?: string; productVersionId?: string }; // drives the scope chain
  subject: { type: 'LEAD' | 'CUSTOMER' | 'LOAN_APPLICATION' | 'TASK'; id: string };
  facts: Facts[K];
  evaluationTime: Iso8601; // = ctx.now; the BRE never reads the clock
  idempotencyKey: string; // unique per (tenant, decisionKey); e.g. 'lead_01J…:routing:create'
}

export interface DecisionResult<K extends DecisionKey = DecisionKey> {
  decisionRecordId: string; // dr_… (every LIVE T2 decision is recorded)
  status: DecisionStatus;
  outputs: Outputs[K] | null; // rule outputs, default_output, or DK fallback_output; null ONLY when FAIL_CLOSED applied
  fallbackApplied: boolean;
  fallbackPolicy: 'DEFAULT_OUTPUT' | 'FAIL_CLOSED' | 'MANUAL_REVIEW' | null;
  errorCode: 'INVALID_INPUT' | 'MULTIPLE_MATCH' | 'STEP_BUDGET_EXCEEDED' | 'EVALUATION_ERROR' | null;
  missingFields: string[]; // fact paths that were MISSING and left a rule undetermined
  matchedRuleUids: string[];
  ruleSetVersionId: string | null;
  inputHash: string; // 'sha256:<hex>' of canonical facts JSON
  replayed: boolean; // true when idempotencyKey already had a record (same result returned)
}

export interface DecisionPort {
  /** LIVE evaluation inside the caller's transaction (decision record commits/rolls back with the caller).
   *  Never throws for business outcomes. Throws AppError only for DECISION_KEY_UNKNOWN or TENANT_CONTEXT_MISSING. */
  decide<K extends DecisionKey>(
    tx: Tx,
    ctx: RequestContext,
    req: DecisionRequest<K>,
  ): Promise<DecisionResult<K>>;
}
