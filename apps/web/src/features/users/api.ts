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

/** New staff are invited (API-USR-001): the server records the invitation; the provisioning worker creates the account and sends it. */
export async function createInvitation(
  data: Omit<CreateUserInput, 'status' | 'availability'>,
): Promise<UserSummary> {
  return apiFetch<UserSummary>('/v1/users/invitations', { method: 'POST', body: data });
}

/** The latest invitation of a user, as GET /v1/users/:id/invitation reports it (API-USR-001). */
export interface InvitationStatus {
  userStatus: string;
  invitationState: 'NONE' | 'PENDING' | 'EXPIRED' | 'ACCEPTED';
  deliveryState: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED' | null;
  lastFailure: string | null;
  sentAt: string | null;
  expiresAt: string | null;
  resendCount: number;
  acceptedAt: string | null;
  nextResendAt: string | null;
  resendsLeft: number;
  serverTime: string;
}

/** Deletes an account for good (POST /v1/users/:id/erasure): details erased, open work handed over, sign-in removed. */
export async function eraseUser(
  id: string,
  body: { handoverToUserId?: string; reason: string },
  lockVersion: number,
): Promise<UserSummary> {
  return apiFetch<UserSummary>(`/v1/users/${encodeURIComponent(id)}/erasure`, {
    method: 'POST',
    body,
    version: lockVersion,
  });
}

export async function fetchInvitationStatus(id: string): Promise<InvitationStatus> {
  return apiFetch<InvitationStatus>(`/v1/users/${encodeURIComponent(id)}/invitation`);
}

/** Sends a new set-password link to an invited user. Resolves only when the server has accepted the request. */
export async function resendInvitation(id: string): Promise<{ id: string; invitation: string }> {
  return apiFetch<{ id: string; invitation: string }>(
    `/v1/users/${encodeURIComponent(id)}/invitation/resend`,
    {
      method: 'POST',
    },
  );
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  lockVersion?: number,
): Promise<UserSummary> {
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
