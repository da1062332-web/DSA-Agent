// MOD-ORG teams (owner: Dev 1) — API-ORG-007 POST /v1/teams (Idem) · GET /v1/teams, /v1/teams/{id} ·
// API-ORG-008 PATCH /v1/teams/{id} · API-ORG-009 PUT /v1/teams/{id}/members.
// Memberships are effective-dated: removing a member closes its range, history is kept (TEAM scope uses it).
// Reads: any signed-in user. Team create/edit: config.manage or user.manage; members: user.manage (API-ORG-007…009).
// A BRANCH-scoped grant (branch manager) only covers teams of its own branches, never cross-branch teams.
import { AppError, type Tx } from '@dsa/contracts';
import { requirePermissionForBranch, withIdempotency } from '@dsa/kernel';
import type { PermissionCode } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import {
  iso,
  keysetPage,
  loadForUpdate,
  requireActiveBranch,
  requireActiveUsers,
  updateVersioned,
  type Row,
} from './db';
import { ListQuery, TeamCreate, TeamMembersPut, TeamPatch, type Team, type TeamDetail } from './schemas';

const TEAM_WITH_COUNT = sql`(
  select t.*, (select count(*)::int from team_membership m
                where m.team_id = t.id and m.effective_range @> now()) as member_count
    from team t) t`;

