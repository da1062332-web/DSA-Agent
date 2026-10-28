// MOD-APP Loan Applications (owner: Dev 3; DSA Notion MODULE 16). APIs in this slice: API-APP-002 list, 003 read,
// 004 edit, 010 hold. Not in this slice: creation (MVP creates applications through lead conversion), transitions
// (the T-APP table is not in the spec we have), parties, ownership, completeness and waivers.
// Reads need application.read; edits and holds need application.update. Scope follows the spec: RM sees own,
// branch roles see their branch, org owner sees the tenant. Out of scope is 404, a missing permission is 403.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import type { Response, Router } from 'express';
import { sql, type RawBuilder } from 'kysely';
import { ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { assertVersion, iso, keysetPage, updateVersioned, type Row } from './db';
import type { Application } from './schemas';
import {
  ApplicationHold,
  ApplicationListQuery,
  ApplicationPatch,
  EDITABLE_STATUSES,
  TERMINAL_STATUSES,
} from './schemas';

export const toApplication = (r: Row): Application => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  leadId: (r.lead_id as string | null) ?? null,
  branchId: String(r.branch_id),
  productCategory: String(r.product_category),
  productVersionId: (r.product_version_id as string | null) ?? null,
  requestedAmount: String(r.requested_amount),
  currency: String(r.currency),
  tenureMonths: r.tenure_months === null || r.tenure_months === undefined ? null : Number(r.tenure_months),
  purposeCode: (r.purpose_code as Application['purposeCode']) ?? null,
  applicantType: r.applicant_type as Application['applicantType'],
  status: r.status as Application['status'],
  onHold: Boolean(r.on_hold),
  holdReason: (r.hold_reason as string | null) ?? null,
  holdUntil: r.hold_until ? iso(r.hold_until) : null,
  reworkReason: (r.rework_reason as string | null) ?? null,
  salesOwnerId: String(r.sales_owner_id),
  opsOwnerId: (r.ops_owner_id as string | null) ?? null,
  opsQueueId: (r.ops_queue_id as string | null) ?? null,
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/**
 * The record-scope predicate for applications, as SQL. It mirrors the kernel's scopeFilter rules: TENANT sees all,
 * BRANCH sees its branches, TEAM sees records owned by the caller or a managed member, OWN sees records the caller
 * owns; queue membership adds the queue's records for TEAM and OWN. A principal with no grant sees nothing.
 */
export function applicationScope(ctx: RequestContext, code: PermissionCode): RawBuilder<unknown> {
  const p = ctx.principal;
  const grants = p.grants.filter((g) => g.code === code);
  if (grants.some((g) => g.scope === 'TENANT')) return sql`true`;
  const mine = [p.id, ...p.managedTeamMemberIds];
  const queues = p.queueIds;
  const parts: RawBuilder<unknown>[] = [];
  for (const g of grants) {
    if (g.scope === 'BRANCH') {
      parts.push(sql`branch_id = any(${g.branchIds}::text[])`);
    } else if (g.scope === 'TEAM') {
      parts.push(sql`(sales_owner_id = any(${mine}::text[]) or ops_owner_id = any(${mine}::text[]))`);
      if (queues.length) parts.push(sql`ops_queue_id = any(${queues}::text[])`);
    } else if (g.scope === 'OWN') {
      parts.push(sql`(sales_owner_id = ${p.id} or ops_owner_id = ${p.id})`);
      if (queues.length) parts.push(sql`ops_queue_id = any(${queues}::text[])`);
    }
  }
  if (parts.length === 0) return sql`false`;
  return sql`(${sql.join(parts, sql` or `)})`;
}

/** Locks one application the caller may see. Out of scope or another tenant reads as NOT_FOUND. */
export async function loadScopedForUpdate(
  tx: Tx,
  ctx: RequestContext,
  code: PermissionCode,
  id: string,
): Promise<Row> {
  const r = await sql<Row>`
    select * from loan_application
     where id = ${id} and ${applicationScope(ctx, code)}
     for update`.execute(tx);
  const row = r.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'Application not found.');
  return row;
}

const snapshotDetails = (r: Row) => ({
  requestedAmount: String(r.requested_amount),
  tenureMonths: r.tenure_months === null || r.tenure_months === undefined ? null : Number(r.tenure_months),
  purposeCode: (r.purpose_code as string | null) ?? null,
  applicantType: r.applicant_type,
  status: r.status,
});

const snapshotHold = (r: Row) => ({
  onHold: Boolean(r.on_hold),
  holdReason: (r.hold_reason as string | null) ?? null,
  holdUntil: r.hold_until ? iso(r.hold_until) : null,
  status: r.status,
});

function sendApplication(res: Response, status: number, body: Application): void {
  sendResource(res, status, body);
}

export function registerApplicationRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const q = ApplicationListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`loan_application`,
        sortColumn: 'id',
        where: [
          applicationScope(ctx, 'application.read'),
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.onHold !== undefined ? [sql`on_hold = ${q.onHold}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toApplication,
      }),
    );
    res.json(page);
  });

  router.get('/applications/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        select * from loan_application
         where id = ${req.params.id} and ${applicationScope(ctx, 'application.read')}`.execute(tx);
      if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
      return r.rows[0];
    });
    sendApplication(res, 200, toApplication(row));
  });

  router.patch('/applications/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const version = ifMatchVersion(req);
    const input = ApplicationPatch.parse(req.body);

    const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
      assertVersion(current, version);
      if (!EDITABLE_STATUSES.includes(current.status as never)) {
        throw AppError.of(
          'INVALID_STATE',
          `The application is ${current.status} and can no longer be edited.`,
        );
      }
      const row = await updateVersioned(tx, ctx.principal.id, 'loan_application', current, version, {
        requested_amount: input.requestedAmount,
        tenure_months: input.tenureMonths,
        purpose_code: input.purposeCode,
        applicant_type: input.applicantType,
      });
      await deps.audit.record(tx, ctx, {
        action: 'application.updated',
        entityType: 'LOAN_APPLICATION',
        entityId: String(row.id),
        before: snapshotDetails(current),
        after: snapshotDetails(row),
        permissionUsed: 'application.update',
      });
      return row;
    });
    sendApplication(res, 200, toApplication(updated));
  });

  router.put('/applications/:id/hold', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const version = ifMatchVersion(req);
    const input = ApplicationHold.parse(req.body);

    const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
      assertVersion(current, version);
      if (TERMINAL_STATUSES.includes(current.status as never)) {
        throw AppError.of(
          'INVALID_STATE',
          `The application is ${current.status}; a hold cannot be set or cleared.`,
        );
      }
      if (!input.onHold && !current.on_hold) {
        throw AppError.of('INVALID_STATE', 'The application is not on hold.');
      }
      const row = await updateVersioned(tx, ctx.principal.id, 'loan_application', current, version, {
        on_hold: input.onHold,
        hold_reason: input.onHold ? input.reason : null,
        hold_until: input.onHold ? (input.until ?? null) : null,
      });
      await deps.audit.record(tx, ctx, {
        action: input.onHold ? 'application.hold_set' : 'application.hold_cleared',
        entityType: 'LOAN_APPLICATION',
        entityId: String(row.id),
        before: snapshotHold(current),
        after: snapshotHold(row),
        reason: input.onHold ? input.reason : undefined,
        permissionUsed: 'application.update',
      });
      return row;
    });
    sendApplication(res, 200, toApplication(updated));
  });
}
