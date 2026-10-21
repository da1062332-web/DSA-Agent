// MOD-ORG org chart and MOD-ACL access reviews (owner: Dev 1).
//   API-ORG-010 GET /v1/org-chart?asOf=   any staff, within scope. Branches, their teams, each team's manager and the members
//               whose effective-dated membership covers asOf (default now). Reporting lines are the team manager relations;
//               ENT-007 reporting_line is not built, so a user reports to the manager of each team they belong to.
//               Scope: a TENANT grant of any permission sees every branch; otherwise the granted branches and the own branch.
//   API-ACL-005 POST /v1/access-reviews                   user.manage; Idempotency-Key. Snapshots the assignments in force.
//   API-ACL-006 POST /v1/access-reviews/{id}/decisions    user.manage. CERTIFY or REVOKE items; SOD-10 (never one's own
//               access); a REVOKE ends the assignment, and no decision may leave the tenant without an administrator.
//               GET /v1/access-reviews/{id} shows the campaign and its items.
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { idempotencyKey, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { assertAdministratorRemains, countActiveAdministrators } from './role-guards';

type Row = Record<string, unknown>;

export const OrgChartQuery = z.object({ asOf: z.string().datetime().optional() });

export const AccessReviewCreate = z
  .object({
    name: z.string().trim().min(3).max(120),
    /** Only assignments of users whose primary branch is listed; empty means the whole tenant. */
    branchIds: z.array(z.string().min(3).max(64)).max(100).default([]),
    dueAt: z.string().datetime(),
  })
  .strict();

export const AccessReviewDecisions = z
  .object({
    decisions: z
      .array(
        z
          .object({
            itemId: z.string().min(3).max(64),
            decision: z.enum(['CERTIFY', 'REVOKE']),
            reason: z.string().trim().min(3).max(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

function visibleBranches(ctx: RequestContext): string[] | null {
  const p = ctx.principal;
  if (p.grants.some((g) => g.scope === 'TENANT')) return null;
  const ids = new Set<string>(p.grants.flatMap((g) => (g.scope === 'BRANCH' ? g.branchIds : [])));
  if (p.primaryBranchId) ids.add(p.primaryBranchId);
  return [...ids];
}

async function loadReview(tx: Tx, id: string) {
  const r = await sql<Row>`select * from access_review where id = ${id}`.execute(tx);
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Access review not found.');
  const items = await sql<Row>`
    select i.*, u.display_name, ro.name as role_name
      from access_review_item i
      join app_user u on u.id = i.user_id
      join role ro on ro.id = i.role_id
     where i.review_id = ${id} order by u.display_name, i.id`.execute(tx);
  const rv = r.rows[0];
  return {
    id: String(rv.id),
    name: String(rv.name),
    branchIds: rv.branch_ids as string[],
    status: String(rv.status),
    dueAt: new Date(String(rv.due_at)).toISOString(),
    itemCount: Number(rv.item_count),
    decided: items.rows.filter((i) => i.decision).length,
    version: Number(rv.lock_version),
    items: items.rows.map((i) => ({
      id: String(i.id),
      userId: String(i.user_id),
      userName: String(i.display_name),
      roleId: String(i.role_id),
      roleName: String(i.role_name),
      scopeType: String(i.scope_type),
      decision: (i.decision as string | null) ?? null,
      decidedBy: (i.decided_by as string | null) ?? null,
    })),
  };
}

export function registerOrgChartAndReviewRoutes(router: Router, deps: ApiDeps): void {
  // API-ORG-010
  router.get('/org-chart', async (req, res) => {
    const ctx = requireCtx(req);
    const q = OrgChartQuery.parse(req.query);
    const asOf = q.asOf ? new Date(q.asOf) : ctx.now;
    const scope = visibleBranches(ctx);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const branches = await sql<Row>`
        select id, code, name, status from branch
         where ${scope ? sql`id = any(${scope}::text[])` : sql`true`}
         order by code`.execute(tx);
      const teams = await sql<Row>`
        select t.id, t.name, t.branch_id, t.manager_user_id, m.display_name as manager_name
          from team t left join app_user m on m.id = t.manager_user_id
         where t.status = 'ACTIVE' and (t.branch_id is null or ${scope ? sql`t.branch_id = any(${scope}::text[])` : sql`true`})
         order by t.name, t.id`.execute(tx);
      const members = await sql<Row>`
        select tm.team_id, u.id as user_id, u.display_name
          from team_membership tm join app_user u on u.id = tm.user_id
         where tm.effective_range @> ${asOf}::timestamptz and u.status in ('ACTIVE', 'SUSPENDED')
         order by u.display_name, u.id`.execute(tx);
      const byTeam = new Map<string, { userId: string; displayName: string }[]>();
      for (const m of members.rows) {
        const list = byTeam.get(String(m.team_id)) ?? [];
        list.push({ userId: String(m.user_id), displayName: String(m.display_name) });
        byTeam.set(String(m.team_id), list);
      }
      const teamOf = (t: Row) => ({
        id: String(t.id),
        name: String(t.name),
        manager: t.manager_user_id
          ? { userId: String(t.manager_user_id), displayName: String(t.manager_name) }
          : null,
        members: byTeam.get(String(t.id)) ?? [],
      });
      return {
        asOf: asOf.toISOString(),
        branches: branches.rows.map((b) => ({
          id: String(b.id),
          code: String(b.code),
          name: String(b.name),
          status: String(b.status),
          teams: teams.rows.filter((t) => t.branch_id === b.id).map(teamOf),
        })),
        crossBranchTeams: teams.rows.filter((t) => t.branch_id === null).map(teamOf),
      };
    });
    res.json(body);
  });

  // API-ACL-005
  router.post('/access-reviews', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const key = idempotencyKey(req);
    const input = AccessReviewCreate.parse(req.body);
    if (new Date(input.dueAt).getTime() <= ctx.now.getTime()) {
      throw AppError.of('VALIDATION_ERROR', 'The review must be due in the future.', [
        { field: 'dueAt', issue: 'PAST' },
      ]);
    }
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/access-reviews', body: input }, async () => {
        const id = deps.ids.next('arv');
        await sql`
          insert into access_review (id, tenant_id, name, branch_ids, due_at, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.name}, ${input.branchIds}, ${input.dueAt},
                  ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
        const items = await sql`
          insert into access_review_item (id, tenant_id, review_id, assignment_id, user_id, role_id, scope_type)
          select 'ari_' || new_ulid(), a.tenant_id, ${id}, a.id, a.user_id, a.role_id, a.scope_type
            from user_role_assignment a join app_user u on u.id = a.user_id
           where a.effective_range @> now() and u.status <> 'DEACTIVATED'
             and (${input.branchIds.length === 0} or u.primary_branch_id = any(${input.branchIds}::text[]))`.execute(
          tx,
        );
        await sql`update access_review set item_count = ${Number(items.numAffectedRows ?? 0)}, updated_by = ${ctx.principal.id}
                   where id = ${id}`.execute(tx);
        await deps.audit.record(tx, ctx, {
          action: 'access_review.started',
          entityType: 'ACCESS_REVIEW',
          entityId: id,
          after: { name: input.name, items: Number(items.numAffectedRows ?? 0), dueAt: input.dueAt },
          permissionUsed: 'user.manage',
        });
        return { status: 201, body: await loadReview(tx, id), resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.get('/access-reviews/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const body = await deps.txRunner.withTenantTx(ctx, (tx) => loadReview(tx, req.params.id));
    sendResource(res, 200, body);
  });

  // API-ACL-006
  router.post('/access-reviews/:id/decisions', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const input = AccessReviewDecisions.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const review = (
        await sql<Row>`select * from access_review where id = ${req.params.id} for update`.execute(tx)
      ).rows[0];
      if (!review) throw AppError.of('NOT_FOUND', 'Access review not found.');
      if (review.status !== 'OPEN') throw AppError.of('INVALID_STATE', 'The review is closed.');
      const adminsBefore = await countActiveAdministrators(tx, ctx.principal.tenantId);
      for (const d of input.decisions) {
        const item = (
          await sql<Row>`select * from access_review_item where id = ${d.itemId} and review_id = ${String(review.id)} for update`.execute(
            tx,
          )
        ).rows[0];
        if (!item)
          throw AppError.of('VALIDATION_ERROR', 'The item is not in this review.', [
            { field: 'itemId', issue: 'NOT_FOUND' },
          ]);
        if (item.user_id === ctx.principal.id) {
          throw AppError.of(
            'SOD_VIOLATION',
            'Separation of duties (SOD-10): you cannot decide on your own access.',
          );
        }
        if (item.decision) throw AppError.of('INVALID_STATE', `Item ${d.itemId} is already decided.`);
        if (d.decision === 'REVOKE') {
          if (!d.reason)
            throw AppError.of('VALIDATION_ERROR', 'A reason is required to revoke.', [
              { field: 'reason', issue: 'REQUIRED' },
            ]);
          await sql`
            update user_role_assignment
               set effective_range = tstzrange(lower(effective_range), greatest(now(), lower(effective_range)), '[)')
             where id = ${String(item.assignment_id)} and effective_range @> now()`.execute(tx);
        }
        await sql`
          update access_review_item set decision = ${d.decision}, reason = ${d.reason ?? null}, decided_by = ${ctx.principal.id},
                 decided_at = now()
           where id = ${String(item.id)}`.execute(tx);
        await deps.audit.record(tx, ctx, {
          action: d.decision === 'REVOKE' ? 'access_review.revoked' : 'access_review.certified',
          entityType: 'USER_ROLE_ASSIGNMENT',
          entityId: String(item.assignment_id),
          after: { reviewId: review.id, userId: item.user_id, roleId: item.role_id, decision: d.decision },
          reason: d.reason,
          permissionUsed: 'user.manage',
        });
      }
      await assertAdministratorRemains(tx, ctx.principal.tenantId, adminsBefore);
      const open = await sql<{ n: number }>`
        select count(*)::int as n from access_review_item where review_id = ${String(review.id)} and decision is null`.execute(
        tx,
      );
      await sql`
        update access_review
           set status = ${open.rows[0]!.n === 0 ? 'CLOSED' : 'OPEN'}, closed_at = ${open.rows[0]!.n === 0 ? ctx.now : null},
               updated_by = ${ctx.principal.id}
         where id = ${String(review.id)}`.execute(tx);
      return loadReview(tx, String(review.id));
    });
    sendResource(res, 200, body);
  });
}