const toTeam = (r: Row): Team => ({
  id: String(r.id),
  name: String(r.name),
  branchId: (r.branch_id as string | null) ?? null,
  managerUserId: (r.manager_user_id as string | null) ?? null,
  status: String(r.status),
  memberCount: Number(r.member_count ?? 0),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const snapshot = (r: Row) => ({
  name: r.name,
  branchId: r.branch_id,
  managerUserId: r.manager_user_id,
  status: r.status,
});

async function loadTeamDetail(tx: Tx, id: string): Promise<TeamDetail> {
  const t = await sql<Row>`select * from ${TEAM_WITH_COUNT} where id = ${id}`.execute(tx);
  const row = t.rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'Team not found.');
  const m = await sql<{ user_id: string; display_name: string; since: Date }>`
    select m.user_id, u.display_name, lower(m.effective_range) as since
      from team_membership m join app_user u on u.id = m.user_id
     where m.team_id = ${id} and m.effective_range @> now()
     order by u.display_name, m.user_id`.execute(tx);
  return {
    ...toTeam(row),
    members: m.rows.map((x) => ({ userId: x.user_id, displayName: x.display_name, since: iso(x.since) })),
  };
}

const TEAM_ADMIN: PermissionCode[] = ['config.manage', 'user.manage'];

async function validateRefs(tx: Tx, input: { branchId?: string | null; managerUserId?: string | null }) {
  if (input.branchId) await requireActiveBranch(tx, input.branchId, 'branchId');
  if (input.managerUserId) await requireActiveUsers(tx, [input.managerUserId], 'managerUserId');
}

export function registerTeamRoutes(router: Router, deps: ApiDeps): void {
  router.get('/teams', async (req, res) => {
    const ctx = requireCtx(req);
    const q = ListQuery.parse(req.query);
    const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: TEAM_WITH_COUNT,
        select: sql`*`,
        sortColumn: 'name',
        where: [
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.q ? [sql`name ilike ${`%${q.q}%`}`] : []),
          ...(branchId ? [sql`branch_id = ${branchId}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toTeam,
      }),
    );
    res.json(page);
  });

  router.get('/teams/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const team = await deps.txRunner.withTenantTx(ctx, (tx) => loadTeamDetail(tx, req.params.id));
    sendResource(res, 200, team);
  });

  router.post('/teams', async (req, res) => {
    const ctx = requireCtx(req);
    const input = TeamCreate.parse(req.body);
    const used = requirePermissionForBranch(ctx, TEAM_ADMIN, input.branchId ?? null);
    const key = idempotencyKey(req);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/teams', body: input }, async () => {
        await validateRefs(tx, input);
        const id = deps.ids.next('team');
        await sql`
          insert into team (id, tenant_id, name, branch_id, manager_user_id, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.name}, ${input.branchId ?? null},
                  ${input.managerUserId ?? null}, ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
        const team = await loadTeamDetail(tx, id);
        await deps.audit.record(tx, ctx, {
          action: 'team.created',
          entityType: 'TEAM',
          entityId: id,
          after: { name: team.name, branchId: team.branchId, managerUserId: team.managerUserId },
          permissionUsed: used,
        });
        return { status: 201, body: team, resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.patch('/teams/:id', async (req, res) => {
    const ctx = requireCtx(req);
    requireAnyOf(ctx, TEAM_ADMIN);
    const version = ifMatchVersion(req);
    const input = TeamPatch.parse(req.body);

    const team = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'team', req.params.id, 'Team');
      // Both the team's current branch and, when it moves, the new branch must be in the caller's scope.
      const used = requirePermissionForBranch(ctx, TEAM_ADMIN, (current.branch_id as string | null) ?? null);
      if (input.branchId !== undefined) requirePermissionForBranch(ctx, TEAM_ADMIN, input.branchId);
      await validateRefs(tx, input);
      const updated = await updateVersioned(tx, ctx, 'team', current, version, {
        name: input.name,
        branch_id: input.branchId,
        manager_user_id: input.managerUserId,
        status: input.status,
      });
      await deps.audit.record(tx, ctx, {
        action: 'team.updated',
        entityType: 'TEAM',
        entityId: String(updated.id),
        before: snapshot(current),
        after: snapshot(updated),
        permissionUsed: used,
      });
      return loadTeamDetail(tx, String(updated.id));
    });
    sendResource(res, 200, team);
  });

  router.put('/teams/:id/members', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'user.manage');
    const version = ifMatchVersion(req);
    const input = TeamMembersPut.parse(req.body);
    const wanted = [...new Set(input.userIds)];

    const team = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'team', req.params.id, 'Team');
      requirePermissionForBranch(ctx, ['user.manage'], (current.branch_id as string | null) ?? null);
      await requireActiveUsers(tx, wanted, 'userIds');

      const active = await sql<{ id: string; user_id: string }>`
        select id, user_id from team_membership
         where team_id = ${current.id} and effective_range @> now()`.execute(tx);
      const have = new Set(active.rows.map((m) => m.user_id));
      const removed = active.rows.filter((m) => !wanted.includes(m.user_id));
      const added = wanted.filter((u) => !have.has(u));

      if (removed.length) {
        await sql`
          update team_membership set effective_range = tstzrange(lower(effective_range), now(), '[)')
           where id = any(${removed.map((m) => m.id)}::text[])`.execute(tx);
      }
      for (const userId of added) {
        await sql`
          insert into team_membership (id, tenant_id, team_id, user_id, created_by)
          values (${deps.ids.next('tm')}, ${ctx.principal.tenantId}, ${current.id}, ${userId}, ${ctx.principal.id})`.execute(
          tx,
        );
      }
      // Bumps lock_version, so concurrent member edits conflict instead of overwriting each other.
      await updateVersioned(tx, ctx, 'team', current, version, {});
      await deps.audit.record(tx, ctx, {
        action: 'team.members_replaced',
        entityType: 'TEAM',
        entityId: String(current.id),
        before: { userIds: [...have] },
        after: { userIds: wanted, added, removed: removed.map((m) => m.user_id) },
        permissionUsed: 'user.manage',
      });
      return loadTeamDetail(tx, String(current.id));
    });
    sendResource(res, 200, team);
  });
}

/** Fast 403 before any database work when the caller holds none of the codes at any scope. */
function requireAnyOf(ctx: Parameters<typeof requirePermissionForBranch>[0], codes: PermissionCode[]): void {
  if (!ctx.principal.grants.some((g) => codes.includes(g.code))) requirePermissionForBranch(ctx, codes, null);
}
