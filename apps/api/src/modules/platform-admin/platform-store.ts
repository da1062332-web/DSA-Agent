// Persistence for the cross-tenant and tenant-governed parts of platform administration (owner: Dev 1; DSA Notion MODULE 1
// and MODULE 40). Tenant metadata, support-access requests and data corrections live in the database; feature
// flags too (app.feature_flag). Master data, queues and releases are still in memory in the service.
// PgPlatformStore runs everything through withTenantTx, so the policies in migration 0050 decide what a session sees:
//   - tenant metadata and active-user counts are readable in the platform realm only;
//   - a platform session can file and read support-access requests, but cannot approve, deny or revoke them;
//   - the target tenant's own session approves, denies or revokes;
//   - data corrections are tenant-isolated: the platform realm cannot read them, and a tenant sees only its own.
// Every call records an audit event in the same transaction as the change. InMemoryPlatformStore backs unit tests only.
import {
  AppError,
  PLATFORM_TENANT_ID,
  type CreateDataCorrectionRequest,
  type CreateSupportAccessRequest,
  type DataCorrectionRequest,
  type FeatureFlag,
  type PlatformTenantSummary,
  type RequestContext,
  type SupportAccessGrant,
  type UpdateFeatureFlagRequest,
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
  /** The target tenant ends an approved access early. */
  revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant>;

  /** Feature flags are readable by every session; only the platform realm can set them (policies in migration 0050). */
  listFlags(ctx: RequestContext): Promise<FeatureFlag[]>;
  getFlag(ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null>;
  /** Creates or updates a flag. A stale If-Match is a VERSION_CONFLICT. Only on/off flags are stored. */
  putFlag(ctx: RequestContext, key: string, input: UpdateFeatureFlagRequest, ifMatch: string | undefined): Promise<FeatureFlag>;

  /** The caller's own tenant only. */
  listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]>;
  createDataCorrection(ctx: RequestContext, req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest>;
  /** SOD-08: the approver is not the requester. */
  decideDataCorrection(ctx: RequestContext, id: string, decision: 'APPROVED' | 'REJECTED'): Promise<DataCorrectionRequest>;
  /** Only the correction executor (a service identity) calls this, on an APPROVED correction. */
  markDataCorrectionExecuted(ctx: RequestContext, id: string): Promise<DataCorrectionRequest>;
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** DB status ACTIVE is APPROVED in the API, and an approved grant past its window reads as EXPIRED. */
export function grantStatus(status: string, expiresAt: unknown, now: Date): SupportAccessGrant['status'] {
  if (status === 'ACTIVE') return new Date(String(expiresAt)).getTime() <= now.getTime() ? 'EXPIRED' : 'APPROVED';
  return status as SupportAccessGrant['status'];
}

const toGrant = (r: Row, now: Date): SupportAccessGrant => ({
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
  status: grantStatus(String(r.status), r.expires_at, now),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.revoked_at ?? r.approved_at ?? r.created_at),
});

const toCorrection = (r: Row): DataCorrectionRequest => ({
  id: String(r.id),
  tenantId: String(r.tenant_id),
  justification: String(r.justification ?? r.reason ?? ''),
  scriptRef: String(r.script_ref ?? ''),
  dryRunDiffKey: (r.dry_run_diff_key as string | null) ?? null,
  dryRunDiff: (r.dry_run_diff as string | null) ?? null,
  targetEntity: (r.target_entity as string | null) ?? (r.entity_type as string | null) ?? null,
  changeDescription: (r.change_description as string | null) ?? null,
  requestedBy: String(r.requested_by ?? r.submitted_by ?? r.created_by),
  approvedBy: (r.approved_by as string | null) ?? null,
  status: r.status as DataCorrectionRequest['status'],
  executedAt: r.executed_at ? iso(r.executed_at) : null,
  executorIdentity: String(r.executor_identity ?? 'SERVICE:data-correction-executor'),
  createdAt: iso(r.created_at),
});

const GRANT_COLUMNS = sql`g.id, g.tenant_id, t.legal_name AS tenant_name, g.support_user_id, g.reason, g.scope, g.incident_ref,
  g.starts_at, g.expires_at, g.status, g.approved_by, g.approved_at, g.revoked_at, g.created_at`;

type FlagRow = {
  key: string;
  scope: FeatureFlag['scope'];
  value: boolean;
  owner: string;
  remove_by: string | Date | null;
  description: string | null;
  lock_version: number | string;
  updated_at: string | Date;
  updated_by: string;
};

const dateOnly = (v: string | Date | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const toFlag = (r: FlagRow): FeatureFlag => ({
  key: r.key,
  scope: r.scope,
  value: r.value,
  owner: r.owner,
  removeBy: dateOnly(r.remove_by),
  description: r.description ?? '',
  lockVersion: Number(r.lock_version),
  updatedAt: new Date(r.updated_at).toISOString(),
  updatedBy: r.updated_by,
});

export class PgPlatformStore implements PlatformStore {
  constructor(private readonly deps: Pick<ApiDeps, 'txRunner' | 'audit' | 'ids'>) {}

  // ---- tenant list ----------------------------------------------------------------------------------------------
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

  // ---- support access -------------------------------------------------------------------------------------------
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
      return toGrant(r.rows[0]!, ctx.now);
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
      return r.rows.map((x) => toGrant(x, ctx.now));
    });
  }

  /** A grant that belongs to the caller's tenant, locked. Another tenant's grant reads as missing. */
  private async ownGrantForUpdate(tx: Parameters<Parameters<ApiDeps['txRunner']['withTenantTx']>[1]>[0], ctx: RequestContext, id: string): Promise<Row> {
    const found = await sql<Row>`SELECT * FROM support_access_grant WHERE id = ${id} FOR UPDATE`.execute(tx);
    const grant = found.rows[0];
    if (!grant || grant.tenant_id !== ctx.principal.tenantId) {
      throw AppError.of('NOT_FOUND', 'Support access request not found.');
    }
    return grant;
  }

  async decideSupportGrant(ctx: RequestContext, id: string, decision: 'APPROVED' | 'DENIED'): Promise<SupportAccessGrant> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const grant = await this.ownGrantForUpdate(tx, ctx, id);
      if (grant.support_user_id === ctx.principal.id) {
        throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-06): the requester cannot approve their own support access request.');
      }
      if (grant.status !== 'PENDING') {
        throw AppError.of('INVALID_STATE', `Support access request is already ${grantStatus(String(grant.status), grant.expires_at, ctx.now)}.`);
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
      return toGrant(r.rows[0]!, ctx.now);
    });
  }

  async revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const grant = await this.ownGrantForUpdate(tx, ctx, id);
      const current = grantStatus(String(grant.status), grant.expires_at, ctx.now);
      if (current !== 'APPROVED') {
        throw AppError.of('INVALID_STATE', `Only an approved, unexpired access can be revoked (this one is ${current}).`);
      }
      await sql`
        UPDATE support_access_grant
           SET status = 'REVOKED', revoked_by = ${ctx.principal.id}, revoked_at = ${ctx.now}, lock_version = lock_version + 1
         WHERE id = ${id}`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'platform.support_access_revoked',
        entityType: 'SUPPORT_ACCESS_GRANT',
        entityId: id,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED' },
        permissionUsed: 'config.manage',
      });
      const r = await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(tx);
      return toGrant(r.rows[0]!, ctx.now);
    });
  }

  // ---- data corrections (tenant realm) ----------------------------------------------------------------------------
  async listFlags(ctx: RequestContext): Promise<FeatureFlag[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                     FROM feature_flag ORDER BY key, scope`.execute(tx);
      return r.rows.map(toFlag);
    });
  }

  async getFlag(ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                     FROM feature_flag WHERE key = ${key} AND scope = ${scope}`.execute(tx);
      return r.rows[0] ? toFlag(r.rows[0]) : null;
    });
  }

  async putFlag(ctx: RequestContext, key: string, input: UpdateFeatureFlagRequest, ifMatch: string | undefined): Promise<FeatureFlag> {
    if (typeof input.value !== 'boolean') {
      throw AppError.of('VALIDATION_ERROR', 'Only on/off feature flags are supported.', [{ field: 'value', issue: 'MUST_BE_BOOLEAN' }]);
    }
    const scope = input.scope ?? 'GLOBAL';
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const found = await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                         FROM feature_flag WHERE key = ${key} AND scope = ${scope} FOR UPDATE`.execute(tx);
      const existing = found.rows[0];
      if (existing) {
        const expected = ifMatch === undefined ? NaN : parseInt(ifMatch.replace(/"/g, ''), 10);
        if (!Number.isNaN(expected) && Number(existing.lock_version) !== expected) {
          throw AppError.of(
            'VERSION_CONFLICT',
            `Feature flag '${key}' has been modified by another process. Current version: ${existing.lock_version}.`,
          );
        }
        const removeBy = input.removeBy !== undefined ? input.removeBy : dateOnly(existing.remove_by);
        const updated = await sql<FlagRow>`
          UPDATE feature_flag SET value = ${input.value}, owner = ${input.owner ?? existing.owner}, remove_by = ${removeBy}::date,
                 description = ${input.description ?? existing.description}, lock_version = lock_version + 1, updated_at = now(),
                 updated_by = ${ctx.principal.id}
           WHERE key = ${key} AND scope = ${scope}
           RETURNING key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by`.execute(tx);
        // Row-level security lets only the platform realm update a flag: no row back means this session may not.
        if (!updated.rows[0]) throw AppError.of('FORBIDDEN', 'Only the platform realm can change feature flags.');
        return toFlag(updated.rows[0]);
      }
      const created = await sql<FlagRow>`
        INSERT INTO feature_flag (key, scope, value, owner, remove_by, description, lock_version, updated_by)
        VALUES (${key}, ${scope}, ${input.value}, ${input.owner ?? 'Platform Admin'}, ${input.removeBy ?? null}::date,
                ${input.description ?? ''}, 1, ${ctx.principal.id})
        RETURNING key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by`.execute(tx);
      return toFlag(created.rows[0]!);
    });
  }

  async listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`SELECT * FROM data_correction_request ORDER BY created_at DESC, id`.execute(tx);
      return r.rows.map(toCorrection);
    });
  }

  async createDataCorrection(ctx: RequestContext, req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest> {
    const id = this.deps.ids.next('dcr');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // The tenant is the caller's own: set by the session, never by the body.
      const r = await sql<Row>`
        INSERT INTO data_correction_request (id, tenant_id, justification, script_ref, target_entity, change_description,
                                             requested_by, status, created_by)
        VALUES (${id}, ${ctx.principal.tenantId}, ${req.justification}, ${req.scriptRef}, ${req.targetEntity},
                ${req.changeDescription}, ${ctx.principal.id}, 'PENDING', ${ctx.principal.id})
        RETURNING *`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'data_correction.requested',
        entityType: 'DATA_CORRECTION',
        entityId: id,
        after: { scriptRef: req.scriptRef, targetEntity: req.targetEntity },
        reason: req.justification,
        permissionUsed: 'data_correction.request',
      });
      return toCorrection(r.rows[0]!);
    });
  }

  private async ownCorrectionForUpdate(tx: Parameters<Parameters<ApiDeps['txRunner']['withTenantTx']>[1]>[0], ctx: RequestContext, id: string): Promise<Row> {
    const found = await sql<Row>`SELECT * FROM data_correction_request WHERE id = ${id} FOR UPDATE`.execute(tx);
    const row = found.rows[0];
    if (!row || row.tenant_id !== ctx.principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Data correction request '${id}' not found.`);
    }
    return row;
  }

  async decideDataCorrection(ctx: RequestContext, id: string, decision: 'APPROVED' | 'REJECTED'): Promise<DataCorrectionRequest> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await this.ownCorrectionForUpdate(tx, ctx, id);
      const requester = (row.requested_by ?? row.submitted_by ?? row.created_by) as string;
      if (requester === ctx.principal.id) {
        throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-08): the approver must differ from the requester.');
      }
      if (row.status !== 'PENDING') {
        throw AppError.of('INVALID_STATE', `Data correction '${id}' is already in state '${row.status}'.`);
      }
      const r = await sql<Row>`
        UPDATE data_correction_request
           SET status = ${decision}, approved_by = ${ctx.principal.id}, approved_at = ${ctx.now}, lock_version = lock_version + 1
         WHERE id = ${id} RETURNING *`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: decision === 'APPROVED' ? 'data_correction.approved' : 'data_correction.rejected',
        entityType: 'DATA_CORRECTION',
        entityId: id,
        before: { status: 'PENDING' },
        after: { status: decision },
        permissionUsed: 'data_correction.approve',
      });
      return toCorrection(r.rows[0]!);
    });
  }

  async markDataCorrectionExecuted(ctx: RequestContext, id: string): Promise<DataCorrectionRequest> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await this.ownCorrectionForUpdate(tx, ctx, id);
      if (row.status !== 'APPROVED') {
        throw AppError.of('INVALID_STATE', `Data correction must be APPROVED prior to execution (current: ${row.status}).`);
      }
      const r = await sql<Row>`
        UPDATE data_correction_request
           SET status = 'EXECUTED', executed_at = ${ctx.now}, lock_version = lock_version + 1
         WHERE id = ${id} RETURNING *`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'data_correction.executed',
        entityType: 'DATA_CORRECTION',
        entityId: id,
        before: { status: 'APPROVED' },
        after: { status: 'EXECUTED' },
        permissionUsed: 'SERVICE:data-correction-executor',
      });
      return toCorrection(r.rows[0]!);
    });
  }
}

