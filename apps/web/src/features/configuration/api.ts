import { apiFetch, apiRequest } from '../../api/client';
import type {
  BranchConfig,
  CreateBranchInput,
  TenantConfigSummary,
  UpdateBranchInput,
  UpdateTenantConfigInput,
} from './types';

// Every call goes through the shared client (session token, error envelope, step-up dialog). If-Match is passed through as
// the ETag string the API sent.
const withEtag = async <T>(p: Promise<{ data: T; etag?: string }>): Promise<{ data: T; etag: string | null }> => {
  const { data, etag } = await p;
  return { data, etag: etag ?? null };
};

export async function fetchTenantConfig(): Promise<{ data: TenantConfigSummary; etag: string | null }> {
  return withEtag(apiRequest<TenantConfigSummary>('/v1/config'));
}

export async function updateTenantConfig(
  input: UpdateTenantConfigInput,
  ifMatch?: string | null,
): Promise<{ data: TenantConfigSummary; etag: string | null }> {
  return withEtag(
    apiRequest<TenantConfigSummary>('/v1/config', { method: 'PATCH', body: input, ifMatch: ifMatch ?? undefined }),
  );
}

export async function fetchBranches(): Promise<{ data: BranchConfig[] }> {
  return apiFetch<{ data: BranchConfig[] }>('/v1/branches');
}

export async function fetchBranchById(id: string): Promise<{ data: BranchConfig; etag: string | null }> {
  return withEtag(apiRequest<BranchConfig>(`/v1/branches/${encodeURIComponent(id)}`));
}

export async function createBranch(input: CreateBranchInput): Promise<{ data: BranchConfig; etag: string | null }> {
  return withEtag(apiRequest<BranchConfig>('/v1/branches', { method: 'POST', body: input }));
}

export async function updateBranch(
  id: string,
  input: UpdateBranchInput,
  ifMatch?: string | null,
): Promise<{ data: BranchConfig; etag: string | null }> {
  return withEtag(
    apiRequest<BranchConfig>(`/v1/branches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      ifMatch: ifMatch ?? undefined,
    }),
  );
}
