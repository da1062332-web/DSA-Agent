// apps/web/src/features/verification/api.ts — owner: Developer 2 (Module 19: Verification)
import { readConfig } from '../../config';
import { getStoredAuthToken } from '../../auth/token';
import type {
  ChecklistAttestationInput,
  CompleteVerificationInput,
  CreateVerificationInput,
  UpdateVerificationInput,
  VerificationRequest,
} from './types';

function getApiBaseUrl(): string {
  const config = readConfig();
  return config.success ? config.data.VITE_API_BASE_URL : 'http://localhost:3000';
}

function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken() || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
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
  return res.json() as Promise<T>;
}

export async function fetchVerifications(params?: {
  status?: string;
  verificationType?: string;
  priority?: string;
  applicationId?: string;
  branchId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: VerificationRequest[]; meta: { limit: number; nextCursor: string | null } }> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/v1/verifications`);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.verificationType) url.searchParams.set('verificationType', params.verificationType);
  if (params?.priority) url.searchParams.set('priority', params.priority);
  if (params?.applicationId) url.searchParams.set('applicationId', params.applicationId);
  if (params?.branchId) url.searchParams.set('branchId', params.branchId);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function fetchVerification(id: string): Promise<VerificationRequest> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/verifications/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function createVerification(input: CreateVerificationInput): Promise<VerificationRequest> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/verifications`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function updateVerification(
  id: string,
  lockVersion: number,
  input: UpdateVerificationInput
): Promise<VerificationRequest> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/verifications/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders({ 'If-Match': `"${lockVersion}"` }),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function completeVerification(
  id: string,
  lockVersion: number,
  input: CompleteVerificationInput
): Promise<VerificationRequest> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/verifications/${id}/complete`, {
    method: 'POST',
    headers: getAuthHeaders({ 'If-Match': `"${lockVersion}"` }),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function attestChecklistItem(
  verificationId: string,
  input: ChecklistAttestationInput
): Promise<{ checklistItemId: string; status: string; reviewedBy: string; reviewedAt: string }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/verifications/${verificationId}/checklist-review`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}
