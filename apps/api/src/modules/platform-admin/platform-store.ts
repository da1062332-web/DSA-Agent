// Persistence for the cross-tenant parts of the platform console (owner: Dev 1; DSA Notion MODULE 1 and MODULE 40).
// The tenant list and support-access requests are the only places a platform operator touches another tenant's rows.
// PgPlatformStore runs them through withTenantTx, so the database policies in migration 0050 decide what is visible:
//   - tenant metadata and active-user counts are readable in the platform realm only;
//   - a platform session can file and read support-access requests, but cannot approve them;
//   - the target tenant's own session approves, denies or revokes.
// Every call records an audit event in the same transaction. InMemoryPlatformStore backs the unit tests only.
import {
  AppError,
  PLATFORM_TENANT_ID,
  type CreateSupportAccessRequest,
  type PlatformTenantSummary,
  type RequestContext,
  type SupportAccessGrant,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';

export interface PlatformStore {
  /** Customer tenants only, as metadata. Requires a platform session. */
  listTenants(ctx: RequestContext): Promise<PlatformTenantSummary[]>;
  /** A platform operator files a request against another tenant. */
  createSupportGrant(ctx: RequestContext, req: CreateSupportAccessRequest): Promise<SupportAccessGrant>;
  /** Platform session: all requests (optionally one tenant). Tenant session: only its own tenant's. */
  listSupportGrants(ctx: RequestContext, tenantId?: string): Promise<SupportAccessGrant[]>;
  /** The target tenant's administrator decides. The requester cannot (SOD-06). */
  decideSupportGrant(ctx: RequestContext, id: string, decision: 'APPROVED' | 'DENIED'): Promise<SupportAccessGrant>;
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** DB status ACTIVE is APPROVED in the API. */
const apiStatus = (s: string): SupportAccessGrant['status'] => (s === 'ACTIVE' ? 'APPROVED' : (s as SupportAccessGrant['status']));

const toGrant = (r: Row): SupportAccessGrant => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  tenantName: String(r.tenant_name ?? r.tenant_id),
  requester: String(r.support_user_id),
  approver: (r.approved_by as string | null) ?? null,
  reason: String(r.reason),
  scope: String(r.scope),
  startsAt: iso(r.starts_at),
  endsAt: iso(r.expires_at),
  incidentRef: String(r.incident_ref),
  status: apiStatus(String(r.status)),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.approved_at ?? r.revoked_at ?? r.created_at),
});

const GRANT_COLUMNS = sql`g.id, g.tenant_id, t.legal_name AS tenant_name, g.support_user_id, g.reason, g.scope, g.incident_ref,
  g.starts_at, g.expires_at, g.status, g.approved_by, g.approved_at, g.revoked_at, g.created_at`;

export class PgPlatformStore implements PlatformStore {
  constructor(private readonly deps: Pick<ApiDeps, 'txRunner' | 'audit' | 'ids'>) {}

