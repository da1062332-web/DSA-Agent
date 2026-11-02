// apps/api/src/modules/origination/connectors/connector-insights.ts
// Module 27: Connector Management (MOD-CON). Read models for the connector workspace: the dashboard summary, a connector's referrals,
// and its activity. Every read is scoped by the caller's permissions and connector visibility (connector-service `visibility`), so a
// figure the caller may not see comes back as null, and a connector the caller may not see is not found.
import {
  AppError,
  CONNECTOR_STATUSES,
  type ConnectorActivityQuery,
  type ConnectorActivityResource,
  type ConnectorReferralResource,
  type ConnectorStatus,
  type ConnectorSummaryQuery,
  type ConnectorSummaryResource,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../../types';
import { assertVisible, visibility } from './connector-service';

type Row = Record<string, unknown>;

const FINANCE_READ = ['finance.view', 'commission.plan.edit', 'commission.plan.approve'];
const FINANCE_DISPUTE_READ = ['finance.view', 'finance.dispute'];

/** Whether the caller holds any of the permission codes, as a grant. Used to decide which figures to return, never to grant access. */
const holdsAny = (ctx: RequestContext, codes: string[]): boolean =>
  ctx.principal.grants.some((g) => codes.includes(g.code));

/** A created-at window on a trusted column name (the callers pass constants only). */
const window = (column: 'created_at', from: Date | null, to: Date | null) =>
  sql`${from ? sql`and ${sql.raw(column)} >= ${from}` : sql``} ${to ? sql`and ${sql.raw(column)} < ${to}` : sql``}`;

export async function connectorSummary(
  deps: ApiDeps,
  ctx: RequestContext,
  query: ConnectorSummaryQuery,
): Promise<ConnectorSummaryResource> {
  deps.authz.requirePermission(ctx, 'connector.read');
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if (from && to && from > to) {
    throw AppError.of('VALIDATION_ERROR', 'The start of the range is after its end.', [
      { field: 'from', issue: 'AFTER_END' },
    ]);
  }
  const tenantId = ctx.principal.tenantId;

  return deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
    const statusRows = await sql<Row>`
      select status, count(*)::int as n from app.connector
       where tenant_id = ${tenantId} ${visibility(ctx)} ${window('created_at', from, to)}
       group by status`.execute(tx);
    const byStatus = Object.fromEntries(CONNECTOR_STATUSES.map((s) => [s, 0])) as Record<
      ConnectorStatus,
      number
    >;
    for (const r of statusRows.rows) byStatus[r.status as ConnectorStatus] = Number(r.n);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    const leads = await sql<Row>`
      select count(*)::int as total,
             count(*) filter (where state in ('NEW','CONTACT_ATTEMPTED','IN_PROGRESS','QUALIFIED'))::int as pending,
             count(*) filter (where state = 'CONVERTED')::int as converted
        from app.lead
       where tenant_id = ${tenantId}
         and connector_id in (select id from app.connector where tenant_id = ${tenantId} ${visibility(ctx)})
         ${window('created_at', from, to)}`.execute(tx);

    // Attribution disputes follow the list they are shown in: tenant-wide, for those who may resolve them.
    const attributionOpen = holdsAny(ctx, ['connector.dispute_resolve'])
      ? Number(
          (
            await sql<Row>`
              select count(*)::int as n from app.attribution_dispute
               where tenant_id = ${tenantId} and status in ('OPEN','UNDER_REVIEW')`.execute(tx)
          ).rows[0]?.n ?? 0,
        )
      : null;

    // Partner disputes are finance records, so they are counted for finance readers only, tenant-wide, as the finance list shows them.
    const partnerOpen = holdsAny(ctx, FINANCE_DISPUTE_READ)
      ? Number(
          (
            await sql<Row>`
              select count(*)::int as n from app.dispute
               where tenant_id = ${tenantId} and party_type = 'CONNECTOR' and status in ('OPEN','UNDER_REVIEW')`.execute(
              tx,
            )
          ).rows[0]?.n ?? 0,
        )
      : null;

    // Earnings are the payable records of the connectors the caller can see, bucketed as the partner portal buckets them.
    let earnings: ConnectorSummaryResource['earnings'] = null;
    if (holdsAny(ctx, FINANCE_READ)) {
      const states = await sql<Row>`
        select state, coalesce(sum(amount), 0)::text as total from app.commission_payable
         where tenant_id = ${tenantId}
           and connector_id in (select id from app.connector where tenant_id = ${tenantId} ${visibility(ctx)})
         group by state`.execute(tx);
      const sumOf = (...names: string[]) =>
        states.rows
          .filter((r) => names.includes(String(r.state)))
          .reduce((acc, r) => acc + Math.round(Number(r.total) * 100), 0) / 100;
      earnings = {
        currency: 'INR',
        expected: sumOf('ACCRUED', 'ELIGIBLE').toFixed(2),
        approved: sumOf('APPROVED', 'IN_PAYOUT').toFixed(2),
        paid: sumOf('PAID').toFixed(2),
        held: sumOf('ON_HOLD').toFixed(2),
      };
    }

    const lead = leads.rows[0] ?? {};
    return {
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      connectors: { total, byStatus },
      referrals: {
        total: Number(lead.total ?? 0),
        pending: Number(lead.pending ?? 0),
        converted: Number(lead.converted ?? 0),
      },
      disputes: { attributionOpen, partnerOpen },
      earnings,
    };
  });
}

