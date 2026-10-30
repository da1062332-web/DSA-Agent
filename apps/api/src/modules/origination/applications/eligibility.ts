// MOD-ELG Eligibility (owner: Dev 3; DSA Notion MODULE 17). APIs: API-ELG-001 run (evaluates the approved rule set through the
// decision engine), 002 history, 003 override, 004 latest assessment. Applicant figures are in eligibility-inputs.ts.
// Running an assessment needs application.update (it writes a record that feeds a credit decision); reading needs
// application.read; an override needs eligibility.override. Scope follows the application.
// An assessment never promises approval: a PASS is a preliminary result against the approved rules.
import { AppError, type DecisionRequest, type Tx } from '@dsa/contracts';
import { computeContentHash } from '@dsa/bre-core';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, keysetPage, type Row } from './db';
import {
  assessProduct,
  buildFacts,
  ELIGIBILITY_DECISION_KEY,
  isDuplicateOverride,
  isTerminal,
  pendingFor,
  type EngineView,
  type PriorOverride,
} from './eligibility-rules';
import {
  EligibilityListQuery,
  OverrideRequest,
  type EligibilityAssessment,
  type EligibilityOverride,
  type ProductResult,
} from './eligibility-schemas';
import {
  creditEntryEnabled,
  loadScopedApplication,
  readApplicantInputs,
  registerApplicantInputRoutes,
  verifiedIncomeEvidence,
} from './eligibility-inputs';

/** An override as stored. The input fingerprint is kept for the duplicate check and is never returned. */
type StoredOverride = EligibilityOverride & { inputHash: string | null };

const returnedOverride = (o: StoredOverride): EligibilityOverride => ({
  productVersionId: o.productVersionId,
  reason: o.reason,
  overriddenBy: o.overriddenBy,
  overriddenAt: o.overriddenAt,
  assessmentId: o.assessmentId,
});

export const toAssessment = (r: Row): EligibilityAssessment => ({
  id: String(r.id),
  applicationId: String(r.application_id),
  assessedAt: iso(r.assessed_at),
  results: r.results as EligibilityAssessment['results'],
  decisionRecordIds: (r.decision_record_ids as string[]) ?? [],
  overrides: (r.overrides as StoredOverride[]).map(returnedOverride),
  createdBy: String(r.created_by),
  version: Number(r.lock_version),
  productVersionId: (r.product_version_id as string | null) ?? null,
  ruleSetVersionId: (r.rule_set_version_id as string | null) ?? null,
  ruleSetVersionNo:
    r.rule_set_version_no === null || r.rule_set_version_no === undefined
      ? null
      : Number(r.rule_set_version_no),
  decisionStatus: (r.decision_status as string | null) ?? null,
  matchedRuleUids: (r.matched_rule_uids as string[]) ?? [],
  missingData: (r.missing_data as string[]) ?? [],
});

/** The product version the application is on, with the lender that owns it (the rule set scope). */
async function loadProductVersion(tx: Tx, tenantId: string, versionId: string): Promise<Row | null> {
  const r = await sql<Row>`
    select pv.id, pv.amount_min, pv.amount_max, pv.currency, p.lender_id
      from loan_product_version pv
      join loan_product p on p.id = pv.product_id and p.tenant_id = pv.tenant_id
     where pv.id = ${versionId} and pv.tenant_id = ${tenantId}`.execute(tx);
  return r.rows[0] ?? null;
}

/**
 * The rule set version the engine used must still match its stored content hash, or nothing is assessed (fail closed). The
 * hash is the canonical hash of the definition (bre-core computeContentHash), so an edited definition cannot pass silently.
 */
