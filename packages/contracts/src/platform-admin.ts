// packages/contracts/src/platform-admin.ts — Module 30: Administration and Platform Operations (MOD-ADM)
import { z } from 'zod';

// ==========================================
// SUB-ADM.01: Platform Console (CMP-ADM.01.1 / API-TEN-002)
// ==========================================

export const PlatformTenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  legalName: z.string(),
  tenantType: z.enum(['DSA_ORG', 'NBFC_DISTRIBUTION']),
  dataRegion: z.string(),
  timezone: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDING']),
  createdAt: z.string(),
  createdBy: z.string(),
  healthStatus: z.enum(['HEALTHY', 'DEGRADED', 'ACTION_REQUIRED']),
  activeUsersCount: z.number().int().nonnegative(),
  /** Business counts are not shown in the platform console. Always null. */
  applicationsCount: z.number().int().nonnegative().nullable(),
  entitlements: z.array(z.string()),
});

export type PlatformTenantSummary = z.infer<typeof PlatformTenantSummarySchema>;

export const ListPlatformTenantsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDING']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().optional(),
});

export type ListPlatformTenantsQuery = z.infer<typeof ListPlatformTenantsQuerySchema>;

// ==========================================
// SUB-ADM.02: Feature Flags (CMP-ADM.02.1 / API-ADM-001 / API-ADM-002)
// ==========================================

export const FeatureFlagScopeSchema = z.enum(['GLOBAL', 'TENANT', 'COHORT']);
export type FeatureFlagScope = z.infer<typeof FeatureFlagScopeSchema>;

