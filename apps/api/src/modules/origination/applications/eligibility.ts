// MOD-ELG Eligibility (owner: Dev 3; DSA Notion MODULE 17). APIs: API-ELG-001 run, 002 history, 003 override.
// An assessment never promises approval. Every criterion is UNKNOWN until a rule set is published for it: the spec
// says a criterion with no data or rule is UNKNOWN, and no eligibility rule set exists yet (Business Rule Engine, TASK-416).
// `evaluateCriteria` is the one place to connect that rule set; nothing else in this file changes when it is ready.
// Run and history need application.read; an override needs eligibility.override. Scope follows the application.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { applicationScope } from './applications';
import { iso, keysetPage, type Row } from './db';
import {
  EligibilityListQuery,
  OverrideRequest,
  type Criterion,
  type EligibilityAssessment,
  type ProductResult,
} from './eligibility-schemas';

export const NO_RULE_SET = 'NO_RULE_SET_PUBLISHED';

/** The criteria for one product version. No eligibility rule set is published yet, so the single criterion is UNKNOWN. */
export function evaluateCriteria(_application: Row, _productVersionId: string): Criterion[] {
  return [
    {
      code: 'ELIGIBILITY_RULES',
      result: 'UNKNOWN',
      reason: `${NO_RULE_SET}: no eligibility rule set is available, so this cannot be assessed yet.`,
    },
  ];
}

/** PASS only if every criterion passes, FAIL if any fails, otherwise UNKNOWN. */
export function rollUp(criteria: Criterion[]): ProductResult['result'] {
  if (criteria.some((c) => c.result === 'FAIL')) return 'FAIL';
  if (criteria.length > 0 && criteria.every((c) => c.result === 'PASS')) return 'PASS';
  return 'UNKNOWN';
}

export const toAssessment = (r: Row): EligibilityAssessment => ({
  id: String(r.id),
  applicationId: String(r.application_id),
  assessedAt: iso(r.assessed_at),
  results: r.results as EligibilityAssessment['results'],
  decisionRecordIds: (r.decision_record_ids as string[]) ?? [],
  overrides: r.overrides as EligibilityAssessment['overrides'],
  createdBy: String(r.created_by),
  version: Number(r.lock_version),
});

async function loadApplication(tx: Tx, ctx: RequestContext, code: PermissionCode, id: string): Promise<Row> {
  const r = await sql<Row>`
    select * from loan_application where id = ${id} and ${applicationScope(ctx, code)}`.execute(tx);
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
  return r.rows[0];
}

export function registerEligibilityRoutes(router: Router, deps: ApiDeps): void {
  router.post('/applications/:id/eligibility-assessments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const key = idempotencyKey(req);
    const applicationId = req.params.id;

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${applicationId}/eligibility-assessments`, body: {} },
        async () => {
          const app = await loadApplication(tx, ctx, 'application.read', applicationId);
          const versionId = (app.product_version_id as string | null) ?? null;
          if (!versionId) {
            throw AppError.of(
              'INVALID_STATE',
              'Choose a product for the application before assessing eligibility.',
            );
          }
          const criteria = evaluateCriteria(app, versionId);
          const results: ProductResult[] = [{ productVersionId: versionId, result: rollUp(criteria), criteria }];
          const id = deps.ids.next('elg');
          const inserted = await sql<Row>`
            insert into eligibility_assessment (id, tenant_id, application_id, assessed_at, results, created_by, updated_by)
            values (${id}, ${ctx.principal.tenantId}, ${applicationId}, ${ctx.now}, ${JSON.stringify(results)}::jsonb,
                    ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'eligibility.assessed',
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            after: { assessmentId: id, results: results.map((p) => ({ v: p.productVersionId, r: p.result })) },
            permissionUsed: 'application.read',
          });
          return { status: 201, body: toAssessment(inserted.rows[0]!), resourceRef: id };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.get('/applications/:id/eligibility-assessments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const q = EligibilityListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await loadApplication(tx, ctx, 'application.read', req.params.id);
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
          const found = await sql<Row>`
            select * from eligibility_assessment where id = ${req.params.id} for update`.execute(tx);
          const current = found.rows[0];
          if (!current) throw AppError.of('NOT_FOUND', 'Eligibility assessment not found.');
          // The override scope is the application's, under the override permission.
          await loadApplication(tx, ctx, 'eligibility.override', String(current.application_id));

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
          const entry = {
            productVersionId: input.productVersionId,
            reason: input.reason,
            overriddenBy: ctx.principal.id,
            overriddenAt: ctx.now.toISOString(),
          };
          const updated = await sql<Row>`
            update eligibility_assessment
               set overrides = overrides || ${JSON.stringify([entry])}::jsonb, updated_by = ${ctx.principal.id}
             where id = ${req.params.id}
             returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'eligibility.overridden',
            entityType: 'LOAN_APPLICATION',
            entityId: String(current.application_id),
            after: { assessmentId: req.params.id, productVersionId: input.productVersionId },
            reason: input.reason,
            permissionUsed: 'eligibility.override',
          });
          return { status: 201, body: toAssessment(updated.rows[0]!), resourceRef: req.params.id };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });
}
