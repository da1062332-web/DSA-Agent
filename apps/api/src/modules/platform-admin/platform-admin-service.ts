// apps/api/src/modules/platform-admin/platform-admin-service.ts
// Module: platform-admin — owner: Platform squad (MOD-ADM: SUB-ADM.01 to SUB-ADM.08)
import {
  AppError,
  type ApproveDataCorrectionRequest,
  type ApproveSupportAccessRequest,
  type CreateDataCorrectionRequest,
  type CreateSupportAccessRequest,
  type DataCorrectionRequest,
  type DeadLetterItem,
  type FeatureFlag,
  type JobQueueInfo,
  type ListPlatformTenantsQuery,
  type MasterDataImportRequest,
  type MasterDataItem,
  type PauseQueueRequest,
  type PlatformTenantSummary,
  type ReleaseRegisterItem,
  type RequestContext,
  type ResumeQueueRequest,
  type SupportAccessGrant,
  type SystemHealthReport,
  type UpdateFeatureFlagRequest,
  type UpdateReleaseRequest,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';
import { PgPlatformStore, type MasterDataImportResult, type PlatformStore } from './platform-store';

/** Shown with the queue figures, which are sample data until the Release 2 job console is built on real queues. */
const SAMPLE_JOBS_NOTICE =
  'Sample data. These queue figures and dead letters are not read from a real queue; pausing or replaying here changes nothing that processes work. The job console is planned for Release 2.';

/** A probe slower than this makes the database DEGRADED in the health report. */
const DB_DEGRADED_LATENCY_MS = 500;

export class PlatformAdminService {
  private queues: Map<string, JobQueueInfo> = new Map();
  private deadLetters: Map<string, DeadLetterItem> = new Map();
  private startTimestamp: number = Date.now();

  private readonly store: PlatformStore;

  /** Tenant metadata, support access and data corrections are stored in the database (platform-store.ts). Flags, master data, queues and releases are still in memory. */
  constructor(private readonly deps: ApiDeps, store?: PlatformStore) {
    this.store = store ?? new PgPlatformStore(deps);
    this.seedDefaults();
  }

  private seedDefaults() {

    // ----------------------------------------------------
    // Seed Master Data Items (SUB-ADM.03)
    // ----------------------------------------------------
    // ----------------------------------------------------
    // Seed Queues and Dead Letters (SUB-ADM.04)
    // ----------------------------------------------------
    const defaultQueues: JobQueueInfo[] = [
      { queue: 'outbox-relay', activeJobs: 0, failedJobs: 0, delayedJobs: 0, completedJobs: 1420, paused: false },
      { queue: 'bre-evaluations', activeJobs: 2, failedJobs: 1, delayedJobs: 0, completedJobs: 8940, paused: false },
      { queue: 'notifications-dispatch', activeJobs: 0, failedJobs: 0, delayedJobs: 3, completedJobs: 5120, paused: false },
      { queue: 'document-processing', activeJobs: 1, failedJobs: 2, delayedJobs: 1, completedJobs: 3200, paused: false },
      { queue: 'webhook-delivery', activeJobs: 0, failedJobs: 0, delayedJobs: 0, completedJobs: 1105, paused: false },
    ];
    for (const q of defaultQueues) {
      this.queues.set(q.queue, q);
    }

    const defaultDeadLetters: DeadLetterItem[] = [
      {
        id: 'dl_01JTESTDL0000000000000001',
        queue: 'bre-evaluations',
        originalJobId: 'job_bre_9012',
        payload: { ruleSet: 'RS-AUTO-ELIG', applicantIncome: 45000 },
        errorReason: 'Remote bureau gateway timeout after 5000ms',
        failedAt: new Date(Date.now() - 3600000).toISOString(),
        retryCount: 3,
        status: 'UNRESOLVED',
      },
      {
        id: 'dl_01JTESTDL0000000000000002',
        queue: 'document-processing',
        originalJobId: 'job_doc_4412',
        payload: { documentId: 'doc_bank_stmt_09', fileType: 'application/pdf' },
        errorReason: 'Corrupted byte stream during OCR extraction',
        failedAt: new Date(Date.now() - 7200000).toISOString(),
        retryCount: 2,
        status: 'UNRESOLVED',
      },
    ];
    for (const dl of defaultDeadLetters) {
      this.deadLetters.set(dl.id, dl);
    }

    // Support-access requests live in the database (platform-store.ts). Data corrections start empty: a record that
    // looks approved must come from a real request.
  }

  // ==========================================
  // SUB-ADM.01: Platform Console (API-TEN-002)
  // ==========================================

  async listTenants(ctx: RequestContext, query: ListPlatformTenantsQuery): Promise<{ data: PlatformTenantSummary[]; meta: { total: number } }> {
    // Platform console restriction: tenant metadata only, no business data. The database allows this read in the platform
    // realm only. A failure is reported, never replaced by sample tenants.
    let filtered = await this.store.listTenants(ctx);
    if (query.status) {
      filtered = filtered.filter((t) => t.status === query.status);
    }
    if (query.search) {
      const q = query.search.toLowerCase();
      filtered = filtered.filter((t) => t.legalName.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q));
    }
    return { data: filtered, meta: { total: filtered.length } };
  }

  // ==========================================
  // SUB-ADM.02: Feature Flags (API-ADM-001 / API-ADM-002)
  // ==========================================

  async listFeatureFlags(ctx: RequestContext): Promise<{ data: FeatureFlag[]; meta: { total: number } }> {
    const list = await this.store.listFlags(ctx);
    return { data: list, meta: { total: list.length } };
  }

  async getFeatureFlag(ctx: RequestContext, key: string, scope: string = 'GLOBAL'): Promise<FeatureFlag> {
    const flag = await this.store.getFlag(ctx, key, scope);
    if (!flag) {
      throw AppError.of('NOT_FOUND', `Feature flag '${key}' in scope '${scope}' was not found.`);
    }
    return flag;
  }

  async putFeatureFlag(
    ctx: RequestContext,
    key: string,
    input: UpdateFeatureFlagRequest,
    ifMatchHeader: string | undefined,
  ): Promise<FeatureFlag> {
    return this.store.putFlag(ctx, key, input, ifMatchHeader);
  }

  // ==========================================
  // SUB-ADM.03: Master Data (API-ADM-003)
  // ==========================================

  async getMasterData(ctx: RequestContext, listCode?: string): Promise<{ data: Record<string, MasterDataItem[]>; meta: { listsCount: number } }> {
    const result = await this.store.listMasterData(ctx, listCode);
    return { data: result, meta: { listsCount: Object.keys(result).length } };
  }

  async importMasterData(ctx: RequestContext, req: MasterDataImportRequest): Promise<MasterDataImportResult> {
    return this.store.importMasterData(ctx, req);
  }

  // ==========================================
  // SUB-ADM.04: Background Jobs (API-ADM-004 / API-ADM-005)
  // ==========================================

  async getJobsAndQueues(): Promise<{ sampleData: true; notice: string; queues: JobQueueInfo[]; deadLetters: DeadLetterItem[] }> {
    return {
      // Honest labelling: these figures are not read from any real queue. The console for background jobs is Release 2 (SUB-ADM.04).
      sampleData: true,
      notice: SAMPLE_JOBS_NOTICE,
      queues: Array.from(this.queues.values()),
      deadLetters: Array.from(this.deadLetters.values()),
    };
  }

  async pauseQueue(queueName: string, req: PauseQueueRequest, actorId: string): Promise<JobQueueInfo> {
    const q = this.queues.get(queueName);
    if (!q) {
      throw AppError.of('NOT_FOUND', `Queue '${queueName}' not found.`);
    }
    if (!req.reason || req.reason.trim().length < 5) {
      throw AppError.of('VALIDATION_ERROR', 'A reason is required when pausing a queue (minimum 5 characters).');
    }

    q.paused = true;
    q.pausedReason = req.reason.trim();
    q.pausedAt = new Date().toISOString();
    q.pausedBy = actorId;
    return q;
  }

  async resumeQueue(queueName: string, req: ResumeQueueRequest, _actorId: string): Promise<JobQueueInfo> {
    const q = this.queues.get(queueName);
    if (!q) {
      throw AppError.of('NOT_FOUND', `Queue '${queueName}' not found.`);
    }
    if (!req.reason || req.reason.trim().length < 5) {
      throw AppError.of('VALIDATION_ERROR', 'A reason is required when resuming a queue (minimum 5 characters).');
    }

    q.paused = false;
    q.pausedReason = null;
    q.pausedAt = null;
    q.pausedBy = null;
    return q;
  }

  async replayDeadLetter(id: string): Promise<DeadLetterItem> {
    const dl = this.deadLetters.get(id);
    if (!dl) {
      throw AppError.of('NOT_FOUND', `Dead letter record '${id}' not found.`);
    }
    dl.status = 'REPLAYED';
    return dl;
  }

  async discardDeadLetter(id: string): Promise<DeadLetterItem> {
    const dl = this.deadLetters.get(id);
    if (!dl) {
      throw AppError.of('NOT_FOUND', `Dead letter record '${id}' not found.`);
    }
    dl.status = 'DISCARDED';
    return dl;
  }

  // ==========================================
  // SUB-ADM.05: System Health (Health Dashboard)
  // ==========================================

  async getSystemHealth(): Promise<SystemHealthReport> {
    // The database is probed for real: a failed probe is DOWN (it used to be reported as UP with a made-up latency), a slow one is
    // DEGRADED, and pool utilisation is the share of the server's connection slots in use. The overall status follows the database.
    const start = performance.now();
    let dbStatus: 'UP' | 'DEGRADED' | 'DOWN' = 'UP';
    let poolUtilization = 0;

    try {
      const probe = await this.deps.txRunner.withTenantTx(
        {
          principal: { kind: 'SERVICE', id: 'SYSTEM:health', tenantId: 'ten_health_probe', primaryBranchId: null, managedTeamMemberIds: [], queueIds: [], grants: [], authTime: null },
          correlationId: 'probe',
          now: new Date(),
        },
        async (tx) => {
          const r = await sql<{ in_use: number | string; max_connections: number | string }>`
            SELECT (SELECT count(*) FROM pg_stat_activity) AS in_use, current_setting('max_connections')::int AS max_connections`.execute(tx);
          return r.rows[0];
        },
      );
      if (probe && Number(probe.max_connections) > 0) {
        poolUtilization = Math.min(100, Math.round((Number(probe.in_use) / Number(probe.max_connections)) * 1000) / 10);
      }
    } catch {
      dbStatus = 'DOWN';
    }
    const latencyMs = Math.round((performance.now() - start) * 10) / 10;
    if (dbStatus === 'UP' && latencyMs > DB_DEGRADED_LATENCY_MS) dbStatus = 'DEGRADED';
    const overall: SystemHealthReport['status'] = dbStatus === 'DOWN' ? 'DOWN' : dbStatus === 'DEGRADED' ? 'DEGRADED' : 'HEALTHY';

    const mem = process.memoryUsage();
    const uptime = Math.floor((Date.now() - this.startTimestamp) / 1000);

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptime,
      version: 'v0.1.0-rc.1',
      dependencies: {
        database: {
          status: dbStatus,
          latencyMs,
          poolUtilization,
        },
        redisQueue: {
          status: 'SIMULATED',
          message: 'Synchronous in-memory pipeline active per ADR-4D-02',
        },
        authService: {
          status: 'UP',
          provider: 'Supabase Auth (asymmetric ES256/RS256)',
        },
      },
      memoryUsage: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      },
    };
  }

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // ==========================================

  async listSupportAccessRequests(ctx: RequestContext, tenantId?: string): Promise<{ data: SupportAccessGrant[]; meta: { total: number } }> {
    const list = await this.store.listSupportGrants(ctx, tenantId);
    return { data: list, meta: { total: list.length } };
  }

  async createSupportAccessRequest(ctx: RequestContext, req: CreateSupportAccessRequest): Promise<SupportAccessGrant> {
    // Constraint: ends_at must be no more than four hours after starts_at
    if (req.durationHours > 4.0 || req.durationHours <= 0) {
      throw AppError.of('VALIDATION_ERROR', 'Access duration must be greater than zero and cannot exceed 4.0 hours.');
    }
    return this.store.createSupportGrant(ctx, req);
  }

  async approveSupportAccessRequest(
    ctx: RequestContext,
    grantId: string,
    req: ApproveSupportAccessRequest,
  ): Promise<SupportAccessGrant> {
    return this.store.decideSupportGrant(ctx, grantId, req.decision);
  }

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009)
  // ==========================================

  async listDataCorrections(ctx: RequestContext): Promise<{ data: DataCorrectionRequest[]; meta: { total: number } }> {
    const list = await this.store.listDataCorrections(ctx);
    return { data: list, meta: { total: list.length } };
  }

  /** A correction belongs to one tenant, taken from the signed-in user. A tenantId in the body is accepted only if it matches. */
  async createDataCorrectionRequest(ctx: RequestContext, req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest> {
    if (req.tenantId !== undefined && req.tenantId !== ctx.principal.tenantId) {
      throw AppError.of('VALIDATION_ERROR', 'A data correction can only be requested for your own tenant.', [
        { field: 'tenantId', issue: 'NOT_YOUR_TENANT' },
      ]);
    }
    return this.store.createDataCorrection(ctx, req);
  }

  async approveDataCorrectionRequest(
    ctx: RequestContext,
    correctionId: string,
    req: ApproveDataCorrectionRequest,
  ): Promise<DataCorrectionRequest> {
    return this.store.decideDataCorrection(ctx, correctionId, req.decision);
  }

  /** Called by the correction executor (a service identity) once it has applied an approved correction. */
  async executeDataCorrection(ctx: RequestContext, correctionId: string): Promise<DataCorrectionRequest> {
    return this.store.markDataCorrectionExecuted(ctx, correctionId);
  }

  async revokeSupportAccessRequest(ctx: RequestContext, grantId: string): Promise<SupportAccessGrant> {
    return this.store.revokeSupportGrant(ctx, grantId);
  }

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================

  async getReleases(ctx: RequestContext): Promise<{ candidate: string | null; releases: ReleaseRegisterItem[] }> {
    const releases = await this.store.listReleases(ctx);
    const candidate = releases.find((r) => r.status === 'CANDIDATE') ?? null;
    return { candidate: candidate?.version ?? null, releases };
  }

  async updateRelease(ctx: RequestContext, version: string, patch: UpdateReleaseRequest, ifMatch: string | undefined): Promise<ReleaseRegisterItem> {
    return this.store.updateRelease(ctx, version, patch, ifMatch);
  }
}
