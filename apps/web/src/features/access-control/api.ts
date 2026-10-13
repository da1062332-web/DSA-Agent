import { readConfig } from '../../config';
import type {
  CreateRoleInput,
  Permission,
  Role,
  UpdateRoleInput,
  UserEffectiveGrants,
  UserRoleAssignment,
} from './types';
import { getStoredAuthToken } from '../../auth/token';

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

export async function fetchRoles(): Promise<{ data: Role[] }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/roles`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function fetchRoleById(roleId: string): Promise<{ data: Role; etag: string | null }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/roles/${roleId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await handleResponse<Role>(res);
  const etag = res.headers.get('etag');
  return { data, etag };
}

export async function fetchPermissions(): Promise<{ data: Permission[] }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/permissions`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function createRole(input: CreateRoleInput): Promise<Role> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/roles`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function updateRole(roleId: string, input: UpdateRoleInput, etag?: string): Promise<Role> {
  const baseUrl = getApiBaseUrl();
  const extraHeaders: Record<string, string> = {};
  if (etag) {
    extraHeaders['If-Match'] = etag;
  }
  const res = await fetch(`${baseUrl}/v1/roles/${roleId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(extraHeaders),
    body: JSON.stringify(input),
  });
  return handleResponse(res);
}

export async function deleteRole(roleId: string): Promise<{ status: string }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/roles/${roleId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function fetchUserRoles(userId: string): Promise<{ data: UserRoleAssignment[] }> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users/${userId}/roles`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function fetchUserPermissions(userId: string): Promise<UserEffectiveGrants> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/v1/users/${userId}/permissions`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}
