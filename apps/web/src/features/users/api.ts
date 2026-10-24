import type { Branch, CreateUserInput, Role, UpdateUserInput, UserListItem, UserSummary } from './types';
import { apiFetch } from '../../api/client';

// Every call goes through the shared client (session token, error envelope, step-up dialog for role changes).

export async function fetchUsers(params?: {
  status?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: UserListItem[]; meta: { limit: number; nextCursor: string | null } }> {
  return apiFetch<{ data: UserListItem[]; meta: { limit: number; nextCursor: string | null } }>('/v1/users', {
    query: { ...params },
  });
}

export async function fetchUserById(id: string): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/v1/users/${encodeURIComponent(id)}`);
}

export async function createUser(data: CreateUserInput): Promise<UserSummary> {
  return apiFetch<UserSummary>('/v1/users', { method: 'POST', body: data });
}

export async function updateUser(id: string, data: UpdateUserInput, lockVersion?: number): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/v1/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: data,
    ...(lockVersion !== undefined ? { version: lockVersion } : {}),
  });
}

export async function fetchBranches(): Promise<Branch[]> {
  return (await apiFetch<{ data: Branch[] }>('/v1/branches')).data ?? [];
}

export async function fetchRoles(): Promise<Role[]> {
  return (await apiFetch<{ data: Role[] }>('/v1/roles')).data ?? [];
}

export async function assignUserRole(
  userId: string,
  roleId: string,
  scopeType: string = 'TENANT',
  scopeBranchIds: string[] = [],
): Promise<{ id: string; alreadyAssigned: boolean }> {
  if (!roleId || !roleId.trim()) {
    throw new Error('Please select a valid role to assign.');
  }
  return apiFetch<{ id: string; alreadyAssigned: boolean }>(`/v1/users/${encodeURIComponent(userId)}/roles`, {
    method: 'POST',
    body: { roleId: roleId.trim(), scopeType, scopeBranchIds },
  });
}

export async function removeUserRole(userId: string, roleId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(
    `/v1/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  );
}
