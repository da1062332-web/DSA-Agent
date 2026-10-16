// apps/web/src/features/platform-admin/api.ts
// Module 30: Administration and Platform Operations (MOD-ADM) Client API
import type {
  ApproveDataCorrectionRequest,
  ApproveSupportAccessRequest,
  CreateDataCorrectionRequest,
  CreateSupportAccessRequest,
  DataCorrectionRequest,
  DeadLetterItem,
  FeatureFlag,
  JobQueueInfo,
  ListPlatformTenantsQuery,
  MasterDataImportRequest,
  MasterDataItem,
  PlatformTenantSummary,
  ReleaseRegisterItem,
  SupportAccessGrant,
  SystemHealthReport,
  UpdateFeatureFlagRequest,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

// SUB-ADM.01: Platform Console
export async function fetchPlatformTenants(query?: ListPlatformTenantsQuery): Promise<{ data: PlatformTenantSummary[]; meta: { total: number } }> {
  return apiFetch<{ data: PlatformTenantSummary[]; meta: { total: number } }>('/platform/v1/tenants', {
    query: query as Record<string, string | number | undefined>,
  });
}

// SUB-ADM.02: Feature Flags
export async function fetchFeatureFlags(): Promise<{ data: FeatureFlag[]; meta: { total: number } }> {
  return apiFetch<{ data: FeatureFlag[]; meta: { total: number } }>('/platform/v1/flags');
}

export async function updateFeatureFlag(
  key: string,
  input: UpdateFeatureFlagRequest,
  etag?: string,
): Promise<FeatureFlag> {
  const headers: Record<string, string> = {};
  if (etag) headers['If-Match'] = etag;
  return apiFetch<FeatureFlag>(`/platform/v1/flags/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers,
    body: input,
  });
}

// SUB-ADM.03: Master Data
export async function fetchMasterData(listCode?: string): Promise<{ data: Record<string, MasterDataItem[]>; meta: { listsCount: number } }> {
  const query = listCode ? { listCode } : undefined;
  return apiFetch<{ data: Record<string, MasterDataItem[]>; meta: { listsCount: number } }>('/platform/v1/master-data', {
    query,
  });
}

export async function importMasterData(
  req: MasterDataImportRequest,
): Promise<{
  dryRun: boolean;
  listCode: string;
  totalSubmitted: number;
  newItemsCount: number;
  updatedItemsCount: number;
  preview: MasterDataItem[];
}> {
  return apiFetch('/platform/v1/master-data/imports', {
    method: 'POST',
    body: req,
  });
}

// SUB-ADM.04: Background Jobs & Queues
export interface JobsAndQueues {
  /** True while the figures are sample data, not read from a real queue. */
  sampleData?: boolean;
  notice?: string;
  queues: JobQueueInfo[];
  deadLetters: DeadLetterItem[];
}

export async function fetchJobsAndQueues(): Promise<JobsAndQueues> {
  return apiFetch<JobsAndQueues>('/platform/v1/jobs');
}

export async function pauseQueue(queueName: string, reason: string): Promise<JobQueueInfo> {
  return apiFetch<JobQueueInfo>(`/platform/v1/queues/${encodeURIComponent(queueName)}/pause`, {
    method: 'POST',
    body: { reason },
  });
}

export async function resumeQueue(queueName: string, reason: string): Promise<JobQueueInfo> {
  return apiFetch<JobQueueInfo>(`/platform/v1/queues/${encodeURIComponent(queueName)}/resume`, {
    method: 'POST',
    body: { reason },
  });
}

export async function replayDeadLetter(id: string): Promise<DeadLetterItem> {
  return apiFetch<DeadLetterItem>(`/platform/v1/dead-letters/${encodeURIComponent(id)}/replay`, {
    method: 'POST',
  });
}

export async function discardDeadLetter(id: string): Promise<DeadLetterItem> {
  return apiFetch<DeadLetterItem>(`/platform/v1/dead-letters/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
  });
}

// SUB-ADM.05: System Health
export async function fetchSystemHealth(): Promise<SystemHealthReport> {
  return apiFetch<SystemHealthReport>('/platform/v1/health');
}

// SUB-ADM.06: Support Access
export async function fetchSupportAccessRequests(tenantId?: string): Promise<{ data: SupportAccessGrant[]; meta: { total: number } }> {
  const query = tenantId ? { tenantId } : undefined;
  return apiFetch<{ data: SupportAccessGrant[]; meta: { total: number } }>('/platform/v1/support-access-requests', {
    query,
  });
}

export async function createSupportAccessRequest(req: CreateSupportAccessRequest): Promise<SupportAccessGrant> {
  return apiFetch<SupportAccessGrant>('/platform/v1/support-access-requests', {
    method: 'POST',
    body: req,
  });
}

export async function approveSupportAccessRequest(
  id: string,
  decision: 'APPROVED' | 'DENIED',
  comments?: string,
): Promise<SupportAccessGrant> {
  const body: ApproveSupportAccessRequest = { decision, comments };
  return apiFetch<SupportAccessGrant>(`/v1/support-access-requests/${encodeURIComponent(id)}/approval`, {
    method: 'POST',
    body,
  });
}

// SUB-ADM.07: Data Corrections
export async function fetchDataCorrections(): Promise<{ data: DataCorrectionRequest[]; meta: { total: number } }> {
  return apiFetch<{ data: DataCorrectionRequest[]; meta: { total: number } }>('/v1/data-corrections');
}

export async function createDataCorrection(req: CreateDataCorrectionRequest): Promise<DataCorrectionRequest> {
  return apiFetch<DataCorrectionRequest>('/v1/data-corrections', {
    method: 'POST',
    body: req,
  });
}

export async function approveDataCorrection(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comments?: string,
): Promise<DataCorrectionRequest> {
  const body: ApproveDataCorrectionRequest = { decision, comments };
  return apiFetch<DataCorrectionRequest>(`/v1/data-corrections/${encodeURIComponent(id)}/approval`, {
    method: 'POST',
    body,
  });
}

export async function executeDataCorrection(id: string): Promise<DataCorrectionRequest> {
  return apiFetch<DataCorrectionRequest>(`/v1/data-corrections/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
  });
}

// SUB-ADM.08: Release Management
export async function fetchReleases(): Promise<{ candidate: string; releases: ReleaseRegisterItem[] }> {
  return apiFetch<{ candidate: string; releases: ReleaseRegisterItem[] }>('/platform/v1/releases');
}