/** Unit-test double with the same rules as the database policies. Not used by the running API. */
/** The flags a unit-test store starts with (the database gets the same ones from migrations 0046 and 0058). */
const DEFAULT_FLAGS: FeatureFlag[] = [
    {
      key: 'bre.v2_engine',
      scope: 'GLOBAL',
      value: true,
      owner: 'Platform Team',
      removeBy: '2026-12-31',
      description: 'Enable next-generation compiled-IR Business Rule Engine',
      lockVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM:platform',
    },
    {
      key: 'lender.instant_submission',
      scope: 'GLOBAL',
      value: true,
      owner: 'Lender Integrations Squad',
      removeBy: null,
      description: 'Direct API dispatch for empanelled lenders',
      lockVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM:platform',
    },
    {
      key: 'mfa.enforce_all',
      scope: 'GLOBAL',
      value: true,
      owner: 'Security Squad',
      removeBy: null,
      description: 'Require TOTP step-up on sensitive operations',
      lockVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM:platform',
    },
    {
      key: 'crm.lead_auto_qualify',
      scope: 'TENANT',
      value: false,
      owner: 'CRM Squad',
      removeBy: '2026-11-30',
      description: 'Automatic qualification when BRE score is above 750',
      lockVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM:platform',
    },
    {
      key: 'whatsapp.notifications_enabled',
      scope: 'GLOBAL',
      value: true,
      owner: 'Messaging Squad',
      removeBy: null,
      description: 'Real-time customer status notifications over WhatsApp',
      lockVersion: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM:platform',
    },
  ];

