// packages/contracts/src/fakes/fake-decision.ts — owner: Dev 2 (Gate 1 deliverable)
import type { RequestContext, Tx } from '../kernel';
import type { DecisionKey, Outputs } from '../ports/decision-keys';
import type { DecisionPort, DecisionRequest, DecisionResult } from '../ports/decision-port';

export class FakeDecisionPort implements DecisionPort {
  readonly decisions: DecisionRequest[] = [];
  defaultOutputs: Partial<Outputs> = {};

  async decide<K extends DecisionKey>(
    _tx: Tx,
    _ctx: RequestContext,
    req: DecisionRequest<K>,
  ): Promise<DecisionResult<K>> {
    this.decisions.push(req);
    const outputs = (this.defaultOutputs[req.decisionKey] as Outputs[K]) ?? null;
    return {
      decisionRecordId: `dr_${req.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      status: outputs ? 'OK' : 'NO_MATCH',
      outputs,
      fallbackApplied: false,
      fallbackPolicy: null,
      errorCode: null,
      missingFields: [],
      matchedRuleUids: [],
      ruleSetVersionId: null,
      inputHash: 'sha256:fake',
      replayed: false,
    };
  }
}
