// MOD-GRV Grievances (owner: Dev 3; DSA Notion MODULE 13). Every write is audited in the same transaction (Contracts §4.1).
//   API-GRV-001 POST /v1/complaints (Idem, complaint.create)
//   API-GRV-002 GET /v1/complaints (queue, complaint.manage)       GET /v1/complaints/{id} (complaint.manage)
//   API-GRV-003 PATCH /v1/complaints/{id} (If-Match, complaint.manage): assign, update, refer, start work
//   API-GRV-004 POST /v1/complaints/{id}/resolution (Idem, If-Match, complaint.manage): resolve or reopen
// Resolved complaints are closed for edits until reopened. Complaints are never deleted.
import { AppError, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, keysetPage, loadForUpdate, updateVersioned, type Row } from './db';
import { ComplaintCreate, ComplaintListQuery, ComplaintPatch, ComplaintResolution } from './schemas';

export const toComplaint = (r: Row) => ({
  id: String(r.id),
  complainantType: String(r.complainant_type),
  complainantId: String(r.complainant_id),
  channel: String(r.channel),
  category: String(r.category),
  description: String(r.description),
  status: String(r.status),
  ownerUserId: (r.owner_user_id as string | null) ?? null,
  dueAt: r.due_at ? iso(r.due_at) : null,
  ackRef: String(r.ack_ref),
  lenderReferral: (r.lender_referral as Record<string, unknown>) ?? {},
  resolution: (r.resolution as string | null) ?? null,
  resolvedAt: r.resolved_at ? iso(r.resolved_at) : null,
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** Fields an audit reader needs. The description is free text and is never copied into the audit trail. */
const snapshot = (r: Row) => ({
  category: r.category,
  status: r.status,
  ownerUserId: r.owner_user_id ?? null,
  dueAt: r.due_at ? iso(r.due_at) : null,
  lenderReferral: r.lender_referral ?? {},
});

/** The acknowledgement reference the customer quotes. The last eight characters of the ULID are random. */
const ackRef = (id: string) => `GRV-${id.slice(-8)}`;

/** A referral must name a lender in this tenant. The lender check comes from origination/catalogue through a port. */
async function requireKnownLender(deps: ApiDeps, tx: Tx, lenderId: string): Promise<void> {
  if (!deps.lenderPort) {
    throw AppError.of(
      'DEPENDENCY_UNAVAILABLE',
      'The lender check is not available, so the referral cannot be saved.',
    );
  }
  if (!(await deps.lenderPort.exists(tx, lenderId))) {
    throw AppError.of('VALIDATION_ERROR', 'The referred lender was not found.', [
      { field: 'lenderReferral.lenderId', issue: 'NOT_FOUND' },
    ]);
  }
}

async function requireActiveOwner(tx: Tx, userId: string): Promise<void> {
  const u = await sql<{
    id: string;
  }>`select id from app_user where id = ${userId} and status = 'ACTIVE'`.execute(tx);
  if (!u.rows[0]) {
    throw AppError.of('VALIDATION_ERROR', 'The owner must be an active user of this tenant.', [
      { field: 'ownerUserId', issue: 'USER_NOT_ACTIVE' },
    ]);
  }
}

/** Fails closed: when no subject port is wired, intake is refused rather than accepting unchecked subjects. */
async function requireSubject(
  deps: ApiDeps,
  tx: Tx,
  type: 'LEAD' | 'APPLICATION',
  id: string,
): Promise<void> {
  if (!deps.complaintSubjectPort) {
    throw AppError.of('VALIDATION_ERROR', 'Complaint subjects cannot be checked on this server.', [
      { field: 'complainantType', issue: 'SUBJECT_UNSUPPORTED' },
    ]);
  }
  if (!(await deps.complaintSubjectPort.exists(tx, type, id))) {
    throw AppError.of('NOT_FOUND', 'Complainant not found.');
  }
}

export function registerComplaintRoutes(router: Router, deps: ApiDeps): void {
  router.post('/complaints', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'complaint.create');
    const key = idempotencyKey(req);
    const input = ComplaintCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/complaints', body: input }, async () => {
        await requireSubject(deps, tx, input.complainantType, input.complainantId);
        const id = deps.ids.next('grv');
        // Option B: statutory SLA norm of 30 days when dueAt is not explicitly supplied
        const defaultDueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const effectiveDueAt = input.dueAt ?? defaultDueAt;
        const r = await sql<Row>`
          insert into complaint (id, tenant_id, complainant_type, complainant_id, channel, category, description,
                                 due_at, ack_ref, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.complainantType}, ${input.complainantId}, ${input.channel},
                  ${input.category}, ${input.description}, ${effectiveDueAt}::timestamptz, ${ackRef(id)},
                  ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
        const row = r.rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: 'complaint.created',
          entityType: 'COMPLAINT',
          entityId: id,
          after: { complainantType: input.complainantType, channel: input.channel, category: input.category },
          permissionUsed: 'complaint.create',
        });
        return { status: 201, body: toComplaint(row), resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.get('/complaints', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'complaint.manage');
    const q = ComplaintListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`complaint`,
        sortColumn: 'ack_ref',
        where: [
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.category ? [sql`category = ${q.category}`] : []),
          ...(q.ownerUserId ? [sql`owner_user_id = ${q.ownerUserId}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toComplaint,
      }),
    );
    res.json(page);
  });

  router.get('/complaints/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'complaint.manage');
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from complaint where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Complaint not found.');
    sendResource(res, 200, toComplaint(row));
  });

  router.patch('/complaints/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'complaint.manage');
    const version = ifMatchVersion(req);
    const input = ComplaintPatch.parse(req.body);

    const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'complaint', req.params.id, 'Complaint');
      if (current.status === 'RESOLVED') {
        throw AppError.of('INVALID_STATE', 'A resolved complaint cannot be changed. Reopen it first.');
      }
      if (input.status === 'IN_PROGRESS' && current.status === 'IN_PROGRESS') {
        throw AppError.of('INVALID_TRANSITION', 'The complaint is already in progress.');
      }
      if (input.ownerUserId) await requireActiveOwner(tx, input.ownerUserId);
      if (input.lenderReferral) await requireKnownLender(deps, tx, input.lenderReferral.lenderId);

      const referral =
        input.lenderReferral === undefined
          ? undefined
          : input.lenderReferral === null
            ? {}
            : { ...input.lenderReferral, referredAt: ctx.now.toISOString() };
      const row = await updateVersioned(tx, ctx.principal.id, 'complaint', current, version, {
        owner_user_id: input.ownerUserId,
        category: input.category,
        due_at: input.dueAt,
        status: input.status,
        lender_referral: referral === undefined ? undefined : JSON.stringify(referral),
      });
      const action =
        input.lenderReferral !== undefined
          ? 'complaint.referred'
          : input.ownerUserId !== undefined
            ? 'complaint.assigned'
            : 'complaint.updated';
      await deps.audit.record(tx, ctx, {
        action,
        entityType: 'COMPLAINT',
        entityId: String(row.id),
        before: snapshot(current),
        after: snapshot(row),
        permissionUsed: 'complaint.manage',
      });
      return row;
    });
    sendResource(res, 200, toComplaint(updated));
  });

  router.post('/complaints/:id/resolution', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'complaint.manage');
    const key = idempotencyKey(req);
    const version = ifMatchVersion(req);
    const input = ComplaintResolution.parse(req.body);
    const path = `/v1/complaints/${req.params.id}/resolution`;

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path, body: input }, async () => {
        const current = await loadForUpdate(tx, 'complaint', req.params.id, 'Complaint');
        const isResolve = input.action === 'RESOLVE';
        if (isResolve && current.status === 'RESOLVED') {
          throw AppError.of('INVALID_TRANSITION', 'The complaint is already resolved.');
        }
        if (!isResolve && current.status !== 'RESOLVED') {
          throw AppError.of('INVALID_TRANSITION', 'Only a resolved complaint can be reopened.');
        }
        const row = await updateVersioned(
          tx,
          ctx.principal.id,
          'complaint',
          current,
          version,
          isResolve
            ? { status: 'RESOLVED', resolution: input.resolution, resolved_at: ctx.now.toISOString() }
            : { status: 'OPEN', resolution: null, resolved_at: null },
        );
        await deps.audit.record(tx, ctx, {
          action: isResolve ? 'complaint.resolved' : 'complaint.reopened',
          entityType: 'COMPLAINT',
          entityId: String(row.id),
          before: { status: current.status },
          after: { status: row.status },
          reason: isResolve ? undefined : input.reason,
          permissionUsed: 'complaint.manage',
        });
        return { status: 200, body: toComplaint(row), resourceRef: String(row.id) };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });
}
