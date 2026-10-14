// MOD-APP transitions (owner: Dev 3; DSA Notion MODULE 16, API-APP-005). Built here: T-APP-01 (draft to documents pending,
// selecting a product version), T-APP-02 (documents pending to under review) and T-APP-10 (cancel with a reason).
// The T-APP table in the spec was not available, so the from/to states and permissions below are the agreed assumptions:
//   T-APP-01  DRAFT -> DOCUMENTS_PENDING   needs application.update; the product version must be active and in force
//   T-APP-02  DOCUMENTS_PENDING -> UNDER_REVIEW   needs application.review
//   T-APP-10  DRAFT, DOCUMENTS_PENDING or UNDER_REVIEW -> CANCELLED   needs application.cancel; a reason is required
// Every transition writes the status history, an outbox event and an audit event in the same transaction, and uses
// If-Match and Idempotency-Key.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { loadScopedForUpdate, toApplication } from './applications';
import { assertVersion, updateVersioned, type Row } from './db';
import { ApplicationTransition, type ApplicationStatus } from './schemas';

interface Rule {
  permission: PermissionCode;
  from: ApplicationStatus[];
  to: ApplicationStatus;
}

export const TRANSITION_RULES: Record<ApplicationTransition['transitionCode'], Rule> = {
  'T-APP-01': { permission: 'application.update', from: ['DRAFT'], to: 'DOCUMENTS_PENDING' },
  'T-APP-02': { permission: 'application.review', from: ['DOCUMENTS_PENDING'], to: 'UNDER_REVIEW' },
  'T-APP-10': {
    permission: 'application.cancel',
    from: ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'],
    to: 'CANCELLED',
  },
};

export function registerTransitionRoutes(router: Router, deps: ApiDeps): void {
  router.post('/applications/:id/transitions', async (req, res) => {
    const ctx = requireCtx(req);
    const version = ifMatchVersion(req);
    const key = idempotencyKey(req);
    const input = ApplicationTransition.parse(req.body);
    const rule = TRANSITION_RULES[input.transitionCode];
    deps.authz.requirePermission(ctx, rule.permission);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${req.params.id}/transitions`, body: input },
        async () => {
          const current = await loadScopedForUpdate(tx, ctx, rule.permission, req.params.id);
          assertVersion(current, version);
          if (!rule.from.includes(current.status as ApplicationStatus)) {
            throw AppError.of(
              'INVALID_TRANSITION',
              `${input.transitionCode} cannot run when the application is ${current.status}.`,
            );
          }

          const changes: Record<string, unknown> = { status: rule.to };
          if (input.transitionCode === 'T-APP-01') {
            changes.product_version_id = await checkProductVersion(
              deps,
              tx,
              ctx,
              current,
              input.productVersionId,
            );
          }
          if (input.transitionCode === 'T-APP-10') changes.cancel_reason = input.cancelReason;

          const row = await updateVersioned(
            tx,
            ctx.principal.id,
            'loan_application',
            current,
            version,
            changes,
          );
          await writeTransition(deps, tx, ctx, current, row, input);
          return { status: 200, body: toApplication(row), resourceRef: String(row.id) };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });
}

/** Refuses a product version that is unknown, for another category, retired, inactive or not in force today. */
async function checkProductVersion(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  application: Row,
  versionId: string,
): Promise<string> {
  if (!deps.productVersionPort) {
    throw AppError.of(
      'DEPENDENCY_UNAVAILABLE',
      'The product catalogue is not available to check the product version.',
    );
  }
  const pv = await deps.productVersionPort.getVersion(tx, versionId, ctx.now);
  if (!pv) {
    throw AppError.of('VALIDATION_ERROR', 'The product version was not found.', [
      { field: 'productVersionId', issue: 'NOT_FOUND' },
    ]);
  }
  if (pv.category !== application.product_category) {
    throw AppError.of('VALIDATION_ERROR', 'The product version is for a different product category.', [
      { field: 'productVersionId', issue: 'CATEGORY_MISMATCH' },
    ]);
  }
  if (pv.productStatus !== 'ACTIVE' || pv.versionStatus !== 'ACTIVE' || !pv.inForce) {
    throw AppError.of('INVALID_STATE', 'The product version is not active and in force today.');
  }
  return pv.id;
}

/** The history row, the outbox event and the audit event, all in the transition's transaction. */
async function writeTransition(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  before: Row,
  after: Row,
  input: ApplicationTransition,
): Promise<void> {
  const tenantId = ctx.principal.tenantId;
  const applicationId = String(after.id);
  const reason = input.transitionCode === 'T-APP-10' ? input.cancelReason : null;

  await sql`
    insert into application_status_history (id, tenant_id, application_id, from_status, to_status,
                                            transition_code, reason_code, actor, occurred_at)
    values (${deps.ids.next('ash')}, ${tenantId}, ${applicationId}, ${before.status}, ${after.status},
            ${input.transitionCode}, ${reason}, ${ctx.principal.id}, ${ctx.now})`.execute(tx);

  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${tenantId}, 'application.state_changed', 1, 'LOAN_APPLICATION', ${applicationId},
            ${JSON.stringify({ applicationId, from: before.status, to: after.status, transitionCode: input.transitionCode })}::jsonb,
            ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);

  await deps.audit.record(tx, ctx, {
    action: 'application.state_changed',
    entityType: 'LOAN_APPLICATION',
    entityId: applicationId,
    before: { status: before.status },
    after: { status: after.status },
    reason: reason ?? undefined,
    permissionUsed: TRANSITION_RULES[input.transitionCode].permission,
  });
}
