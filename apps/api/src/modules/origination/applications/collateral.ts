// Property collateral on a loan application (owner: Bhushan, task P1-03 of the multi-lender plan; migration 0111).
//   GET    /v1/applications/{id}/collateral                  application.read; live items only
//   POST   /v1/applications/{id}/collateral                  application.update; Idempotency-Key
//   PATCH  /v1/applications/{id}/collateral/{collateralId}   application.update; If-Match (the item's lock_version)
//   DELETE /v1/applications/{id}/collateral/{collateralId}   application.update; If-Match; soft delete (removed_at, removed_by)
// The application is found inside the caller's scope (applicationScope), so another tenant's, an unknown or an out-of-scope
// application is 404, and so is a collateral id that is not on it. Writes are allowed while the file is Draft, Documents pending or
// Under review (as for parties), never once it is with a lender. The value is stored in whole paise (bigint) and served as
// { amount, currency }. Audit and outbox are written in the same transaction; audit rows name the fields that changed, never the
// address or the value. Collateral writes do not bump the application's version: each item carries its own lock_version.
import {
  AppError,
  CollateralCreate,
  CollateralUpdate,
  MAX_COLLATERAL_PER_APPLICATION,
  moneyToPaise,
  paiseToMoney,
  type CollateralView,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Response, Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { applicationScope, loadScopedForUpdate } from './applications';
import { iso, type Row } from './db';
import type { ApplicationStatus } from './schemas';

/** Collateral changes only before the application is with a lender (the same states as parties). */
export const COLLATERAL_EDITABLE_STATUSES: readonly ApplicationStatus[] = [
  'DRAFT',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
];

const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // node-postgres reads a date column as local midnight; format it back without moving the day.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

export function toCollateral(r: Row): CollateralView {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    propertyType: r.property_type as CollateralView['propertyType'],
    addressLine1: String(r.address_line1),
    city: String(r.city),
    state: String(r.state),
    pincode: String(r.pincode),
    estimatedMarketValue: paiseToMoney(Number(r.estimated_market_value_paise)),
    ownershipType: r.ownership_type as CollateralView['ownershipType'],
    occupancyType: (r.occupancy_type as CollateralView['occupancyType']) ?? null,
    appraisalDate: dateOnly(r.appraisal_date),
    lockVersion: Number(r.lock_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function sendWithEtag(res: Response, status: number, body: CollateralView, replayed = false): void {
  res.set('ETag', `"${body.lockVersion}"`);
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(status).json(body);
}

function assertEditable(app: Row): void {
  if (!COLLATERAL_EDITABLE_STATUSES.includes(app.status as ApplicationStatus)) {
    throw AppError.of(
      'INVALID_STATE',
      `Collateral cannot change when the application is ${String(app.status)}.`,
    );
  }
}

/** An appraisal is a past event: a date after today (UTC, from ctx.now) is refused. */
function assertAppraisalNotFuture(ctx: RequestContext, date: string | null | undefined): void {
  if (date && date > ctx.now.toISOString().slice(0, 10)) {
    throw AppError.of('VALIDATION_ERROR', 'The appraisal date cannot be in the future.', [
      { field: 'appraisalDate', issue: 'IN_FUTURE' },
    ]);
  }
}

async function loadCollateralForUpdate(tx: Tx, applicationId: string, collateralId: string): Promise<Row> {
  const r = await sql<Row>`
    select * from application_collateral
     where application_id = ${applicationId} and id = ${collateralId} and removed_at is null
     for update`.execute(tx);
  const row = r.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'Collateral not found.');
  return row;
}

function assertItemVersion(row: Row, expected: number): void {
  if (Number(row.lock_version) !== expected) {
    throw AppError.of('VERSION_CONFLICT', 'The record was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: Number(row.lock_version) } },
    ]);
  }
}

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  eventType: string,
  applicationId: string,
  collateralId: string,
): Promise<void> {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${eventType}, 1, 'LOAN_APPLICATION', ${applicationId},
            ${JSON.stringify({ applicationId, collateralId })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(
    tx,
  );
}

export function registerCollateralRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications/:id/collateral', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await sql<Row>`
        select id from loan_application
         where id = ${req.params.id} and ${applicationScope(ctx, 'application.read')}`.execute(tx);
      if (!app.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
      const r = await sql<Row>`
        select * from application_collateral
         where application_id = ${req.params.id} and removed_at is null
         order by created_at, id`.execute(tx);
      return r.rows.map(toCollateral);
    });
    res.json({ data, meta: { nextCursor: null, limit: MAX_COLLATERAL_PER_APPLICATION } });
  });

  router.post('/applications/:id/collateral', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const key = idempotencyKey(req);
    const input = CollateralCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${req.params.id}/collateral`, body: input },
        async () => {
          const app = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
          assertEditable(app);
          assertAppraisalNotFuture(ctx, input.appraisalDate);
          const live = await sql<{ n: number }>`
            select count(*)::int as n from application_collateral
             where application_id = ${String(app.id)} and removed_at is null`.execute(tx);
          if ((live.rows[0]?.n ?? 0) >= MAX_COLLATERAL_PER_APPLICATION) {
            throw AppError.of(
              'VALIDATION_ERROR',
              `An application can hold at most ${MAX_COLLATERAL_PER_APPLICATION} collateral items.`,
              [{ field: 'propertyType', issue: 'LIMIT_REACHED' }],
            );
          }
          const id = deps.ids.next('acol');
          const r = await sql<Row>`
            insert into application_collateral (id, tenant_id, application_id, property_type, address_line1, city, state, pincode,
                                                estimated_market_value_paise, ownership_type, occupancy_type, appraisal_date,
                                                created_at, created_by, updated_at, updated_by)
            values (${id}, ${ctx.principal.tenantId}, ${String(app.id)}, ${input.propertyType}, ${input.addressLine1},
                    ${input.city}, ${input.state}, ${input.pincode}, ${moneyToPaise(input.estimatedMarketValue)},
                    ${input.ownershipType}, ${input.occupancyType ?? null}, ${input.appraisalDate ?? null},
                    ${ctx.now}, ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id})
            returning *`.execute(tx);
          await emit(deps, tx, ctx, 'application.collateral_added', String(app.id), id);
          await deps.audit.record(tx, ctx, {
            action: 'application.collateral_added',
            entityType: 'LOAN_APPLICATION',
            entityId: String(app.id),
            after: { collateralId: id, propertyType: input.propertyType },
            permissionUsed: 'application.update',
          });
          return { status: 201, body: toCollateral(r.rows[0]!), resourceRef: id };
        },
      ),
    );
    res.location(`/v1/applications/${req.params.id}/collateral/${result.body.id}`);
    sendWithEtag(res, result.status, result.body as CollateralView, result.replayed);
  });

  router.patch('/applications/:id/collateral/:collateralId', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const expected = ifMatchVersion(req);
    const input = CollateralUpdate.parse(req.body);

    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
      const cur = await loadCollateralForUpdate(tx, String(app.id), req.params.collateralId);
      assertItemVersion(cur, expected);
      assertEditable(app);
      assertAppraisalNotFuture(ctx, input.appraisalDate);
      const v = <T>(key: keyof typeof input, column: string): T | null =>
        (input[key] !== undefined ? input[key] : cur[column]) as T | null;
      const paise =
        input.estimatedMarketValue !== undefined
          ? moneyToPaise(input.estimatedMarketValue)
          : Number(cur.estimated_market_value_paise);
      const r = await sql<Row>`
        update application_collateral
           set property_type = ${v<string>('propertyType', 'property_type')},
               address_line1 = ${v<string>('addressLine1', 'address_line1')},
               city = ${v<string>('city', 'city')}, state = ${v<string>('state', 'state')},
               pincode = ${v<string>('pincode', 'pincode')},
               estimated_market_value_paise = ${paise},
               ownership_type = ${v<string>('ownershipType', 'ownership_type')},
               occupancy_type = ${v<string>('occupancyType', 'occupancy_type')},
               appraisal_date = ${input.appraisalDate !== undefined ? input.appraisalDate : dateOnly(cur.appraisal_date)},
               lock_version = lock_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
         where id = ${String(cur.id)}
         returning *`.execute(tx);
      await emit(deps, tx, ctx, 'application.collateral_updated', String(app.id), String(cur.id));
      await deps.audit.record(tx, ctx, {
        action: 'application.collateral_updated',
        entityType: 'LOAN_APPLICATION',
        entityId: String(app.id),
        after: { collateralId: String(cur.id), fields: Object.keys(input) },
        permissionUsed: 'application.update',
      });
      return toCollateral(r.rows[0]!);
    });
    sendWithEtag(res, 200, body);
  });

  router.delete('/applications/:id/collateral/:collateralId', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const expected = ifMatchVersion(req);

    await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
      const cur = await loadCollateralForUpdate(tx, String(app.id), req.params.collateralId);
      assertItemVersion(cur, expected);
      assertEditable(app);
      await sql`
        update application_collateral
           set removed_at = ${ctx.now}, removed_by = ${ctx.principal.id}, lock_version = lock_version + 1,
               updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
         where id = ${String(cur.id)}`.execute(tx);
      await emit(deps, tx, ctx, 'application.collateral_removed', String(app.id), String(cur.id));
      await deps.audit.record(tx, ctx, {
        action: 'application.collateral_removed',
        entityType: 'LOAN_APPLICATION',
        entityId: String(app.id),
        after: { collateralId: String(cur.id) },
        permissionUsed: 'application.update',
      });
    });
    res.status(204).end();
  });
}
