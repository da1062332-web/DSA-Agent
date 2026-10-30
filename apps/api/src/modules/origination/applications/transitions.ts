// MOD-APP transitions (owner: Dev 3; DSA Notion MODULE 16, API-APP-005). Built here: T-APP-01 (draft to documents pending,
// selecting a product version), T-APP-02 (documents pending to under review), T-APP-03 (send back for rework), T-APP-04
// (ready for submission), T-APP-05 (send back to review), T-APP-07 (close), T-APP-08 (withdraw), T-APP-09 (reopen) and
// T-APP-10 (cancel with a reason). T-APP-06 is not a manual step: SUBMITTED is set by the lender-case roll-up (ROLLUP-1).
// The T-APP table in the spec was not available, so the from/to states and permissions below are owner decisions
// (docs/PENDING_APPROVALS.md §2):
//   T-APP-01  DRAFT -> DOCUMENTS_PENDING   needs application.update; the product version must be active and in force
//   T-APP-02  DOCUMENTS_PENDING -> UNDER_REVIEW   needs application.review; clears the rework reason
//   T-APP-03  UNDER_REVIEW -> DOCUMENTS_PENDING   needs application.review; a reason is required and kept as the rework
//             reason until the file goes back to review
//   T-APP-04  UNDER_REVIEW -> READY_FOR_SUBMISSION   needs application.review; every mandatory checklist item must be
//             ACCEPTED, WAIVED or NOT_APPLICABLE, else 422 COMPLETENESS_FAILED
//   T-APP-05  READY_FOR_SUBMISSION -> UNDER_REVIEW   needs application.review; a reason is required
//   T-APP-07  DISBURSED, REJECTED, WITHDRAWN or CANCELLED -> CLOSED   needs application.close ("close a disbursed or
//             terminal application"); a reason is optional. A closed file cannot be reopened.
//   T-APP-08  DOCUMENTS_PENDING, UNDER_REVIEW or READY_FOR_SUBMISSION -> WITHDRAWN   needs application.withdraw; a reason
//             is required. A lender has the application only once the lender-case roll-up has moved it to SUBMITTED, so
//             no lender case is active here. A draft is cancelled (T-APP-10), not withdrawn.
//   T-APP-09  CANCELLED or WITHDRAWN -> DRAFT   needs application.reopen; a reason is required; the cancel reason is cleared
//   T-APP-10  DRAFT, DOCUMENTS_PENDING or UNDER_REVIEW -> CANCELLED   needs application.cancel; a reason is required
// Every transition writes the status history, an outbox event and an audit event in the same transaction, and uses
// If-Match and Idempotency-Key.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { generateChecklist, isComplete } from './application-port';
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
  'T-APP-03': { permission: 'application.review', from: ['UNDER_REVIEW'], to: 'DOCUMENTS_PENDING' },
  // Spec MVP: ready for submission once the checklist is complete (SUB-APP.05).
  'T-APP-04': { permission: 'application.review', from: ['UNDER_REVIEW'], to: 'READY_FOR_SUBMISSION' },
  'T-APP-05': { permission: 'application.review', from: ['READY_FOR_SUBMISSION'], to: 'UNDER_REVIEW' },
  'T-APP-07': {
    permission: 'application.close',
    from: ['DISBURSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'],
    to: 'CLOSED',
  },
  // SUB-APP.06 (assumed codes): withdraw before any lender has it; reopen a cancelled or withdrawn application as a draft.
  'T-APP-08': {
    permission: 'application.withdraw',
    from: ['DOCUMENTS_PENDING', 'UNDER_REVIEW', 'READY_FOR_SUBMISSION'],
    to: 'WITHDRAWN',
  },
  'T-APP-09': { permission: 'application.reopen', from: ['CANCELLED', 'WITHDRAWN'], to: 'DRAFT' },
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
            // SUB-DOC.02: the checklist is generated as the application starts collecting documents.
            const checklist = await generateChecklist(tx, ctx, deps, {
              ...current,
              product_version_id: changes.product_version_id,
            });
            changes.last_checklist_decision_ids = checklist.decisionIds;
          }
          if (input.transitionCode === 'T-APP-10') changes.cancel_reason = input.cancelReason;
          if (input.transitionCode === 'T-APP-09') changes.cancel_reason = null;
          if (input.transitionCode === 'T-APP-03') changes.rework_reason = input.reason;
          if (input.transitionCode === 'T-APP-02') changes.rework_reason = null;
          if (input.transitionCode === 'T-APP-04') {
            const items = await sql<{ mandatory: boolean; status: string }>`
              select mandatory, status from checklist_item where application_id = ${current.id}`.execute(tx);
            if (
              !isComplete(
                items.rows.map((i) => ({ mandatory: Boolean(i.mandatory), status: i.status as never })),
              )
            ) {
              throw AppError.of('COMPLETENESS_FAILED', 'Mandatory documents are still outstanding.', [
                { issue: 'DOCUMENTS_OUTSTANDING' },
              ]);
            }
            changes.last_completeness_result = 'COMPLETE';
          }

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
  const reason =
    input.transitionCode === 'T-APP-10'
      ? input.cancelReason
      : 'reason' in input
        ? (input.reason ?? null)
        : null;

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
