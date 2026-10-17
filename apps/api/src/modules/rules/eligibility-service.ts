// apps/api/src/modules/rules/eligibility-service.ts — owner: Developer 2 (Module 23: Business Rule Engine)
import type {
  DecisionPort,
  DecisionRequest,
  DecisionResult,
  Facts,
  Outputs,
  RequestContext,
  Tx,
} from '@dsa/contracts';

export interface EvaluateEligibilityInput {
  applicationId: string;
  applicant: Facts['DK-application.eligibility']['applicant'];
  application: Facts['DK-application.eligibility']['application'];
  product: Facts['DK-application.eligibility']['product'];
  scope?: { branchId?: string; productVersionId?: string; lenderId?: string };
}

export interface EligibilityEvaluationResult {
  decisionRecordId: string;
  status: DecisionResult<'DK-application.eligibility'>['status'];
  result: 'ELIGIBLE' | 'INELIGIBLE' | 'REFER';
  maxEligibleAmount: { amount: string; currency: string } | null;
  reasons: { code: string; text: string }[];
  fallbackApplied: boolean;
  replayed: boolean;
}

/**
 * Eligibility interface required by dependent modules (e.g. applications/origination)
 * to evaluate borrower eligibility via the Business Rule Engine.
 */
export async function evaluateApplicationEligibility(
  tx: Tx,
  ctx: RequestContext,
  decisionPort: DecisionPort,
  input: EvaluateEligibilityInput,
  idempotencyKey?: string,
): Promise<EligibilityEvaluationResult> {
  const req: DecisionRequest<'DK-application.eligibility'> = {
    decisionKey: 'DK-application.eligibility',
    scope: input.scope ?? {},
    subject: { type: 'LOAN_APPLICATION', id: input.applicationId },
    facts: {
      applicant: input.applicant,
      application: input.application,
      product: input.product,
    },
    evaluationTime:
      typeof ctx.now === 'string'
        ? ctx.now
        : ctx.now instanceof Date
          ? ctx.now.toISOString()
          : new Date().toISOString(),
    idempotencyKey: idempotencyKey ?? `elg_${input.applicationId}_${Date.now()}`,
  };

  const decision = await decisionPort.decide(tx, ctx, req);
  const outputs = decision.outputs as Outputs['DK-application.eligibility'] | null;

  return {
    decisionRecordId: decision.decisionRecordId,
    status: decision.status,
    result: outputs?.result ?? 'REFER',
    maxEligibleAmount: outputs?.maxEligibleAmount ?? null,
    reasons: outputs?.reasons ?? [
      { code: 'UNDERWRITING_REFERRAL', text: 'Evaluation referred for manual credit assessment' },
    ],
    fallbackApplied: decision.fallbackApplied,
    replayed: decision.replayed,
  };
}

/**
 * Adapter helper to transform BRE Decision outputs into Module 17 Criterion[] array
 */
export function toEligibilityCriteria(result: EligibilityEvaluationResult): Array<{
  code: string;
  result: 'PASS' | 'FAIL' | 'UNKNOWN';
  reason: string;
}> {
  const criterionResult: 'PASS' | 'FAIL' | 'UNKNOWN' =
    result.result === 'ELIGIBLE' ? 'PASS' : result.result === 'INELIGIBLE' ? 'FAIL' : 'UNKNOWN';

  return result.reasons.map((r) => ({
    code: r.code,
    result: criterionResult,
    reason: r.text,
  }));
}
