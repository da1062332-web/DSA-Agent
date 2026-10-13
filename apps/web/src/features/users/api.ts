import { readConfig } from '../../config';
import { getStoredAuthToken } from '../../auth/token';
import type { Branch, CreateUserInput, Role, UpdateUserInput, UserSummary } from './types';

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

export async function fetchUsers(params?: {
  status?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: UserSummary[]; meta: { limit: number; nextCursor: string | null } }> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/v1/users`);
  if (params?.status) url.searchParams.set('status', params.status);
  if (params?.search) url.searchParams.set('search', params.search);
  if (params?.limit) url.searchParams.set('limit', String(params.limit));
  if (params?.cursor) url.searchParams.set('cursor', params.cursor);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function fetchUserById(id: string): Promise<UserSummary> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function createUser(data: CreateUserInput): Promise<UserSummary> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  lockVersion?: number,
): Promise<UserSummary> {
  const baseUrl = getApiBaseUrl();
  const headers = getAuthHeaders(
    lockVersion !== undefined ? { 'If-Match': `"${lockVersion}"` } : {},
  );
  const res = await fetch(`${baseUrl}/v1/users/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function fetchBranches(): Promise<Branch[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/branches`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ data: Branch[] }>(res);
  return data.data || [];
}

export async function fetchRoles(): Promise<Role[]> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/roles`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<{ data: Role[] }>(res);
  return data.data || [];
}

export async function assignUserRole(
  userId: string,
  roleId: string,
  scopeType: string = 'TENANT',
): Promise<{ id: string; alreadyAssigned: boolean }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users/${userId}/roles`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ roleId, scopeType, scopeBranchIds: [] }),
  });
  return handleResponse(res);
}

export async function removeUserRole(userId: string, roleId: string): Promise<{ status: string }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users/${userId}/roles/${roleId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}