/**
 * The referrals attributed to one connector. Staff see the customer's name here because they already read leads (the caller must hold
 * lead.read); the mobile number is never returned. Application progress is the internal status, shown to internal staff only.
 */
export async function connectorReferrals(
  deps: ApiDeps,
  ctx: RequestContext,
  connectorId: string,
): Promise<ConnectorReferralResource[]> {
  deps.authz.requirePermission(ctx, 'lead.read');
  const tenantId = ctx.principal.tenantId;
  return deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
    await assertVisible(tx, ctx, connectorId);
    const rows = await sql<Row>`
      select l.id, l.full_name, l.product_category, l.state, l.duplicate_flag, l.created_at, l.updated_at,
             la.id as application_id, la.status as application_status
        from app.lead l
        left join app.loan_application la on la.tenant_id = l.tenant_id and la.lead_id = l.id
       where l.tenant_id = ${tenantId} and l.connector_id = ${connectorId}
       order by l.created_at desc, l.id desc
       limit 200`.execute(tx);
    return rows.rows.map((r) => ({
      id: String(r.id),
      customerName: String(r.full_name),
      productCategory: String(r.product_category),
      state: String(r.state),
      duplicateFlag: String(r.duplicate_flag),
      createdAt: new Date(String(r.created_at)).toISOString(),
      updatedAt: new Date(String(r.updated_at)).toISOString(),
      applicationId: r.application_id ? String(r.application_id) : null,
      applicationStatus: r.application_status ? String(r.application_status) : null,
    }));
  });
}

/**
 * The audit events that concern one connector: the connector itself, its bank accounts, agreements, portal users, attribution requests
 * and attribution disputes. The event payloads (before and after) are not returned.
 */
export async function connectorActivity(
  deps: ApiDeps,
  ctx: RequestContext,
  connectorId: string,
  query: ConnectorActivityQuery,
): Promise<ConnectorActivityResource[]> {
  deps.authz.requirePermission(ctx, 'connector.read');
  const tenantId = ctx.principal.tenantId;
  return deps.txRunner.withTenantTx(ctx, async (tx: Tx) => {
    await assertVisible(tx, ctx, connectorId);
    const rows = await sql<Row>`
      select e.id, e.occurred_at, e.action, e.entity_type, e.entity_id, e.actor_id, e.reason,
             u.display_name as actor_name
        from app.audit_event e
        left join app.app_user u on u.tenant_id = e.tenant_id and u.id = e.actor_id
       where e.tenant_id = ${tenantId} and (
             (e.entity_type = 'connector' and e.entity_id = ${connectorId})
          or (e.entity_type = 'connector_bank_account' and e.entity_id in
               (select id from app.connector_bank_account where tenant_id = ${tenantId} and connector_id = ${connectorId}))
          or (e.entity_type = 'connector_agreement' and e.entity_id in
               (select id from app.connector_agreement where tenant_id = ${tenantId} and connector_id = ${connectorId}))
          or (e.entity_type = 'USER' and e.entity_id in
               (select id from app.app_user where tenant_id = ${tenantId} and connector_id = ${connectorId}))
          or (e.entity_type = 'attribution_change_request' and e.entity_id in
               (select id from app.attribution_change_request where tenant_id = ${tenantId}
                  and (previous_connector_id = ${connectorId} or proposed_connector_id = ${connectorId})))
          or (e.entity_type = 'attribution_dispute' and e.entity_id in
               (select id from app.attribution_dispute where tenant_id = ${tenantId}
                  and (resolved_connector_id = ${connectorId} or ${connectorId} = any(claimant_connector_ids))))
       )
       order by e.occurred_at desc, e.id desc
       limit ${query.limit}`.execute(tx);
    return rows.rows.map((r) => ({
      id: String(r.id),
      occurredAt: new Date(String(r.occurred_at)).toISOString(),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: r.entity_id ? String(r.entity_id) : null,
      actorId: String(r.actor_id),
      actorName: r.actor_name ? String(r.actor_name) : null,
      reason: r.reason ? String(r.reason) : null,
    }));
  });
}