export const FeatureFlagSchema = z.object({
  key: z.string().min(2).max(100),
  scope: FeatureFlagScopeSchema,
  value: z.union([z.boolean(), z.record(z.unknown()), z.string(), z.number()]),
  owner: z.string().min(2),
  removeBy: z.string().nullable().optional(),
  description: z.string().optional(),
  lockVersion: z.number().int().nonnegative().default(0),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const UpdateFeatureFlagRequestSchema = z.object({
  scope: FeatureFlagScopeSchema.default('GLOBAL'),
  value: z.union([z.boolean(), z.record(z.unknown()), z.string(), z.number()]),
  owner: z.string().min(2).optional(),
  removeBy: z.string().nullable().optional(),
  description: z.string().optional(),
});

export type UpdateFeatureFlagRequest = z.infer<typeof UpdateFeatureFlagRequestSchema>;

/**
 * One TENANT-scope flag as one tenant sees it: the platform-wide default (the TENANT row of the flag table) and, when the operator set
 * one, that tenant's own override. `value` is the effective value. The tenant is named in the URL, never chosen by the body.
 */
export const TenantFeatureFlagSchema = z.object({
  tenantId: z.string(),
  key: z.string(),
  scope: z.literal('TENANT'),
  description: z.string(),
  owner: z.string(),
  defaultValue: z.boolean(),
  value: z.boolean(),
  overridden: z.boolean(),
  /** Version of the override (the ETag); 0 while the tenant has no override. */
  lockVersion: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export type TenantFeatureFlag = z.infer<typeof TenantFeatureFlagSchema>;

/** Strict on purpose: a body that names a scope or a tenant is refused, so it cannot be mistaken for a global change. */
export const UpdateTenantFeatureFlagRequestSchema = z.object({ value: z.boolean() }).strict();

export type UpdateTenantFeatureFlagRequest = z.infer<typeof UpdateTenantFeatureFlagRequestSchema>;

// ==========================================
// SUB-ADM.03: Master Data (CMP-ADM.03.1 / API-ADM-003)
// ==========================================

export const MasterDataItemSchema = z.object({
  id: z.string(),
  listCode: z.string().min(2).max(50),
  code: z.string().min(1).max(50),
  attributes: z.record(z.unknown()),
  version: z.number().int().positive(),
  label: z.string(),
  active: z.boolean().default(true),
  createdAt: z.string(),
});

export type MasterDataItem = z.infer<typeof MasterDataItemSchema>;

export const MasterDataImportItemSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  attributes: z.record(z.unknown()).default({}),
});

export const MasterDataImportRequestSchema = z.object({
  listCode: z.string().min(2).max(50),
  version: z.number().int().positive().optional(),
  items: z.array(MasterDataImportItemSchema).min(1),
  dryRun: z.boolean().default(false),
});

export type MasterDataImportRequest = z.infer<typeof MasterDataImportRequestSchema>;

// ==========================================
// SUB-ADM.04: Background Jobs (CMP-ADM.04.1 / API-ADM-004 / API-ADM-005)
// ==========================================

export const JobQueueInfoSchema = z.object({
  queue: z.string(),
  activeJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative(),
  delayedJobs: z.number().int().nonnegative(),
  completedJobs: z.number().int().nonnegative(),
  paused: z.boolean(),
  pausedReason: z.string().nullable().optional(),
  pausedAt: z.string().nullable().optional(),
  pausedBy: z.string().nullable().optional(),
});

export type JobQueueInfo = z.infer<typeof JobQueueInfoSchema>;

export const DeadLetterItemSchema = z.object({
  id: z.string(),
  queue: z.string(),
  originalJobId: z.string(),
  payload: z.record(z.unknown()),
  errorReason: z.string(),
  failedAt: z.string(),
  retryCount: z.number().int().nonnegative(),
  status: z.enum(['UNRESOLVED', 'REPLAYED', 'DISCARDED']),
});

export type DeadLetterItem = z.infer<typeof DeadLetterItemSchema>;

export const PauseQueueRequestSchema = z.object({
  reason: z.string().min(5, 'A reason is required when pausing a queue (min 5 characters)'),
});

export type PauseQueueRequest = z.infer<typeof PauseQueueRequestSchema>;

export const ResumeQueueRequestSchema = z.object({
  reason: z.string().min(5, 'A reason is required when resuming a queue (min 5 characters)'),
});

export type ResumeQueueRequest = z.infer<typeof ResumeQueueRequestSchema>;

// ==========================================
// SUB-ADM.05: System Health (CMP-ADM.05.1)
// ==========================================

export const SystemHealthReportSchema = z.object({
  status: z.enum(['HEALTHY', 'DEGRADED', 'DOWN']),
  timestamp: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string(),
  dependencies: z.object({
    database: z.object({
      status: z.enum(['UP', 'DEGRADED', 'DOWN']),
      latencyMs: z.number().nonnegative(),
      poolUtilization: z.number().min(0).max(100),
    }),
    redisQueue: z.object({
      status: z.enum(['UP', 'DEGRADED', 'DOWN', 'SIMULATED']),
      message: z.string(),
    }),
    authService: z.object({
      status: z.enum(['UP', 'DEGRADED', 'DOWN']),
      provider: z.string(),
    }),
  }),
  memoryUsage: z.object({
    rssMb: z.number().nonnegative(),
    heapUsedMb: z.number().nonnegative(),
    heapTotalMb: z.number().nonnegative(),
  }),
});

export type SystemHealthReport = z.infer<typeof SystemHealthReportSchema>;

// ==========================================
// SUB-ADM.06: Support Access (CMP-ADM.06.1 / API-ADM-006 / API-ADM-007)
// ==========================================

export const SupportAccessGrantStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED']);

export type SupportAccessGrantStatus = z.infer<typeof SupportAccessGrantStatusSchema>;

export const SupportAccessGrantSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  tenantName: z.string(),
  requester: z.string(),
  approver: z.string().nullable().optional(),
  reason: z.string(),
  scope: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  incidentRef: z.string(),
  status: SupportAccessGrantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SupportAccessGrant = z.infer<typeof SupportAccessGrantSchema>;

export const CreateSupportAccessRequestSchema = z.object({
  tenantId: z.string().min(1),
  reason: z.string().min(10, 'A detailed reason is required (min 10 characters)'),
  scope: z.string().min(2).default('READ_METADATA_AND_CONFIG'),
  incidentRef: z.string().min(3, 'Incident reference required (e.g. INC-1024)'),
  durationHours: z.number().min(0.25).max(4.0, 'ends_at must be no more than four hours after starts_at'),
});

export type CreateSupportAccessRequest = z.infer<typeof CreateSupportAccessRequestSchema>;

export const ApproveSupportAccessRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'DENIED']),
  comments: z.string().optional(),
});

export type ApproveSupportAccessRequest = z.infer<typeof ApproveSupportAccessRequestSchema>;

/** The target tenant ends an approved access early (a tenant-realm action). */
export const RevokeSupportAccessRequestSchema = z.object({
  comments: z.string().max(500).optional(),
});

export type RevokeSupportAccessRequest = z.infer<typeof RevokeSupportAccessRequestSchema>;

// ==========================================
// SUB-ADM.07: Data Correction (CMP-ADM.07.1 / API-ADM-008 / API-ADM-009)
// ==========================================

export const DataCorrectionStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED']);

export type DataCorrectionStatus = z.infer<typeof DataCorrectionStatusSchema>;

export const DataCorrectionRequestSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  justification: z.string(),
  scriptRef: z.string(),
  /** Set when the correction executor attaches a real dry-run diff. Null until then; never made up by the API. */
  dryRunDiffKey: z.string().nullable(),
  dryRunDiff: z.string().nullable(),
  targetEntity: z.string().nullable().optional(),
  changeDescription: z.string().nullable().optional(),
  requestedBy: z.string(),
  approvedBy: z.string().nullable().optional(),
  status: DataCorrectionStatusSchema,
  executedAt: z.string().nullable().optional(),
  /** Why the executor could not carry the correction out; set only when status is FAILED. */
  failureReason: z.string().nullable().optional(),
  executorIdentity: z.string().default('SERVICE:data-correction-executor'),
  createdAt: z.string(),
});

