import { readConfig } from '../../config';
import { getStoredAuthToken } from '../../auth/token';
import type {
  BranchConfig,
  CreateBranchInput,
  TenantConfigSummary,
  UpdateBranchInput,
  UpdateTenantConfigInput,
} from './types';

function getApiBaseUrl(): string {
  const config = readConfig();
  return config.success ? config.data.VITE_API_BASE_URL : 'http://localhost:3000';
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken() ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

async function handleResponse<T>(res: Response): Promise<{ data: T; etag: string | null }> {
  if (!res.ok) {
    let errorMessage = `Request failed with status ${res.status}`;
    try {
      const errorJson = await res.json();
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }
  const etag = res.headers.get('ETag');
  const data = (await res.json()) as T;
  return { data, etag };
}

export async function fetchTenantConfig(): Promise<{ data: TenantConfigSummary; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/config`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<TenantConfigSummary>(res);
}

export async function updateTenantConfig(
  input: UpdateTenantConfigInput,
  ifMatch?: string | null,
): Promise<{ data: TenantConfigSummary; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const headers: Record<string, string> = {};
  if (ifMatch) {
    headers['If-Match'] = ifMatch;
  }
  const res = await fetch(`${baseUrl}/v1/config`, {
    method: 'PATCH',
    headers: getAuthHeaders(headers),
    body: JSON.stringify(input),
  });
  return handleResponse<TenantConfigSummary>(res);
}

export async function fetchBranches(): Promise<{ data: BranchConfig[] }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/branches`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    let errorMessage = `Failed to fetch branches (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) errorMessage = err.error.message;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }
  return res.json() as Promise<{ data: BranchConfig[] }>;
}

export async function fetchBranchById(id: string): Promise<{ data: BranchConfig; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/branches/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse<BranchConfig>(res);
}

export async function createBranch(
  input: CreateBranchInput,
): Promise<{ data: BranchConfig; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/branches`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse<BranchConfig>(res);
}

export async function updateBranch(
  id: string,
  input: UpdateBranchInput,
  ifMatch?: string | null,
): Promise<{ data: BranchConfig; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const headers: Record<string, string> = {};
  if (ifMatch) {
    headers['If-Match'] = ifMatch;
  }
  const res = await fetch(`${baseUrl}/v1/branches/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: getAuthHeaders(headers),
    body: JSON.stringify(input),
  });
  return handleResponse<BranchConfig>(res);
}