export class InMemoryPlatformStore implements PlatformStore {
  readonly tenants: PlatformTenantSummary[] = [];
  /** Every audit action the store would have written, in order. */
  readonly audit: string[] = [];
  private flags = new Map<string, FeatureFlag>(DEFAULT_FLAGS.map((f) => [`${f.key}:${f.scope}`, { ...f }]));
  private grants = new Map<string, SupportAccessGrant>();
  private corrections = new Map<string, DataCorrectionRequest>();
  private seq = 0;

  async listFlags(): Promise<FeatureFlag[]> {
    return [...this.flags.values()];
  }

  async getFlag(_ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null> {
    return this.flags.get(`${key}:${scope}`) ?? null;
  }

  async putFlag(ctx: RequestContext, key: string, input: UpdateFeatureFlagRequest, ifMatch: string | undefined): Promise<FeatureFlag> {
    const scope = input.scope ?? 'GLOBAL';
    const flagKey = `${key}:${scope}`;
    const existing = this.flags.get(flagKey);
    if (existing) {
      const expected = ifMatch === undefined ? NaN : parseInt(ifMatch.replace(/"/g, ''), 10);
      if (!Number.isNaN(expected) && existing.lockVersion !== expected) {
        throw AppError.of('VERSION_CONFLICT', `Feature flag '${key}' has been modified by another process. Current version: ${existing.lockVersion}.`);
      }
      const updated: FeatureFlag = {
        key,
        scope,
        value: input.value,
        owner: input.owner ?? existing.owner,
        removeBy: input.removeBy !== undefined ? input.removeBy : existing.removeBy,
        description: input.description ?? existing.description,
        lockVersion: existing.lockVersion + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx.principal.id,
      };
      this.flags.set(flagKey, updated);
      return updated;
    }
    const created: FeatureFlag = {
      key,
      scope,
      value: input.value,
      owner: input.owner ?? 'Platform Admin',
      removeBy: input.removeBy ?? null,
      description: input.description ?? '',
      lockVersion: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.principal.id,
    };
    this.flags.set(flagKey, created);
    return created;
  }

  async listTenants(): Promise<PlatformTenantSummary[]> {
    this.audit.push('platform.tenants_listed');
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
    this.audit.push('platform.support_access_requested');
    return grant;
  }

  async listSupportGrants(ctx: RequestContext, tenantId?: string): Promise<SupportAccessGrant[]> {
    const platform = ctx.principal.tenantId === PLATFORM_TENANT_ID;
    this.audit.push('platform.support_access_listed');
    return [...this.grants.values()].filter((g) => (platform ? !tenantId || g.tenantId === tenantId : g.tenantId === ctx.principal.tenantId));
  }

  private ownGrant(ctx: RequestContext, id: string): SupportAccessGrant {
    const grant = this.grants.get(id);
    if (!grant || grant.tenantId !== ctx.principal.tenantId) throw AppError.of('NOT_FOUND', 'Support access request not found.');
    return grant;
  }

  async decideSupportGrant(ctx: RequestContext, id: string, decision: 'APPROVED' | 'DENIED'): Promise<SupportAccessGrant> {
    const grant = this.ownGrant(ctx, id);
    if (grant.requester === ctx.principal.id) throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-06).');
    if (grant.status !== 'PENDING') throw AppError.of('INVALID_STATE', `Support access request is already ${grant.status}.`);
    grant.status = decision;
    grant.approver = ctx.principal.id;
    grant.updatedAt = ctx.now.toISOString();
    this.audit.push(decision === 'APPROVED' ? 'platform.support_access_approved' : 'platform.support_access_denied');
    return grant;
  }

  async revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant> {
    const grant = this.ownGrant(ctx, id);
    if (grant.status !== 'APPROVED') throw AppError.of('INVALID_STATE', `Only an approved, unexpired access can be revoked (this one is ${grant.status}).`);
    grant.status = 'REVOKED';
    grant.updatedAt = ctx.now.toISOString();
    this.audit.push('platform.support_access_revoked');
    return grant;
  }

  async listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]> {
    return [...this.corrections.values()].filter((c) => c.tenantId === ctx.principal.tenantId);
  }

  async createDataCorrection(ctx: RequestContext, req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest> {
    this.seq += 1;
    const record: DataCorrectionRequest = {
      id: `dcr_test_${this.seq}`,
      tenantId: ctx.principal.tenantId,
      justification: req.justification,
      scriptRef: req.scriptRef,
      dryRunDiffKey: null,
      dryRunDiff: null,
      targetEntity: req.targetEntity,
      changeDescription: req.changeDescription,
      requestedBy: ctx.principal.id,
      approvedBy: null,
      status: 'PENDING',
      executedAt: null,
      executorIdentity: 'SERVICE:data-correction-executor',
      createdAt: ctx.now.toISOString(),
    };
    this.corrections.set(record.id, record);
    this.audit.push('data_correction.requested');
    return record;
  }

  private ownCorrection(ctx: RequestContext, id: string): DataCorrectionRequest {
    const record = this.corrections.get(id);
    if (!record || record.tenantId !== ctx.principal.tenantId) throw AppError.of('NOT_FOUND', `Data correction request '${id}' not found.`);
    return record;
  }

  async decideDataCorrection(ctx: RequestContext, id: string, decision: 'APPROVED' | 'REJECTED'): Promise<DataCorrectionRequest> {
    const record = this.ownCorrection(ctx, id);
    if (record.requestedBy === ctx.principal.id) throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-08): the approver must differ from the requester.');
    if (record.status !== 'PENDING') throw AppError.of('INVALID_STATE', `Data correction '${id}' is already in state '${record.status}'.`);
    record.status = decision;
    record.approvedBy = ctx.principal.id;
    this.audit.push(decision === 'APPROVED' ? 'data_correction.approved' : 'data_correction.rejected');
    return record;
  }

  async markDataCorrectionExecuted(ctx: RequestContext, id: string): Promise<DataCorrectionRequest> {
    const record = this.ownCorrection(ctx, id);
    if (record.status !== 'APPROVED') throw AppError.of('INVALID_STATE', `Data correction must be APPROVED prior to execution (current: ${record.status}).`);
    record.status = 'EXECUTED';
    record.executedAt = ctx.now.toISOString();
    this.audit.push('data_correction.executed');
    return record;
  }
}
