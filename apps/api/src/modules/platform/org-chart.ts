// MOD-ORG org chart (owner: Vaibhav, platform lane).
//   API-ORG-010 GET /v1/org-chart?asOf=   any staff, within scope. Branches, their teams, each team's manager and the members
//               whose effective-dated membership covers asOf (default now). Reporting lines are the team manager relations;
//               ENT-007 reporting_line is not built, so a user reports to the manager of each team they belong to.
//               Scope: a TENANT grant of any permission sees every branch; otherwise the granted branches and the own branch.
// Access reviews (API-ACL-005/006) were removed with task P0-02.
import type { RequestContext } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';

type Row = Record<string, unknown>;

export const OrgChartQuery = z.object({ asOf: z.string().datetime().optional() });

function visibleBranches(ctx: RequestContext): string[] | null {
  const p = ctx.principal;
  if (p.grants.some((g) => g.scope === 'TENANT')) return null;
  const ids = new Set<string>(p.grants.flatMap((g) => (g.scope === 'BRANCH' ? g.branchIds : [])));
  if (p.primaryBranchId) ids.add(p.primaryBranchId);
  return [...ids];
}

export function registerOrgChartRoutes(router: Router, deps: ApiDeps): void {
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
}