async function verifiedRuleSetVersionNo(tx: Tx, versionId: string): Promise<number> {
  const r = await sql<Row>`
    select version_no, content_hash, definition, status from rule_set_version where id = ${versionId}`.execute(
    tx,
  );
  const row = r.rows[0];
  if (!row || row.status !== 'ACTIVE' || computeContentHash(row.definition) !== row.content_hash) {
    throw AppError.of(
      'CONTENT_HASH_MISMATCH',
      'The approved eligibility rule set did not pass its integrity check, so nothing was assessed.',
    );
  }
  return Number(row.version_no);
}

export function registerEligibilityRoutes(router: Router, deps: ApiDeps): void {
  registerApplicantInputRoutes(router, deps);

  router.post('/applications/:id/eligibility-assessments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const key = idempotencyKey(req);
    const applicationId = req.params.id;
    const tenantId = ctx.principal.tenantId;

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${applicationId}/eligibility-assessments`, body: {} },
        async () => {
          if (!deps.decisionPort) {
            throw AppError.of(
              'DEPENDENCY_UNAVAILABLE',
              'The rules engine is not available, so nothing was assessed.',
            );
          }
          // Locked for the whole assessment, so an override or a second run on the same application waits for it.
          const app = await loadScopedApplication(tx, ctx, 'application.update', applicationId, {
            lock: true,
          });
          if (isTerminal(String(app.status))) {
            throw AppError.of(
              'INVALID_STATE',
              `Eligibility cannot be checked when the application is ${app.status}.`,
            );
          }
          const versionId = (app.product_version_id as string | null) ?? null;
          if (!versionId) {
            throw AppError.of(
              'INVALID_STATE',
              'Choose a product for the application before assessing eligibility.',
            );
          }
          const product = await loadProductVersion(tx, tenantId, versionId);
          if (!product) throw AppError.of('INVALID_STATE', 'The product version is not available.');

          const inputs = await readApplicantInputs(tx, applicationId);
          const credit =
            inputs && inputs.credit_score !== null && inputs.credit_score !== undefined
              ? { score: Number(inputs.credit_score), reportDate: String(inputs.credit_report_date) }
              : null;
          const evidence = await verifiedIncomeEvidence(tx, tenantId, applicationId, inputs);
          // Manual credit data counts only while the tenant has switched manual credit entry on, even if it was recorded before.
          const creditEnabled = await creditEntryEnabled(tx, tenantId);
          const pending = pendingFor({
            credit,
            creditEnabled,
            verifiedIncome: evidence
              ? { checklistStatus: evidence.checklistStatus, primary: evidence.primary }
              : null,
            asOf: ctx.now,
          });
          // Only usable figures reach the rules. A stale report, an unaccepted or non-primary document is left out, so it cannot match a rule.
          const usableCredit =
            creditEnabled && credit && !pending.some((p) => p.code === 'CREDIT_DATA_STALE') ? credit : null;
          const usableIncome =
            evidence && evidence.primary && evidence.checklistStatus === 'ACCEPTED' ? evidence : null;

          const facts = buildFacts({
            employmentType: String(app.applicant_type),
            requested: { amount: String(app.requested_amount), currency: String(app.currency) },
            tenureMonths:
              app.tenure_months === null || app.tenure_months === undefined
                ? null
                : Number(app.tenure_months),
            purposeCode: (app.purpose_code as string | null) ?? null,
            product: {
              min: { amount: String(product.amount_min), currency: String(product.currency) },
              max: { amount: String(product.amount_max), currency: String(product.currency) },
            },
            credit: usableCredit ? { score: usableCredit.score } : null,
            verifiedIncome: usableIncome ? { amount: usableIncome.amount, currency: 'INR' } : null,
          });

          const decision = await deps.decisionPort
            .decide(tx, ctx, {
              decisionKey: ELIGIBILITY_DECISION_KEY,
              scope: {
                productVersionId: versionId,
                lenderId: String(product.lender_id),
                branchId: String(app.branch_id),
              },
              subject: { type: 'LOAN_APPLICATION', id: applicationId },
              facts: facts as unknown as DecisionRequest<typeof ELIGIBILITY_DECISION_KEY>['facts'],
              evaluationTime: ctx.now.toISOString(),
              idempotencyKey: `elg:${applicationId}:${key}`,
            })
            .catch((err: unknown) => {
              // Without the decision definition (migration 0054) this environment cannot assess at all: say so, rather than "not found".
              if (err instanceof AppError && err.code === 'DECISION_KEY_UNKNOWN') {
                throw AppError.of(
                  'DEPENDENCY_UNAVAILABLE',
                  'The eligibility decision is not set up in this environment, so nothing was assessed.',
                );
              }
              throw err;
            });

          const ruleSetVersionNo = decision.ruleSetVersionId
            ? await verifiedRuleSetVersionNo(tx, decision.ruleSetVersionId)
            : null;
          const engine: EngineView = {
            status: decision.status,
            errorCode: decision.errorCode,
            outputs: decision.outputs
              ? {
                  result: decision.outputs.result,
                  maxEligibleAmount: decision.outputs.maxEligibleAmount ?? null,
                  reasons: decision.outputs.reasons,
                }
              : null,
            fallbackApplied: decision.fallbackApplied,
            matchedRuleUids: decision.matchedRuleUids,
            missingFields: decision.missingFields,
          };
          const assessed = assessProduct(engine, pending);
          const productResult: ProductResult = {
            productVersionId: versionId,
            result: assessed.result,
            decisionResult: assessed.decisionResult,
            criteria: assessed.criteria,
            missingData: assessed.missingData,
            indicativeMaxAmount: assessed.indicativeMaxAmount,
          };

          const id = deps.ids.next('elg');
          // clock_timestamp() is read here, after the application lock is held, so "latest" follows the order in which
          // assessments were recorded, whatever the clocks of the application servers say.
          const inserted = await sql<Row>`
            insert into eligibility_assessment (id, tenant_id, application_id, assessed_at, results, decision_record_ids,
                product_version_id, rule_set_version_id, rule_set_version_no, decision_status, input_hash,
                matched_rule_uids, missing_data, created_by, updated_by)
            values (${id}, ${tenantId}, ${applicationId}, clock_timestamp(), ${JSON.stringify([productResult])}::jsonb,
                    ${[decision.decisionRecordId]}, ${versionId}, ${decision.ruleSetVersionId}, ${ruleSetVersionNo},
                    ${decision.status}, ${decision.inputHash}, ${decision.matchedRuleUids}, ${assessed.missingData},
                    ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'eligibility.assessed',
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            after: {
              assessmentId: id,
              productVersionId: versionId,
              result: assessed.result,
              decisionResult: assessed.decisionResult,
              ruleSetVersionId: decision.ruleSetVersionId,
              missingData: assessed.missingData,
            },
            permissionUsed: 'application.update',
          });
          return { status: 201, body: toAssessment(inserted.rows[0]!), resourceRef: id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  router.get('/applications/:id/eligibility-assessments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const q = EligibilityListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await loadScopedApplication(tx, ctx, 'application.read', req.params.id);
      return keysetPage(tx, {
        from: sql`eligibility_assessment`,
        sortColumn: 'id',
        where: [sql`application_id = ${req.params.id}`],
        limit: q.limit,
        cursor: q.cursor,
        map: toAssessment,
      });
    });
    res.json(page);
  });

  // API-ELG-004: the newest assessment, by time and then id. Works however many assessments the application has.
  router.get('/applications/:id/eligibility-assessments/latest', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await loadScopedApplication(tx, ctx, 'application.read', req.params.id);
      const r = await sql<Row>`
        select * from eligibility_assessment
         where application_id = ${req.params.id}
         order by assessed_at desc, id desc
         limit 1`.execute(tx);
      return r.rows[0] ?? null;
    });
    if (!row) throw AppError.of('NOT_FOUND', 'No eligibility assessment has been run for this application.');
    res.json(toAssessment(row));
  });

  router.post('/eligibility-assessments/:id/overrides', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'eligibility.override');
    const key = idempotencyKey(req);
    const input = OverrideRequest.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/eligibility-assessments/${req.params.id}/overrides`, body: input },
        async () => {
          // The application is locked first, then the assessment is read again under the lock, so two overrides on one
          // application run one after the other and the duplicate check sees the first.
          const peek =
            await sql<Row>`select application_id from eligibility_assessment where id = ${req.params.id}`.execute(
              tx,
            );
          const notFound = () => AppError.of('NOT_FOUND', 'Eligibility assessment not found.');
          if (!peek.rows[0]) throw notFound();
          const app = await loadScopedApplication(
            tx,
            ctx,
            'eligibility.override',
            String(peek.rows[0].application_id),
            {
              lock: true,
            },
          ).catch((err: unknown) => {
            // Only "not in your scope" is a 404. A database error must not look like a missing application.
            if (err instanceof AppError && err.code === 'NOT_FOUND') throw notFound();
            throw err;
          });
          const found =
            await sql<Row>`select * from eligibility_assessment where id = ${req.params.id} for update`.execute(
              tx,
            );
          const current = found.rows[0];
          if (!current) throw notFound();
          const applicationId = String(app.id);

          if (isTerminal(String(app.status))) {
            throw AppError.of(
              'INVALID_STATE',
              `Overrides are not accepted when the application is ${app.status}.`,
            );
          }
          const latest = await sql<Row>`
            select id from eligibility_assessment where application_id = ${applicationId}
             order by assessed_at desc, id desc limit 1`.execute(tx);
          if (latest.rows[0] && String(latest.rows[0].id) !== String(current.id)) {
            throw AppError.of(
              'INVALID_STATE',
              'Only the latest assessment can be overridden. Run a new assessment first.',
            );
          }

          const target = (current.results as ProductResult[]).find(
            (p) => p.productVersionId === input.productVersionId,
          );
          if (!target) {
            throw AppError.of('VALIDATION_ERROR', 'That product version is not part of this assessment.', [
              { field: 'productVersionId', issue: 'NOT_FOUND' },
            ]);
          }
          if (target.result !== 'FAIL') {
            throw AppError.of('INVALID_STATE', 'Only a failed result can be overridden.');
          }

          const prior = await sql<Row>`
            select id, overrides from eligibility_assessment where application_id = ${applicationId}`.execute(
            tx,
          );
          const priorOverrides: PriorOverride[] = prior.rows.flatMap((r) =>
            (r.overrides as StoredOverride[]).map((o) => ({
              productVersionId: o.productVersionId,
              inputHash: o.inputHash ?? null,
              assessmentId: o.assessmentId ?? String(r.id),
            })),
          );
          const inputHash = (current.input_hash as string | null) ?? null;
          if (
            isDuplicateOverride(priorOverrides, {
              productVersionId: input.productVersionId,
              inputHash,
              assessmentId: String(current.id),
            })
          ) {
            throw AppError.of('INVALID_STATE', 'This result has already been overridden for these inputs.');
          }

          const entry: StoredOverride = {
            productVersionId: input.productVersionId,
            reason: input.reason,
            overriddenBy: ctx.principal.id,
            overriddenAt: ctx.now.toISOString(),
            inputHash,
            assessmentId: String(current.id),
          };
          const updated = await sql<Row>`
            update eligibility_assessment
               set overrides = overrides || ${JSON.stringify([entry])}::jsonb, updated_by = ${ctx.principal.id}
             where id = ${current.id}
             returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'eligibility.overridden',
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            after: { assessmentId: String(current.id), productVersionId: input.productVersionId },
            reason: input.reason,
            permissionUsed: 'eligibility.override',
          });
          return { status: 201, body: toAssessment(updated.rows[0]!), resourceRef: String(current.id) };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });
}
