// MOD-ORG branches (owner: Dev 1) — API-ORG-003 POST /v1/branches (Idem) · API-ORG-004 GET /v1/branches ·
// API-ORG-005 PATCH /v1/branches/{id} · API-ORG-006 POST /v1/branches/{id}/deactivation.
// Reads: any signed-in user (branch pickers). Writes: config.manage. Every change is audited in the same tx.
import { AppError } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { iso, keysetPage, loadForUpdate, updateVersioned, type Row } from './db';
import { BranchCreate, BranchPatch, ListQuery, type Branch } from './schemas';

export const toBranch = (r: Row): Branch => ({
  id: String(r.id),
  organisationId: String(r.organisation_id),
  code: String(r.code),
  name: String(r.name),
  pincode: r.pincode === null ? null : String(r.pincode),
  timezone: String(r.timezone),
  status: String(r.status),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const snapshot = (r: Row) => ({
  code: r.code,
  name: r.name,
  pincode: r.pincode,
  timezone: r.timezone,
  status: r.status,
});

export function registerBranchRoutes(router: Router, deps: ApiDeps): void {
  router.get('/branches', async (req, res) => {
    const ctx = requireCtx(req);
    const q = ListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`branch`,
        select: sql`*`,
        sortColumn: 'code',
        where: [
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.q ? [sql`(code ilike ${`%${q.q}%`} or name ilike ${`%${q.q}%`})`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toBranch,
      }),
    );
    res.json(page);
  });

  router.get('/branches/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from branch where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Branch not found.');
    sendResource(res, 200, toBranch(row));
  });

  router.post('/branches', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = BranchCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/branches', body: input }, async () => {
        // A tenant has one organisation in the MVP; the branch belongs to it.
        const org = await sql<{ id: string }>`
          select id from organisation where status = 'ACTIVE' order by created_at limit 1`.execute(tx);
        const organisationId = org.rows[0]?.id;
        if (!organisationId) throw AppError.of('INVALID_STATE', 'The tenant has no active organisation.');

        const id = deps.ids.next('br');
        const r = await sql<Row>`
          insert into branch (id, tenant_id, organisation_id, code, name, pincode, timezone, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${organisationId}, ${input.code}, ${input.name},
                  ${input.pincode ?? null}, ${input.timezone ?? 'Asia/Kolkata'}, ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
        const row = r.rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: 'branch.created',
          entityType: 'BRANCH',
          entityId: id,
          after: snapshot(row),
          permissionUsed: 'config.manage',
        });
        return { status: 201, body: toBranch(row), resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.patch('/branches/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = BranchPatch.parse(req.body);

    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'branch', req.params.id, 'Branch');
      const updated = await updateVersioned(tx, ctx, 'branch', current, version, {
        name: input.name,
        pincode: input.pincode,
        timezone: input.timezone,
      });
      await deps.audit.record(tx, ctx, {
        action: 'branch.updated',
        entityType: 'BRANCH',
        entityId: String(updated.id),
        before: snapshot(current),
        after: snapshot(updated),
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toBranch(row));
  });

  router.post('/branches/:id/deactivation', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);

    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'branch', req.params.id, 'Branch');
      if (current.status !== 'ACTIVE')
        throw AppError.of('INVALID_TRANSITION', 'The branch is already inactive.');

      const users = await sql<{ n: number }>`
        select count(*)::int as n from app_user
         where primary_branch_id = ${current.id} and status in ('ACTIVE', 'INVITED')`.execute(tx);
      const n = users.rows[0]?.n ?? 0;
      if (n > 0) {
        throw AppError.of(
          'INVALID_STATE',
          'Move the users whose primary branch this is before deactivating it.',
          [{ issue: 'BRANCH_HAS_USERS', meta: { userCount: n } }],
        );
      }

      const updated = await updateVersioned(tx, ctx, 'branch', current, version, { status: 'INACTIVE' });
      // Its queues stop receiving work with it.
      await sql`update work_queue set active = false, updated_by = ${ctx.principal.id}
                 where branch_id = ${current.id} and active`.execute(tx);
      await deps.audit.record(tx, ctx, {
        action: 'branch.deactivated',
        entityType: 'BRANCH',
        entityId: String(updated.id),
        before: snapshot(current),
        after: snapshot(updated),
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toBranch(row));
  });
}