export type DataCorrectionRequest = z.infer<typeof DataCorrectionRequestSchema>;

export const CreateDataCorrectionRequestSchema = z.object({
  /** Never trusted: a correction belongs to the caller's own tenant. Accepted only if it equals that tenant. */
  tenantId: z.string().min(1).optional(),
  justification: z.string().min(10, 'Justification required (min 10 characters)'),
  scriptRef: z.string().min(3, 'Script reference required (e.g. SCR-2026-001)'),
  targetEntity: z.string().min(2),
  changeDescription: z.string().min(5),
});

export type CreateDataCorrectionRequest = z.infer<typeof CreateDataCorrectionRequestSchema>;

export const ApproveDataCorrectionRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().optional(),
});

export type ApproveDataCorrectionRequest = z.infer<typeof ApproveDataCorrectionRequestSchema>;

// ==========================================
// SUB-ADM.08: Release Management (CMP-ADM.08.1)
// ==========================================

export const ReleaseGateStatusSchema = z.object({
  rel001: z.boolean(),
  rel002: z.boolean(),
  rel003: z.boolean(),
  rel004: z.boolean(),
});

export type ReleaseGateStatus = z.infer<typeof ReleaseGateStatusSchema>;

export const ReleaseRegisterItemSchema = z.object({
  version: z.string(),
  /** Optimistic-concurrency version (ETag). Absent on items from older servers. */
  lockVersion: z.number().int().positive().optional(),
  status: z.enum(['CANDIDATE', 'STAGING', 'PUBLISHED', 'ARCHIVED']),
  targetDate: z.string(),
  gitTag: z.string().nullable(),
  releaseNotesRef: z.string(),
  rulePackVersion: z.string(),
  migrationVersion: z.string(),
  gates: ReleaseGateStatusSchema,
  notesSummary: z.string(),
});

export type ReleaseRegisterItem = z.infer<typeof ReleaseRegisterItemSchema>;

/** PUT /platform/v1/releases/{version}: an operator records what was verified or published. Only what is sent changes. */
export const UpdateReleaseRequestSchema = z
  .object({
    status: z.enum(['CANDIDATE', 'STAGING', 'PUBLISHED', 'ARCHIVED']).optional(),
    gitTag: z.string().min(1).max(100).nullable().optional(),
    gates: ReleaseGateStatusSchema.partial().optional(),
    notesSummary: z.string().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change.' });

export type UpdateReleaseRequest = z.infer<typeof UpdateReleaseRequestSchema>;

// ==========================================
// SUB-ADM.06: Break-glass support view (read-only, metadata and configuration only)
// ==========================================
// What an approved support-access window shows: the tenant's status and its organisation and branch set-up.
// No business records (leads, applications, customers, loans) are part of this shape.

export const SupportTenantViewSchema = z.object({
  grantId: z.string(),
  endsAt: z.string(),
  tenant: z.object({
    id: z.string(),
    slug: z.string(),
    legalName: z.string(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'OFFBOARDING']),
    dataRegion: z.string(),
    timezone: z.string(),
  }),
  organisations: z.array(
    z.object({
      id: z.string(),
      legalName: z.string(),
      constitution: z.string(),
      status: z.enum(['ACTIVE', 'INACTIVE']),
    }),
  ),
  branches: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      status: z.enum(['ACTIVE', 'INACTIVE']),
      timezone: z.string(),
    }),
  ),
  /** The tenant's settings at TENANT, ORGANISATION and BRANCH scope. USER-scope (personal) settings are never included. */
  settings: z.array(
    z.object({
      key: z.string(),
      scopeType: z.enum(['TENANT', 'ORGANISATION', 'BRANCH']),
      scopeId: z.string(),
      value: z.unknown(),
      locked: z.boolean(),
    }),
  ),
  /** The tenant's own feature-flag overrides. Platform-wide flags are not included. */
  flags: z.array(z.object({ key: z.string(), value: z.boolean() })),
});

export type SupportTenantView = z.infer<typeof SupportTenantViewSchema>;

/** One line of the support-view log: a view of a tenant's set-up, or a refused attempt to view it. */
export const SupportViewLogEntrySchema = z.object({
  occurredAt: z.string(),
  action: z.enum(['platform.support_view_read', 'platform.support_view_denied']),
  operatorId: z.string(),
  /** The operator's display name, or null when it is not on record. */
  operatorName: z.string().nullable(),
  grantId: z.string().nullable(),
});

export type SupportViewLogEntry = z.infer<typeof SupportViewLogEntrySchema>;
