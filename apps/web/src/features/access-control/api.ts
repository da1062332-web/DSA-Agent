import { apiFetch, apiRequest } from '../../api/client';
import type {
  CreateRoleInput,
  Permission,
  Role,
  UpdateRoleInput,
  UserEffectiveGrants,
  UserRoleAssignment,
} from './types';

// Every call goes through the shared client (session token, error envelope, step-up dialog on 401 STEP_UP_REQUIRED).

export async function fetchRoles(): Promise<{ data: Role[] }> {
  return apiFetch<{ data: Role[] }>('/v1/roles');
}

export async function fetchRoleById(roleId: string): Promise<{ data: Role; etag: string | null }> {
  const { data, etag } = await apiRequest<Role>(`/v1/roles/${encodeURIComponent(roleId)}`);
  return { data, etag: etag ?? null };
}

export async function fetchPermissions(): Promise<{ data: Permission[] }> {
  return apiFetch<{ data: Permission[] }>('/v1/permissions');
}

export async function createRole(input: CreateRoleInput): Promise<Role> {
  return apiFetch<Role>('/v1/roles', { method: 'POST', body: input });
}

// Editing and deleting a role need step-up (API-ACL-004: an authenticator code within the last 15 minutes).
export async function updateRole(roleId: string, input: UpdateRoleInput, etag?: string): Promise<Role> {
  const version = etag ? Number.parseInt(etag.replace(/"/g, ''), 10) : Number.NaN;
  return apiFetch<Role>(`/v1/roles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: input,
    ...(Number.isNaN(version) ? {} : { version }),
  });
}

export async function deleteRole(roleId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/v1/roles/${encodeURIComponent(roleId)}`, { method: 'DELETE' });
}

export async function fetchUserRoles(userId: string): Promise<{ data: UserRoleAssignment[] }> {
  return apiFetch<{ data: UserRoleAssignment[] }>(`/v1/users/${encodeURIComponent(userId)}/roles`);
}

export async function fetchUserPermissions(userId: string): Promise<UserEffectiveGrants> {
  return apiFetch<UserEffectiveGrants>(`/v1/users/${encodeURIComponent(userId)}/permissions`);
}