  async listTenants(ctx: RequestContext): Promise<PlatformTenantSummary[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        SELECT t.id, t.slug, t.legal_name, t.tenant_type, t.data_region, t.timezone, t.status, t.created_at, t.created_by,
               COALESCE(c.active_users, 0) AS active_users
          FROM tenant t
          LEFT JOIN platform_tenant_user_counts() c ON c.tenant_id = t.id
         WHERE t.tenant_type <> 'PLATFORM'
         ORDER BY t.created_at DESC, t.id`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'platform.tenants_listed',
        entityType: 'TENANT',
        entityId: null,
        after: { count: r.rows.length },
        permissionUsed: 'platform.console',
      });
      return r.rows.map((x) => ({
        id: String(x.id),
        slug: String(x.slug),
        legalName: String(x.legal_name),
        tenantType: x.tenant_type as PlatformTenantSummary['tenantType'],
        dataRegion: String(x.data_region),
        timezone: String(x.timezone),
        status: x.status as PlatformTenantSummary['status'],
        createdAt: iso(x.created_at),
        createdBy: String(x.created_by),
        healthStatus: x.status === 'ACTIVE' ? ('HEALTHY' as const) : ('DEGRADED' as const),
        activeUsersCount: Number(x.active_users),
        // Business counts are not shown in the platform console, and no entitlement store exists yet (SUB-TEN.03).
        applicationsCount: null,
        entitlements: [],
      }));
    });
  }

  async createSupportGrant(ctx: RequestContext, req: CreateSupportAccessRequest): Promise<SupportAccessGrant> {
    if (req.tenantId === PLATFORM_TENANT_ID) {
      throw AppError.of('VALIDATION_ERROR', 'Support access is requested against a customer tenant.', [
        { field: 'tenantId', issue: 'INVALID' },
      ]);
    }
    const id = this.deps.ids.next('sag');
    const ends = new Date(ctx.now.getTime() + req.durationHours * 3600 * 1000);
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const target = await sql<Row>`SELECT id FROM tenant WHERE id = ${req.tenantId} AND tenant_type <> 'PLATFORM'`.execute(tx);
      if (!target.rows[0]) {
        throw AppError.of('VALIDATION_ERROR', 'That tenant does not exist.', [{ field: 'tenantId', issue: 'NOT_FOUND' }]);
      }
      await sql`
        INSERT INTO support_access_grant (id, tenant_id, support_user_id, reason, scope, incident_ref, starts_at, expires_at,
                                          status, created_by)
        VALUES (${id}, ${req.tenantId}, ${ctx.principal.id}, ${req.reason}, ${req.scope}, ${req.incidentRef}, ${ctx.now},
                ${ends}, 'PENDING', ${ctx.principal.id})`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'platform.support_access_requested',
        entityType: 'SUPPORT_ACCESS_GRANT',
        entityId: id,
        after: { targetTenantId: req.tenantId, incidentRef: req.incidentRef, scope: req.scope, durationHours: req.durationHours },
        reason: req.reason,
        permissionUsed: 'platform.support_access',
      });
      const r = await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(tx);
      return toGrant(r.rows[0]!);
    });
  }

  async listSupportGrants(ctx: RequestContext, tenantId?: string): Promise<SupportAccessGrant[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id
         ${tenantId ? sql`WHERE g.tenant_id = ${tenantId}` : sql``}
         ORDER BY g.created_at DESC, g.id`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'platform.support_access_listed',
        entityType: 'SUPPORT_ACCESS_GRANT',
        entityId: null,
        after: { count: r.rows.length, tenantFilter: tenantId ?? null },
        permissionUsed: ctx.principal.grants.some((g) => g.code === 'platform.support_access') ? 'platform.support_access' : 'config.manage',
      });
      return r.rows.map(toGrant);
    });
  }

  async decideSupportGrant(ctx: RequestContext, id: string, decision: 'APPROVED' | 'DENIED'): Promise<SupportAccessGrant> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // The tenant policy only lets the target tenant's session see and change a row; another tenant's id reads as missing.
      const found = await sql<Row>`SELECT * FROM support_access_grant WHERE id = ${id} FOR UPDATE`.execute(tx);
      const grant = found.rows[0];
      if (!grant || grant.tenant_id !== ctx.principal.tenantId) {
        throw AppError.of('NOT_FOUND', 'Support access request not found.');
      }
      if (grant.support_user_id === ctx.principal.id) {
        throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-06): the requester cannot approve their own support access request.');
      }
      if (grant.status !== 'PENDING') {
        throw AppError.of('INVALID_STATE', `Support access request is already ${apiStatus(String(grant.status))}.`);
      }
      if (new Date(String(grant.expires_at)).getTime() <= ctx.now.getTime()) {
        throw AppError.of('INVALID_STATE', 'The requested access window has already ended.');
      }
      const next = decision === 'APPROVED' ? 'ACTIVE' : 'DENIED';
      await sql`
        UPDATE support_access_grant
           SET status = ${next}, approved_by = ${ctx.principal.id}, approved_at = ${ctx.now}, lock_version = lock_version + 1
         WHERE id = ${id}`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: decision === 'APPROVED' ? 'platform.support_access_approved' : 'platform.support_access_denied',
        entityType: 'SUPPORT_ACCESS_GRANT',
        entityId: id,
        before: { status: grant.status },
        after: { status: next },
        permissionUsed: 'config.manage',
      });
      const r = await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(tx);
      return toGrant(r.rows[0]!);
    });
  }
}

/** Unit-test double with the same rules as the database policies. Not used by the running API. */
export class InMemoryPlatformStore implements PlatformStore {
  readonly tenants: PlatformTenantSummary[] = [];
  private grants = new Map<string, SupportAccessGrant>();
  private seq = 0;

  async listTenants(): Promise<PlatformTenantSummary[]> {
    return [...this.tenants];
  }

  async createSupportGrant(ctx: RequestContext, req: CreateSupportAccessRequest): Promise<SupportAccessGrant> {
    this.seq += 1;
    const id = `sag_test_${this.seq}`;
    const grant: SupportAccessGrant = {
      id,
      tenantId: req.tenantId,
      tenantName: req.tenantId,
      requester: ctx.principal.id,
      approver: null,
      reason: req.reason,
      scope: req.scope,
      startsAt: ctx.now.toISOString(),
      endsAt: new Date(ctx.now.getTime() + req.durationHours * 3600 * 1000).toISOString(),
      incidentRef: req.incidentRef,
      status: 'PENDING',
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };
    this.grants.set(id, grant);
    return grant;
  }

  async listSupportGrants(ctx: RequestContext, tenantId?: string): Promise<SupportAccessGrant[]> {
    const platform = ctx.principal.tenantId === PLATFORM_TENANT_ID;
    return [...this.grants.values()].filter((g) => (platform ? !tenantId || g.tenantId === tenantId : g.tenantId === ctx.principal.tenantId));
  }

  async decideSupportGrant(ctx: RequestContext, id: string, decision: 'APPROVED' | 'DENIED'): Promise<SupportAccessGrant> {
    const grant = this.grants.get(id);
    if (!grant || grant.tenantId !== ctx.principal.tenantId) throw AppError.of('NOT_FOUND', 'Support access request not found.');
    if (grant.requester === ctx.principal.id) throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-06).');
    if (grant.status !== 'PENDING') throw AppError.of('INVALID_STATE', `Support access request is already ${grant.status}.`);
    grant.status = decision;
    grant.approver = ctx.principal.id;
    grant.updatedAt = ctx.now.toISOString();
    return grant;
  }
}
