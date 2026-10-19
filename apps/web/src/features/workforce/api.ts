// apps/web/src/features/workforce/api.ts — Module 26: Workforce API client
import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
import type {
  AgentWorkforceSummary,
  AttendanceRecord,
  AvailabilityStatus,
  CreateDelegationInput,
  DelegationRecord,
} from './types';


export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number,
    public readonly details: unknown[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Goes through the shared client (api/client.ts): the Supabase session token, no-store, the step-up (TOTP) dialog and the
// error envelope. Errors are re-thrown as this feature's ApiError so the screens keep their handling.
async function request<T>(
  path: string,
  options: RequestInit & { ifMatch?: string; idempotencyKey?: string } = {},
): Promise<{ data: T; etag?: string }> {
  try {
    return await apiRequest<T>(path, {
      method: (options.method ?? 'GET') as ApiRequest['method'],
      body: typeof options.body === 'string' ? options.body : undefined,
      ifMatch: options.ifMatch,
      idempotencyKey: options.idempotencyKey,
    });
  } catch (err) {
    if (err instanceof SharedApiError) {
      throw new ApiError(err.code, err.message, err.httpStatus, err.details);
    }
    throw err;
  }
}

// 1. SUB-WRK.01: Capacity and Availability
export async function updateMyAvailability(
  availability: AvailabilityStatus,
  ifMatch?: string,
): Promise<{ user: any; etag?: string }> {
  const res = await request<any>('/v1/me/availability', {
    method: 'PATCH',
    body: JSON.stringify({ availability }),
    ifMatch,
  });
  return { user: res.data, etag: res.etag };
}

export async function getAgents(branchId?: string): Promise<AgentWorkforceSummary[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const res = await request<{ agents: AgentWorkforceSummary[] }>(`/v1/workforce/agents${query}`);
  return res.data.agents;
}

export async function updateAgentCapacity(
  agentId: string,
  capacity: number,
): Promise<{ user: any; etag?: string }> {
  const res = await request<any>(`/v1/workforce/agents/${agentId}/capacity`, {
    method: 'PATCH',
    body: JSON.stringify({ capacity }),
  });
  return { user: res.data, etag: res.etag };
}

// 2. SUB-WRK.02: Leave Coverage & Delegations
export async function getDelegations(params?: {
  delegatorId?: string;
  delegateId?: string;
  status?: string;
}): Promise<DelegationRecord[]> {
  const q = new URLSearchParams();
  if (params?.delegatorId) q.set('delegatorId', params.delegatorId);
  if (params?.delegateId) q.set('delegateId', params.delegateId);
  if (params?.status) q.set('status', params.status);
  const qs = q.toString() ? `?${q.toString()}` : '';

  const res = await request<{ delegations: DelegationRecord[] }>(`/v1/delegations${qs}`);
  return res.data.delegations;
}

export async function createDelegation(
  input: CreateDelegationInput,
  idempotencyKey?: string,
): Promise<DelegationRecord> {
  const res = await request<DelegationRecord>('/v1/delegations', {
    method: 'POST',
    body: JSON.stringify(input),
    idempotencyKey,
  });
  return res.data;
}

export async function endDelegation(id: string): Promise<DelegationRecord> {
  const res = await request<DelegationRecord>(`/v1/delegations/${id}/end`, {
    method: 'POST',
  });
  return res.data;
}

// 3. SUB-WRK.03: Attendance Tracking
export async function getMyTodayAttendance(): Promise<AttendanceRecord | null> {
  const res = await request<{ attendance: AttendanceRecord | null }>('/v1/attendance/me/today');
  return res.data.attendance;
}

export async function checkIn(notes?: string): Promise<AttendanceRecord> {
  const res = await request<AttendanceRecord>('/v1/attendance/check-in', {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  return res.data;
}

export async function checkOut(notes?: string): Promise<AttendanceRecord> {
  const res = await request<AttendanceRecord>('/v1/attendance/check-out', {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  return res.data;
}

export async function getAttendance(params?: {
  userId?: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<AttendanceRecord[]> {
  const q = new URLSearchParams();
  if (params?.userId) q.set('userId', params.userId);
  if (params?.date) q.set('date', params.date);
  if (params?.fromDate) q.set('fromDate', params.fromDate);
  if (params?.toDate) q.set('toDate', params.toDate);
  const qs = q.toString() ? `?${q.toString()}` : '';

  const res = await request<{ records: AttendanceRecord[] }>(`/v1/attendance${qs}`);
  return res.data.records;
}
