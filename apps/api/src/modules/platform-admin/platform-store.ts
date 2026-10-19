// Persistence for the cross-tenant and tenant-governed parts of platform administration (owner: Dev 1; DSA Notion MODULE 1
// and MODULE 40). Tenant metadata, support-access requests and data corrections live in the database; feature
// flags (app.feature_flag), master data (app.master_data_item) and the release register (app.platform_release) too. Queues and dead letters are
// still sample data in the service: they belong to Release 2 (SUB-ADM.04) and need a design decision, see docs/COMPLETION_TRACKER.md.
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
  type MasterDataImportRequest,
  type MasterDataItem,
  type PlatformTenantSummary,
  type ReleaseRegisterItem,
  type RequestContext,
  type SupportAccessGrant,
  type TenantFeatureFlag,
  type UpdateFeatureFlagRequest,
  type UpdateReleaseRequest,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';

export interface PlatformStore {
  /** Customer tenants only, as metadata. Requires a platform session. */
  listTenants(ctx: RequestContext): Promise<PlatformTenantSummary[]>;
  /** One customer tenant's metadata, or null (an unknown id and the platform tenant itself look the same). */
  getTenant(ctx: RequestContext, tenantId: string): Promise<PlatformTenantSummary | null>;
  /** A platform operator files a request against another tenant. */
  createSupportGrant(ctx: RequestContext, req: CreateSupportAccessRequest): Promise<SupportAccessGrant>;
  /** Platform session: all requests (optionally one tenant). Tenant session: only its own tenant's. */
  listSupportGrants(ctx: RequestContext, tenantId?: string): Promise<SupportAccessGrant[]>;
  /** The target tenant's administrator decides. The requester cannot (SOD-06). */
  decideSupportGrant(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'DENIED',
  ): Promise<SupportAccessGrant>;
  /** The target tenant ends an approved access early. */
  revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant>;

  /** Feature flags are readable by every session; only the platform realm can set them (policies in migration 0050). */
  listFlags(ctx: RequestContext): Promise<FeatureFlag[]>;
  getFlag(ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null>;
  /** Creates or updates a flag. A stale If-Match is a VERSION_CONFLICT. Only on/off flags are stored. */
  putFlag(
    ctx: RequestContext,
    key: string,
    input: UpdateFeatureFlagRequest,
    ifMatch: string | undefined,
  ): Promise<FeatureFlag>;

  /**
   * Every TENANT-scope flag as ONE tenant sees it (default plus that tenant's override). Reads app.feature_flag and
   * app.tenant_feature_flag; it never returns another tenant's override.
   */
  listTenantFlags(ctx: RequestContext, tenantId: string): Promise<TenantFeatureFlag[]>;
  /**
   * Sets one tenant's override of a TENANT-scope flag, in the override table only: app.feature_flag is not written. `expectedVersion` is
   * the override version the caller saw (0 = none yet); any other current version is a VERSION_CONFLICT. An unknown or GLOBAL key is NOT_FOUND.
   */
  putTenantFlag(
    ctx: RequestContext,
    tenantId: string,
    key: string,
    value: boolean,
    expectedVersion: number,
  ): Promise<TenantFeatureFlag>;

  /** Master data lists, readable by every session; written by the platform realm only. Dataset names are stored lower case, list codes are upper case. */
  listMasterData(ctx: RequestContext, listCode?: string): Promise<Record<string, MasterDataItem[]>>;
  importMasterData(ctx: RequestContext, req: MasterDataImportRequest): Promise<MasterDataImportResult>;

  /** The release register: platform realm only, for reading and writing. */
  listReleases(ctx: RequestContext): Promise<ReleaseRegisterItem[]>;
  updateRelease(
    ctx: RequestContext,
    version: string,
    patch: UpdateReleaseRequest,
    ifMatch: string | undefined,
  ): Promise<ReleaseRegisterItem>;

  /** The caller's own tenant only. */
  listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]>;
  createDataCorrection(ctx: RequestContext, req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest>;
  /** SOD-08: the approver is not the requester. */
  decideDataCorrection(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<DataCorrectionRequest>;
  /** Only the correction executor (a service identity) calls this, on an APPROVED correction. */
  markDataCorrectionExecuted(ctx: RequestContext, id: string): Promise<DataCorrectionRequest>;
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** DB status ACTIVE is APPROVED in the API, and an approved grant past its window reads as EXPIRED. */
export function grantStatus(status: string, expiresAt: unknown, now: Date): SupportAccessGrant['status'] {
  if (status === 'ACTIVE')
    return new Date(String(expiresAt)).getTime() <= now.getTime() ? 'EXPIRED' : 'APPROVED';
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
  failureReason: (r.failure_reason as string | null) ?? null,
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

const toTenantSummary = (x: Row): PlatformTenantSummary => ({
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
});

/** What the tenant page shows for one flag: the platform default, and the tenant's override when it has one. */
const toTenantFlag = (
  tenantId: string,
  def: { key: string; description: string | null; owner: string; value: boolean },
  override: {
    value: boolean;
    lock_version: number | string;
    updated_at: string | Date;
    updated_by: string;
  } | null,
): TenantFeatureFlag => ({
  tenantId,
  key: def.key,
  scope: 'TENANT',
  description: def.description ?? '',
  owner: def.owner,
  defaultValue: def.value,
  value: override ? override.value : def.value,
  overridden: override !== null,
  lockVersion: override ? Number(override.lock_version) : 0,
  updatedAt: override ? new Date(override.updated_at).toISOString() : null,
  updatedBy: override ? override.updated_by : null,
});

export interface MasterDataImportResult {
  dryRun: boolean;
  listCode: string;
  totalSubmitted: number;
  newItemsCount: number;
  updatedItemsCount: number;
  preview: MasterDataItem[];
}

type MasterRow = {
  dataset: string;
  code: string;
  label: string;
  is_active: boolean;
  metadata: Record<string, unknown> | null;
  lock_version: number | string;
  created_at: string | Date;
};

const toMasterItem = (r: MasterRow): MasterDataItem => ({
  id: `md_${r.dataset}_${r.code}`,
  listCode: r.dataset.toUpperCase(),
  code: r.code,
  label: r.label,
  attributes: r.metadata ?? {},
  version: Number(r.lock_version),
  active: r.is_active,
  createdAt: new Date(r.created_at).toISOString(),
});

type ReleaseRow = {
  version: string;
  status: ReleaseRegisterItem['status'];
  target_date: string | Date;
  git_tag: string | null;
  release_notes_ref: string;
  rule_pack_version: string;
  migration_version: string;
  gates: ReleaseRegisterItem['gates'];
  notes_summary: string;
  lock_version: number | string;
};

const toRelease = (r: ReleaseRow): ReleaseRegisterItem => ({
  version: r.version,
  lockVersion: Number(r.lock_version),
  status: r.status,
  targetDate: dateOnly(r.target_date) ?? '',
  gitTag: r.git_tag,
  releaseNotesRef: r.release_notes_ref,
  rulePackVersion: r.rule_pack_version,
  migrationVersion: r.migration_version,
  gates: r.gates,
  notesSummary: r.notes_summary,
});

const RELEASE_COLUMNS = sql.raw(
  'version, status, target_date, git_tag, release_notes_ref, rule_pack_version, migration_version, gates, notes_summary, lock_version',
);

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
      return r.rows.map(toTenantSummary);
    });
  }

