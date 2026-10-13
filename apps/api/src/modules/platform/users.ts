// User read model (owner: Dev 1) — API-USR-010 GET /v1/me (PA-01) and GET /v1/users for pickers
// (team members, queue members, team manager). Lists never include email or mobile (Contracts §12).
import { AppError } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';
import { keysetPage, type Row } from './db';
import { UserListQuery, type MeResponse, type UserSummary } from './schemas';

const toUser = (r: Row): UserSummary => ({
  id: String(r.id),
  displayName: String(r.display_name),
  primaryBranchId: String(r.primary_branch_id),
  status: String(r.status),
  availability: String(r.availability),
});

export function registerUserRoutes(router: Router, deps: ApiDeps): void {
  // No permission needed: the caller's own record.
  router.get('/me', async (req, res) => {
    const ctx = requireCtx(req);
    const p = ctx.principal;
    const user = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<{ email: string; display_name: string; lock_version: number }>`
        select email, display_name, lock_version from app_user where id = ${p.id}`.execute(tx);
      return r.rows[0];
    });
    if (!user) throw AppError.of('NOT_FOUND', 'User not found.');

    const body: MeResponse = {
      id: p.id,
      tenantId: p.tenantId,
      email: user.email,
      displayName: user.display_name,
      primaryBranchId: p.primaryBranchId,
      queueIds: p.queueIds,
      grants: p.grants,
      mfaVerifiedAt: p.authTime,
    };
    res.set('ETag', `"${user.lock_version}"`).json(body);
  });

  router.get('/users', async (req, res) => {
    const ctx = requireCtx(req);
    const q = UserListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`app_user`,
        select: sql`id, display_name, primary_branch_id, status, availability`,
        sortColumn: 'display_name',
        where: [
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.branchId ? [sql`primary_branch_id = ${q.branchId}`] : []),
          ...(q.q ? [sql`display_name ilike ${`%${q.q}%`}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toUser,
      }),
    );
    res.json(page);
  });
}
