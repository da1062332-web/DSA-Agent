// apps/api/src/modules/rules/engine/decision-engine.ts — owner: Developer 2 (Module 23: Business Rule Engine)
import {
  AppError,
  type DecisionKey,
  type DecisionPort,
  type DecisionRecordResponse,
  type DecisionRequest,
  type DecisionResult,
  type Outputs,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import {
  compileRuleSet,
  computeContentHash,
  evaluateRuleSet,
  type CompiledRuleSet,
  type HitPolicy,
  type RuleSetDefinition,
} from '@dsa/bre-core';
import { getDecisionDefinition, recordDecisionRecord } from '../db';
import { sql } from 'kysely';

export class LiveDecisionEngine implements DecisionPort {
  /**
   * Version-aware compilation cache to avoid re-compiling the same rule set version.
   */
  private readonly compiledCache = new Map<string, { contentHash: string; compiled: CompiledRuleSet }>();

  async decide<K extends DecisionKey>(
    tx: Tx,
    ctx: RequestContext,
    req: DecisionRequest<K>,
  ): Promise<DecisionResult<K>> {
    if (!ctx.principal || !ctx.principal.tenantId) {
      throw AppError.of('TENANT_CONTEXT_MISSING', 'Tenant context is required for decision evaluation.');
    }

    const definition = await getDecisionDefinition(tx, req.decisionKey);
    const tenantId = ctx.principal.tenantId;

    // Idempotency check: if already evaluated with same idempotencyKey, return replayed result
    const existingRec = await sql<{
      id: string;
      status: string;
      outputs: unknown;
      fallback_applied: boolean;
      fallback_policy: string | null;
      error_code: string | null;
      missing_fields: string[];
      matched_rule_uids: string[];
      rule_set_version_id: string | null;
      input_hash: string;
    }>`
      SELECT * FROM app.decision_record
      WHERE decision_key = ${req.decisionKey} AND idempotency_key = ${req.idempotencyKey}
      LIMIT 1
    `.execute(tx);

    if (existingRec.rows[0]) {
      const row = existingRec.rows[0];
      return {
        decisionRecordId: row.id,
        status: row.status as DecisionResult<K>['status'],
        outputs: (row.outputs as Outputs[K]) ?? null,
        fallbackApplied: Boolean(row.fallback_applied),
        fallbackPolicy: (row.fallback_policy as DecisionResult<K>['fallbackPolicy']) ?? null,
        errorCode: (row.error_code as DecisionResult<K>['errorCode']) ?? null,
        missingFields: row.missing_fields ?? [],
        matchedRuleUids: row.matched_rule_uids ?? [],
        ruleSetVersionId: row.rule_set_version_id,
        inputHash: row.input_hash,
        replayed: true,
      };
    }

    const inputHash = computeContentHash(req.facts);

    // Resolve active version along the scope chain (e.g. BRANCH -> TENANT_DEFAULT)
    let activeVersion: {
      id: string;
      ruleSetId: string;
      definition: RuleSetDefinition;
      hitPolicy: string;
      contentHash: string;
    } | null = null;

    for (const scopeType of definition.scopeChain) {
      let scopeRef: string | null = null;
      if (scopeType === 'BRANCH') scopeRef = req.scope.branchId ?? null;
      else if (scopeType === 'PRODUCT_VERSION') scopeRef = req.scope.productVersionId ?? null;
      else if (scopeType === 'LENDER') scopeRef = req.scope.lenderId ?? null;

      if (scopeType !== 'TENANT_DEFAULT' && !scopeRef) {
        continue;
      }

      const activeRes = await sql<{
        id: string;
        rule_set_id: string;
        definition: unknown;
        hit_policy: string;
        content_hash: string;
      }>`
        SELECT rsv.id, rsv.rule_set_id, rsv.definition, rsv.hit_policy, rsv.content_hash
        FROM app.rule_set rs
        JOIN app.rule_set_version rsv ON rsv.rule_set_id = rs.id
        WHERE rs.decision_key = ${req.decisionKey}
          AND rs.scope_type = ${scopeType}
          AND coalesce(rs.scope_ref, '-') = ${scopeRef ?? '-'}
          AND rsv.status = 'ACTIVE'
        LIMIT 1
      `.execute(tx);

      if (activeRes.rows[0]) {
        activeVersion = {
          id: activeRes.rows[0].id,
          ruleSetId: activeRes.rows[0].rule_set_id,
          definition: activeRes.rows[0].definition as RuleSetDefinition,
          hitPolicy: activeRes.rows[0].hit_policy,
          contentHash: activeRes.rows[0].content_hash,
        };
        break;
      }
    }

    const decisionRecordId = `dr_${inputHash.slice(7, 33)}`;

    if (!activeVersion) {
      // NO_VERSION active
      const fallbackApplied = true;
      const fallbackPolicy = definition.fallbackPolicy;
      const outputs = fallbackPolicy === 'DEFAULT_OUTPUT' ? (definition.fallbackOutput as Outputs[K]) : null;

      await recordDecisionRecord(tx, ctx, {
        id: decisionRecordId as DecisionRecordResponse['id'],
        tenantId,
        decisionKey: req.decisionKey,
        ruleSetVersionId: null,
        subjectType: req.subject.type,
        subjectId: req.subject.id,
        evaluationTime: req.evaluationTime,
        idempotencyKey: req.idempotencyKey,
        inputHash,
        inputSnapshot: (req.facts as Record<string, unknown>) ?? {},
        outputs: (outputs as Record<string, unknown>) ?? null,
        matchedRuleUids: [],
        missingFields: [],
        status: 'NO_VERSION',
        fallbackApplied,
        fallbackPolicy,
        errorCode: null,
        durationUs: 20,
        correlationId: ctx.correlationId,
        createdAt: new Date().toISOString(),
      });

      return {
        decisionRecordId,
        status: 'NO_VERSION',
        outputs,
        fallbackApplied,
        fallbackPolicy,
        errorCode: null,
        missingFields: [],
        matchedRuleUids: [],
        ruleSetVersionId: null,
        inputHash,
        replayed: false,
      };
    }

    // Version-aware caching
    let compiled = this.compiledCache.get(activeVersion.id);
    if (!compiled || compiled.contentHash !== activeVersion.contentHash) {
      compiled = {
        contentHash: activeVersion.contentHash,
        compiled: compileRuleSet(activeVersion.definition, activeVersion.hitPolicy as HitPolicy),
      };
      this.compiledCache.set(activeVersion.id, compiled);
    }

    const evalResult = evaluateRuleSet(compiled.compiled, (req.facts as Record<string, unknown>) ?? {}, {
      fallbackPolicy: definition.fallbackPolicy,
      fallbackOutput: definition.fallbackOutput as Record<string, unknown>,
      unknownPolicy: definition.unknownPolicy,
    });

    await recordDecisionRecord(tx, ctx, {
      id: decisionRecordId as DecisionRecordResponse['id'],
      tenantId,
      decisionKey: req.decisionKey,
      ruleSetVersionId: activeVersion.id,
      subjectType: req.subject.type,
      subjectId: req.subject.id,
      evaluationTime: req.evaluationTime,
      idempotencyKey: req.idempotencyKey,
      inputHash,
      inputSnapshot: (req.facts as Record<string, unknown>) ?? {},
      outputs: evalResult.outputs,
      matchedRuleUids: evalResult.matchedRuleUids,
      missingFields: evalResult.missingFields,
      status: evalResult.status,
      fallbackApplied: evalResult.fallbackApplied,
      fallbackPolicy: evalResult.fallbackPolicy,
      errorCode: evalResult.errorCode,
      durationUs: evalResult.durationUs,
      correlationId: ctx.correlationId,
      createdAt: new Date().toISOString(),
    });

    return {
      decisionRecordId,
      status: evalResult.status,
      outputs: (evalResult.outputs as Outputs[K]) ?? null,
      fallbackApplied: evalResult.fallbackApplied,
      fallbackPolicy: evalResult.fallbackPolicy,
      errorCode: evalResult.errorCode,
      missingFields: evalResult.missingFields,
      matchedRuleUids: evalResult.matchedRuleUids,
      ruleSetVersionId: activeVersion.id,
      inputHash,
      replayed: false,
    };
  }
}