  async getTenant(ctx: RequestContext, tenantId: string): Promise<PlatformTenantSummary | null> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        SELECT t.id, t.slug, t.legal_name, t.tenant_type, t.data_region, t.timezone, t.status, t.created_at, t.created_by,
               COALESCE(c.active_users, 0) AS active_users
          FROM tenant t
          LEFT JOIN platform_tenant_user_counts() c ON c.tenant_id = t.id
         WHERE t.id = ${tenantId} AND t.tenant_type <> 'PLATFORM'`.execute(tx);
      return r.rows[0] ? toTenantSummary(r.rows[0]) : null;
    });
  }

  // ---- support access -------------------------------------------------------------------------------------------
  async createSupportGrant(
    ctx: RequestContext,
    req: CreateSupportAccessRequest,
  ): Promise<SupportAccessGrant> {
    if (req.tenantId === PLATFORM_TENANT_ID) {
      throw AppError.of('VALIDATION_ERROR', 'Support access is requested against a customer tenant.', [
        { field: 'tenantId', issue: 'INVALID' },
      ]);
    }
    const id = this.deps.ids.next('sag');
    const ends = new Date(ctx.now.getTime() + req.durationHours * 3600 * 1000);
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const target =
        await sql<Row>`SELECT id FROM tenant WHERE id = ${req.tenantId} AND tenant_type <> 'PLATFORM'`.execute(
          tx,
        );
      if (!target.rows[0]) {
        throw AppError.of('VALIDATION_ERROR', 'That tenant does not exist.', [
          { field: 'tenantId', issue: 'NOT_FOUND' },
        ]);
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
        after: {
          targetTenantId: req.tenantId,
          incidentRef: req.incidentRef,
          scope: req.scope,
          durationHours: req.durationHours,
        },
        reason: req.reason,
        permissionUsed: 'platform.support_access',
      });
      const r =
        await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(
          tx,
        );
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
        permissionUsed: ctx.principal.grants.some((g) => g.code === 'platform.support_access')
          ? 'platform.support_access'
          : 'config.manage',
      });
      return r.rows.map((x) => toGrant(x, ctx.now));
    });
  }

  /** A grant that belongs to the caller's tenant, locked. Another tenant's grant reads as missing. */
  private async ownGrantForUpdate(
    tx: Parameters<Parameters<ApiDeps['txRunner']['withTenantTx']>[1]>[0],
    ctx: RequestContext,
    id: string,
  ): Promise<Row> {
    const found = await sql<Row>`SELECT * FROM support_access_grant WHERE id = ${id} FOR UPDATE`.execute(tx);
    const grant = found.rows[0];
    if (!grant || grant.tenant_id !== ctx.principal.tenantId) {
      throw AppError.of('NOT_FOUND', 'Support access request not found.');
    }
    return grant;
  }

  async decideSupportGrant(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'DENIED',
  ): Promise<SupportAccessGrant> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const grant = await this.ownGrantForUpdate(tx, ctx, id);
      if (grant.support_user_id === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties violation (SOD-06): the requester cannot approve their own support access request.',
        );
      }
      if (grant.status !== 'PENDING') {
        throw AppError.of(
          'INVALID_STATE',
          `Support access request is already ${grantStatus(String(grant.status), grant.expires_at, ctx.now)}.`,
        );
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
        action:
          decision === 'APPROVED' ? 'platform.support_access_approved' : 'platform.support_access_denied',
        entityType: 'SUPPORT_ACCESS_GRANT',
        entityId: id,
        before: { status: grant.status },
        after: { status: next },
        permissionUsed: 'config.manage',
      });
      const r =
        await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(
          tx,
        );
      return toGrant(r.rows[0]!, ctx.now);
    });
  }

  async revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const grant = await this.ownGrantForUpdate(tx, ctx, id);
      const current = grantStatus(String(grant.status), grant.expires_at, ctx.now);
      if (current !== 'APPROVED') {
        throw AppError.of(
          'INVALID_STATE',
          `Only an approved, unexpired access can be revoked (this one is ${current}).`,
        );
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
      const r =
        await sql<Row>`SELECT ${GRANT_COLUMNS} FROM support_access_grant g JOIN tenant t ON t.id = g.tenant_id WHERE g.id = ${id}`.execute(
          tx,
        );
      return toGrant(r.rows[0]!, ctx.now);
    });
  }

  // ---- data corrections (tenant realm) ----------------------------------------------------------------------------
  async listFlags(ctx: RequestContext): Promise<FeatureFlag[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r =
        await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                     FROM feature_flag ORDER BY key, scope`.execute(tx);
      return r.rows.map(toFlag);
    });
  }

  async getFlag(ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r =
        await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                     FROM feature_flag WHERE key = ${key} AND scope = ${scope}`.execute(tx);
      return r.rows[0] ? toFlag(r.rows[0]) : null;
    });
  }

  async putFlag(
    ctx: RequestContext,
    key: string,
    input: UpdateFeatureFlagRequest,
    ifMatch: string | undefined,
  ): Promise<FeatureFlag> {
    if (typeof input.value !== 'boolean') {
      throw AppError.of('VALIDATION_ERROR', 'Only on/off feature flags are supported.', [
        { field: 'value', issue: 'MUST_BE_BOOLEAN' },
      ]);
    }
    const scope = input.scope ?? 'GLOBAL';
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const found =
        await sql<FlagRow>`SELECT key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by
                                         FROM feature_flag WHERE key = ${key} AND scope = ${scope} FOR UPDATE`.execute(
          tx,
        );
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
           RETURNING key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by`.execute(
          tx,
        );
        // Row-level security lets only the platform realm update a flag: no row back means this session may not.
        if (!updated.rows[0])
          throw AppError.of('FORBIDDEN', 'Only the platform realm can change feature flags.');
        return toFlag(updated.rows[0]);
      }
      const created = await sql<FlagRow>`
        INSERT INTO feature_flag (key, scope, value, owner, remove_by, description, lock_version, updated_by)
        VALUES (${key}, ${scope}, ${input.value}, ${input.owner ?? 'Platform Admin'}, ${input.removeBy ?? null}::date,
                ${input.description ?? ''}, 1, ${ctx.principal.id})
        RETURNING key, scope, value, owner, remove_by, description, lock_version, updated_at, updated_by`.execute(
        tx,
      );
      return toFlag(created.rows[0]!);
    });
  }

  async listTenantFlags(ctx: RequestContext, tenantId: string): Promise<TenantFeatureFlag[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        SELECT f.key, f.description, f.owner, f.value AS default_value,
               o.value AS override_value, o.lock_version AS override_version, o.updated_at AS override_updated_at, o.updated_by AS override_updated_by
          FROM feature_flag f
          LEFT JOIN tenant_feature_flag o ON o.key = f.key AND o.tenant_id = ${tenantId}
         WHERE f.scope = 'TENANT'
         ORDER BY f.key`.execute(tx);
      return r.rows.map((x) =>
        toTenantFlag(
          tenantId,
          {
            key: String(x.key),
            description: (x.description as string | null) ?? null,
            owner: String(x.owner),
            value: Boolean(x.default_value),
          },
          x.override_version === null
            ? null
            : {
                value: Boolean(x.override_value),
                lock_version: x.override_version as number | string,
                updated_at: x.override_updated_at as string | Date,
                updated_by: String(x.override_updated_by),
              },
        ),
      );
    });
  }

  async putTenantFlag(
    ctx: RequestContext,
    tenantId: string,
    key: string,
    value: boolean,
    expectedVersion: number,
  ): Promise<TenantFeatureFlag> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // The definition must be a TENANT-scope flag. A GLOBAL flag (or a typo) is not found here, whatever the caller sends.
      const def = (
        await sql<Row>`SELECT key, description, owner, value FROM feature_flag WHERE key = ${key} AND scope = 'TENANT'`.execute(
          tx,
        )
      ).rows[0];
      if (!def) throw AppError.of('NOT_FOUND', `Feature flag '${key}' is not a tenant-scoped flag.`);
      const definition = {
        key: String(def.key),
        description: (def.description as string | null) ?? null,
        owner: String(def.owner),
        value: Boolean(def.value),
      };

      const existing = (
        await sql<Row>`SELECT value, lock_version, updated_at, updated_by FROM tenant_feature_flag
                        WHERE tenant_id = ${tenantId} AND key = ${key} FOR UPDATE`.execute(tx)
      ).rows[0];
      const current = existing ? Number(existing.lock_version) : 0;
      if (current !== expectedVersion) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Feature flag '${key}' for this tenant has been modified by another process. Current version: ${current}.`,
        );
      }

      let saved: Row;
      if (existing) {
        const updated = await sql<Row>`
          UPDATE tenant_feature_flag SET value = ${value}, lock_version = lock_version + 1, updated_at = now(), updated_by = ${ctx.principal.id}
           WHERE tenant_id = ${tenantId} AND key = ${key}
           RETURNING value, lock_version, updated_at, updated_by`.execute(tx);
        // Row-level security lets only the platform realm update an override: no row back means this session may not.
        if (!updated.rows[0])
          throw AppError.of('FORBIDDEN', 'Only the platform realm can change tenant feature flags.');
        saved = updated.rows[0];
      } else {
        const created = await sql<Row>`
          INSERT INTO tenant_feature_flag (tenant_id, key, scope, value, lock_version, updated_by)
          VALUES (${tenantId}, ${key}, 'TENANT', ${value}, 1, ${ctx.principal.id})
          RETURNING value, lock_version, updated_at, updated_by`.execute(tx);
        saved = created.rows[0]!;
      }
      await this.deps.audit.record(tx, ctx, {
        action: 'platform.tenant_flag_set',
        entityType: 'TENANT_FEATURE_FLAG',
        entityId: `${tenantId}:${key}`,
        after: { tenantId, key, value, defaultValue: definition.value },
        permissionUsed: 'platform.flags',
      });
      return toTenantFlag(tenantId, definition, {
        value: Boolean(saved.value),
        lock_version: saved.lock_version as number | string,
        updated_at: saved.updated_at as string | Date,
        updated_by: String(saved.updated_by),
      });
    });
  }

  async listMasterData(ctx: RequestContext, listCode?: string): Promise<Record<string, MasterDataItem[]>> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const dataset = listCode?.toLowerCase();
      const r = await sql<MasterRow>`
        SELECT dataset, code, label, is_active, metadata, lock_version, created_at FROM master_data_item
         WHERE ${dataset === undefined ? sql`true` : sql`dataset = ${dataset}`} ORDER BY dataset, code`.execute(
        tx,
      );
      const out: Record<string, MasterDataItem[]> =
        dataset === undefined ? {} : { [dataset.toUpperCase()]: [] };
      for (const row of r.rows) (out[row.dataset.toUpperCase()] ??= []).push(toMasterItem(row));
      return out;
    });
  }

  async importMasterData(ctx: RequestContext, req: MasterDataImportRequest): Promise<MasterDataImportResult> {
    const dataset = req.listCode.toLowerCase();
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const existing = new Map(
        (
          await sql<MasterRow>`SELECT dataset, code, label, is_active, metadata, lock_version, created_at FROM master_data_item WHERE dataset = ${dataset} FOR UPDATE`.execute(
            tx,
          )
        ).rows.map((r) => [r.code, r]),
      );
      let newCount = 0;
      let updateCount = 0;
      const preview: MasterDataItem[] = [];
      for (const item of req.items) {
        const current = existing.get(item.code);
        if (current) updateCount += 1;
        else newCount += 1;
        const version = current ? Number(current.lock_version) + 1 : 1;
        if (!req.dryRun) {
          const written = await sql<MasterRow>`
            INSERT INTO master_data_item (dataset, code, label, is_active, metadata, lock_version, created_by)
            VALUES (${dataset}, ${item.code}, ${item.label}, true, ${JSON.stringify(item.attributes ?? {})}::jsonb, 1, ${ctx.principal.id})
            ON CONFLICT (dataset, code) DO UPDATE
               SET label = EXCLUDED.label, metadata = EXCLUDED.metadata, is_active = true, lock_version = master_data_item.lock_version + 1
            RETURNING dataset, code, label, is_active, metadata, lock_version, created_at`.execute(tx);
          // Row-level security lets only the platform realm write master data: no row back means this session may not.
          if (!written.rows[0])
            throw AppError.of('FORBIDDEN', 'Only the platform realm can change master data.');
          preview.push(toMasterItem(written.rows[0]));
        } else {
          preview.push({
            id: `md_${dataset}_${item.code}`,
            listCode: dataset.toUpperCase(),
            code: item.code,
            label: item.label,
            attributes: item.attributes ?? {},
            version,
            active: true,
            createdAt: ctx.now.toISOString(),
          });
        }
      }
      return {
        dryRun: !!req.dryRun,
        listCode: dataset.toUpperCase(),
        totalSubmitted: req.items.length,
        newItemsCount: newCount,
        updatedItemsCount: updateCount,
        preview,
      };
    });
  }

  async listReleases(ctx: RequestContext): Promise<ReleaseRegisterItem[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r =
        await sql<ReleaseRow>`SELECT ${RELEASE_COLUMNS} FROM platform_release ORDER BY target_date DESC, version DESC`.execute(
          tx,
        );
      return r.rows.map(toRelease);
    });
  }

  async updateRelease(
    ctx: RequestContext,
    version: string,
    patch: UpdateReleaseRequest,
    ifMatch: string | undefined,
  ): Promise<ReleaseRegisterItem> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const found =
        await sql<ReleaseRow>`SELECT ${RELEASE_COLUMNS} FROM platform_release WHERE version = ${version} FOR UPDATE`.execute(
          tx,
        );
      const current = found.rows[0];
      if (!current) throw AppError.of('NOT_FOUND', `Release ${version} was not found.`);
      const expected = ifMatch === undefined ? NaN : parseInt(ifMatch.replace(/"/g, ''), 10);
      if (!Number.isNaN(expected) && Number(current.lock_version) !== expected) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Release ${version} was changed by someone else. Current version: ${current.lock_version}.`,
        );
      }
      const gates = { ...current.gates, ...(patch.gates ?? {}) };
      const updated = await sql<ReleaseRow>`
        UPDATE platform_release SET status = ${patch.status ?? current.status},
               git_tag = ${patch.gitTag === undefined ? current.git_tag : patch.gitTag},
               gates = ${JSON.stringify(gates)}::jsonb, notes_summary = ${patch.notesSummary ?? current.notes_summary},
               lock_version = lock_version + 1, updated_at = now(), updated_by = ${ctx.principal.id}
         WHERE version = ${version} RETURNING ${RELEASE_COLUMNS}`.execute(tx);
      if (!updated.rows[0])
        throw AppError.of('FORBIDDEN', 'Only the platform realm can change the release register.');
      await this.deps.audit.record(tx, ctx, {
        action: 'release.updated',
        entityType: 'RELEASE',
        entityId: version,
        before: { status: current.status, gitTag: current.git_tag, gates: current.gates },
        after: {
          status: updated.rows[0].status,
          gitTag: updated.rows[0].git_tag,
          gates: updated.rows[0].gates,
        },
        permissionUsed: 'platform.release',
      });
      return toRelease(updated.rows[0]);
    });
  }

  async listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`SELECT * FROM data_correction_request ORDER BY created_at DESC, id`.execute(
        tx,
      );
      return r.rows.map(toCorrection);
    });
  }

  async createDataCorrection(
    ctx: RequestContext,
    req: CreateDataCorrectionRequest,
  ): Promise<DataCorrectionRequest> {
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

  private async ownCorrectionForUpdate(
    tx: Parameters<Parameters<ApiDeps['txRunner']['withTenantTx']>[1]>[0],
    ctx: RequestContext,
    id: string,
  ): Promise<Row> {
    const found = await sql<Row>`SELECT * FROM data_correction_request WHERE id = ${id} FOR UPDATE`.execute(
      tx,
    );
    const row = found.rows[0];
    if (!row || row.tenant_id !== ctx.principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Data correction request '${id}' not found.`);
    }
    return row;
  }

  async decideDataCorrection(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<DataCorrectionRequest> {
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const row = await this.ownCorrectionForUpdate(tx, ctx, id);
      const requester = (row.requested_by ?? row.submitted_by ?? row.created_by) as string;
      if (requester === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties violation (SOD-08): the approver must differ from the requester.',
        );
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
        throw AppError.of(
          'INVALID_STATE',
          `Data correction must be APPROVED prior to execution (current: ${row.status}).`,
        );
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

/** The master data a unit-test store starts with (the database gets the same lists from migration 0061). */
const DEFAULT_MASTER_DATA: Array<[string, string, string, Record<string, unknown>]> = [
  ['PINCODES', '400008', 'Mumbai Central', { state: 'Maharashtra', tier: 1 }],
  ['PINCODES', '411001', 'Pune Camp', { state: 'Maharashtra', tier: 2 }],
  ['PINCODES', '560001', 'Bangalore GPO', { state: 'Karnataka', tier: 1 }],
  ['PINCODES', '110001', 'New Delhi Connaught Place', { state: 'Delhi', tier: 1 }],
  ['STATES', 'MH', 'Maharashtra', { gstCode: '27', region: 'WEST' }],
  ['STATES', 'KA', 'Karnataka', { gstCode: '29', region: 'SOUTH' }],
  ['STATES', 'DL', 'Delhi', { gstCode: '07', region: 'NORTH' }],
  ['STATES', 'TN', 'Tamil Nadu', { gstCode: '33', region: 'SOUTH' }],
  ['OCCUPATIONS', 'SALARIED_PVT', 'Salaried Private Sector', { category: 'SALARIED', riskWeight: 1.0 }],
  ['OCCUPATIONS', 'SALARIED_GOVT', 'Salaried Government / PSU', { category: 'SALARIED', riskWeight: 0.8 }],
  ['OCCUPATIONS', 'SELF_EMP_PROF', 'Self Employed Professional', { category: 'SEP', riskWeight: 1.2 }],
  ['OCCUPATIONS', 'SELF_EMP_BIZ', 'Self Employed Business Owner', { category: 'SENP', riskWeight: 1.4 }],
  ['REASON_CODES', 'INSUFFICIENT_INCOME', 'Monthly income below policy threshold', { category: 'FINANCIAL' }],
  ['REASON_CODES', 'LOW_CREDIT_SCORE', 'CIBIL score below lender requirement', { category: 'CREDIT' }],
  ['REASON_CODES', 'INCOMPLETE_DOCUMENTS', 'Mandatory KYC or income proof missing', { category: 'DOCUMENT' }],
  ['REASON_CODES', 'CUSTOMER_OPT_OUT', 'Customer declined loan terms or withdrawn', { category: 'BUSINESS' }],
];

/** Unit-test double with the same rules as the database policies. Not used by the running API. */
export class InMemoryPlatformStore implements PlatformStore {
  readonly tenants: PlatformTenantSummary[] = [];
  /** Every audit action the store would have written, in order. */
  readonly audit: string[] = [];
  private flags = new Map<string, FeatureFlag>(DEFAULT_FLAGS.map((f) => [`${f.key}:${f.scope}`, { ...f }]));
  private masterData = new Map<string, MasterDataItem[]>();
  private releases = new Map<string, ReleaseRegisterItem>([
    [
      'v0.1.0-rc.1',
      {
        version: 'v0.1.0-rc.1',
        lockVersion: 1,
        status: 'CANDIDATE',
        targetDate: '2026-10-14',
        gitTag: null,
        releaseNotesRef: 'RELEASE_NOTES_v0.1.0-rc.1.md',
        rulePackVersion: 'M-010 (20261001000010_rules_core.sql)',
        migrationVersion: 'M-061 (20261001000061_master_data_and_release_register.sql)',
        gates: { rel001: false, rel002: false, rel003: false, rel004: false },
        notesSummary: 'Workflow A walking-skeleton MVP internal pilot candidate on synthetic data only.',
      },
    ],
  ]);

  constructor() {
    for (const [list, code, label, attributes] of DEFAULT_MASTER_DATA) {
      const items = this.masterData.get(list) ?? [];
      items.push({
        id: `md_${list.toLowerCase()}_${code}`,
        listCode: list,
        code,
        label,
        attributes,
        version: 1,
        active: true,
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      this.masterData.set(list, items);
    }
  }
  private grants = new Map<string, SupportAccessGrant>();
  private corrections = new Map<string, DataCorrectionRequest>();
  private seq = 0;

  async listFlags(): Promise<FeatureFlag[]> {
    return [...this.flags.values()];
  }

  async getFlag(_ctx: RequestContext, key: string, scope: string): Promise<FeatureFlag | null> {
    return this.flags.get(`${key}:${scope}`) ?? null;
  }

  async putFlag(
    ctx: RequestContext,
    key: string,
    input: UpdateFeatureFlagRequest,
    ifMatch: string | undefined,
  ): Promise<FeatureFlag> {
    const scope = input.scope ?? 'GLOBAL';
    const flagKey = `${key}:${scope}`;
    const existing = this.flags.get(flagKey);
    if (existing) {
      const expected = ifMatch === undefined ? NaN : parseInt(ifMatch.replace(/"/g, ''), 10);
      if (!Number.isNaN(expected) && existing.lockVersion !== expected) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Feature flag '${key}' has been modified by another process. Current version: ${existing.lockVersion}.`,
        );
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

  async listMasterData(_ctx: RequestContext, listCode?: string): Promise<Record<string, MasterDataItem[]>> {
    if (listCode)
      return { [listCode.toUpperCase()]: [...(this.masterData.get(listCode.toUpperCase()) ?? [])] };
    return Object.fromEntries([...this.masterData.entries()].map(([k, v]) => [k, [...v]]));
  }

  async importMasterData(ctx: RequestContext, req: MasterDataImportRequest): Promise<MasterDataImportResult> {
    const listCode = req.listCode.toUpperCase();
    const existing = this.masterData.get(listCode) ?? [];
    const byCode = new Map(existing.map((i) => [i.code, i]));
    let newCount = 0;
    let updateCount = 0;
    const processed: MasterDataItem[] = req.items.map((item) => {
      const current = byCode.get(item.code);
      if (current) updateCount += 1;
      else newCount += 1;
      return {
        id: `md_${listCode.toLowerCase()}_${item.code}`,
        listCode,
        code: item.code,
        label: item.label,
        attributes: item.attributes ?? {},
        version: current ? current.version + 1 : 1,
        active: true,
        createdAt: ctx.now.toISOString(),
      };
    });
    if (!req.dryRun)
      this.masterData.set(listCode, [
        ...existing.filter((e) => !req.items.some((i) => i.code === e.code)),
        ...processed,
      ]);
    return {
      dryRun: !!req.dryRun,
      listCode,
      totalSubmitted: req.items.length,
      newItemsCount: newCount,
      updatedItemsCount: updateCount,
      preview: processed,
    };
  }

  async listReleases(): Promise<ReleaseRegisterItem[]> {
    return [...this.releases.values()];
  }

  async updateRelease(
    ctx: RequestContext,
    version: string,
    patch: UpdateReleaseRequest,
    ifMatch: string | undefined,
  ): Promise<ReleaseRegisterItem> {
    const current = this.releases.get(version);
    if (!current) throw AppError.of('NOT_FOUND', `Release ${version} was not found.`);
    const expected = ifMatch === undefined ? NaN : parseInt(ifMatch.replace(/"/g, ''), 10);
    if (!Number.isNaN(expected) && current.lockVersion !== expected) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Release ${version} was changed by someone else. Current version: ${current.lockVersion}.`,
      );
    }
    const updated: ReleaseRegisterItem = {
      ...current,
      status: patch.status ?? current.status,
      gitTag: patch.gitTag === undefined ? current.gitTag : patch.gitTag,
      gates: { ...current.gates, ...(patch.gates ?? {}) },
      notesSummary: patch.notesSummary ?? current.notesSummary,
      lockVersion: (current.lockVersion ?? 1) + 1,
    };
    this.audit.push('release.updated');
    this.releases.set(version, updated);
    return updated;
  }

  async listTenants(): Promise<PlatformTenantSummary[]> {
    this.audit.push('platform.tenants_listed');
    return [...this.tenants];
  }

  async getTenant(_ctx: RequestContext, tenantId: string): Promise<PlatformTenantSummary | null> {
    return this.tenants.find((t) => t.id === tenantId) ?? null;
  }

  /** Per-tenant overrides, keyed by tenant then flag, like the table behind them. */
  private tenantFlags = new Map<
    string,
    { value: boolean; lockVersion: number; updatedAt: string; updatedBy: string }
  >();

  private tenantFlagView(tenantId: string, def: FeatureFlag): TenantFeatureFlag {
    const o = this.tenantFlags.get(`${tenantId}:${def.key}`);
    return {
      tenantId,
      key: def.key,
      scope: 'TENANT',
      description: def.description ?? '',
      owner: def.owner,
      defaultValue: def.value === true,
      value: o ? o.value : def.value === true,
      overridden: o !== undefined,
      lockVersion: o ? o.lockVersion : 0,
      updatedAt: o ? o.updatedAt : null,
      updatedBy: o ? o.updatedBy : null,
    };
  }

  async listTenantFlags(_ctx: RequestContext, tenantId: string): Promise<TenantFeatureFlag[]> {
    return [...this.flags.values()]
      .filter((f) => f.scope === 'TENANT')
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((f) => this.tenantFlagView(tenantId, f));
  }

  async putTenantFlag(
    ctx: RequestContext,
    tenantId: string,
    key: string,
    value: boolean,
    expectedVersion: number,
  ): Promise<TenantFeatureFlag> {
    const def = this.flags.get(`${key}:TENANT`);
    if (!def) throw AppError.of('NOT_FOUND', `Feature flag '${key}' is not a tenant-scoped flag.`);
    const id = `${tenantId}:${key}`;
    const existing = this.tenantFlags.get(id);
    const current = existing ? existing.lockVersion : 0;
    if (current !== expectedVersion) {
      throw AppError.of(
        'VERSION_CONFLICT',
        `Feature flag '${key}' for this tenant has been modified by another process. Current version: ${current}.`,
      );
    }
    this.tenantFlags.set(id, {
      value,
      lockVersion: current + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.principal.id,
    });
    this.audit.push('platform.tenant_flag_set');
    return this.tenantFlagView(tenantId, def);
  }

  async createSupportGrant(
    ctx: RequestContext,
    req: CreateSupportAccessRequest,
  ): Promise<SupportAccessGrant> {
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
    return [...this.grants.values()].filter((g) =>
      platform ? !tenantId || g.tenantId === tenantId : g.tenantId === ctx.principal.tenantId,
    );
  }

  private ownGrant(ctx: RequestContext, id: string): SupportAccessGrant {
    const grant = this.grants.get(id);
    if (!grant || grant.tenantId !== ctx.principal.tenantId)
      throw AppError.of('NOT_FOUND', 'Support access request not found.');
    return grant;
  }

  async decideSupportGrant(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'DENIED',
  ): Promise<SupportAccessGrant> {
    const grant = this.ownGrant(ctx, id);
    if (grant.requester === ctx.principal.id)
      throw AppError.of('SOD_VIOLATION', 'Separation of Duties violation (SOD-06).');
    if (grant.status !== 'PENDING')
      throw AppError.of('INVALID_STATE', `Support access request is already ${grant.status}.`);
    grant.status = decision;
    grant.approver = ctx.principal.id;
    grant.updatedAt = ctx.now.toISOString();
    this.audit.push(
      decision === 'APPROVED' ? 'platform.support_access_approved' : 'platform.support_access_denied',
    );
    return grant;
  }

  async revokeSupportGrant(ctx: RequestContext, id: string): Promise<SupportAccessGrant> {
    const grant = this.ownGrant(ctx, id);
    if (grant.status !== 'APPROVED')
      throw AppError.of(
        'INVALID_STATE',
        `Only an approved, unexpired access can be revoked (this one is ${grant.status}).`,
      );
    grant.status = 'REVOKED';
    grant.updatedAt = ctx.now.toISOString();
    this.audit.push('platform.support_access_revoked');
    return grant;
  }

  async listDataCorrections(ctx: RequestContext): Promise<DataCorrectionRequest[]> {
    return [...this.corrections.values()].filter((c) => c.tenantId === ctx.principal.tenantId);
  }

  async createDataCorrection(
    ctx: RequestContext,
    req: CreateDataCorrectionRequest,
  ): Promise<DataCorrectionRequest> {
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
    if (!record || record.tenantId !== ctx.principal.tenantId)
      throw AppError.of('NOT_FOUND', `Data correction request '${id}' not found.`);
    return record;
  }

  async decideDataCorrection(
    ctx: RequestContext,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<DataCorrectionRequest> {
    const record = this.ownCorrection(ctx, id);
    if (record.requestedBy === ctx.principal.id)
      throw AppError.of(
        'SOD_VIOLATION',
        'Separation of Duties violation (SOD-08): the approver must differ from the requester.',
      );
    if (record.status !== 'PENDING')
      throw AppError.of('INVALID_STATE', `Data correction '${id}' is already in state '${record.status}'.`);
    record.status = decision;
    record.approvedBy = ctx.principal.id;
    this.audit.push(decision === 'APPROVED' ? 'data_correction.approved' : 'data_correction.rejected');
    return record;
  }

  async markDataCorrectionExecuted(ctx: RequestContext, id: string): Promise<DataCorrectionRequest> {
    const record = this.ownCorrection(ctx, id);
    if (record.status !== 'APPROVED')
      throw AppError.of(
        'INVALID_STATE',
        `Data correction must be APPROVED prior to execution (current: ${record.status}).`,
      );
    record.status = 'EXECUTED';
    record.executedAt = ctx.now.toISOString();
    this.audit.push('data_correction.executed');
    return record;
  }
}
