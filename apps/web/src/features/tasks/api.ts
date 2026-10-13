// apps/web/src/features/tasks/api.ts — owner: Dev 6 (MOD-08 Tasks)
import type { CompleteTaskPayload, CreateTaskPayload, TaskResource, UpdateTaskPayload } from './types';
import { getStoredAuthToken } from '../../auth/token';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || '';

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

async function request<T>(
  path: string,
  options: RequestInit & { ifMatch?: string; idempotencyKey?: string } = {},
): Promise<{ data: T; etag?: string }> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  if (options.ifMatch) {
    headers.set('If-Match', options.ifMatch);
  }

  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  }

  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const etag = response.headers.get('ETag') || undefined;

  if (!response.ok) {
    let errCode = 'UNKNOWN_ERROR';
    let errMessage = `HTTP error ${response.status}`;
    let errDetails: unknown[] = [];

    try {
      const errorBody = await response.json();
      if (errorBody && errorBody.error) {
        errCode = errorBody.error.code || errCode;
        errMessage = errorBody.error.message || errMessage;
        errDetails = errorBody.error.details || [];
      }
    } catch {
      // Non-json response
    }

    throw new ApiError(errCode, errMessage, response.status, errDetails);
  }

  const data = (await response.json()) as T;
  return { data, etag };
}

export function generateIdempotencyKey(): string {
  const rand = Math.random().toString(36).substring(2, 12);
  const time = Date.now().toString(36);
  return `idem_task_${time}_${rand}`;
}

export async function listTasks(params: {
  view?: 'MINE' | 'QUEUES' | 'ALL';
  status?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: TaskResource[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (params.view) q.set('view', params.view);
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.cursor) q.set('cursor', params.cursor);

  const { data } = await request<{ data: TaskResource[]; pagination: { nextCursor: string | null } }>(
    `/v1/tasks?${q.toString()}`,
  );
  return { data: data.data, nextCursor: data.pagination.nextCursor };
}

export async function getTask(id: string): Promise<{ task: TaskResource; etag?: string }> {
  const { data, etag } = await request<TaskResource>(`/v1/tasks/${id}`);
  return { task: data, etag };
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskResource> {
  const { data } = await request<TaskResource>('/v1/tasks', {
    method: 'POST',
    idempotencyKey: generateIdempotencyKey(),
    body: JSON.stringify(payload),
  });
  return data;
}

export async function updateTask(
  id: string,
  etag: string,
  payload: UpdateTaskPayload,
): Promise<TaskResource> {
  const { data } = await request<TaskResource>(`/v1/tasks/${id}`, {
    method: 'PATCH',
    ifMatch: etag,
    body: JSON.stringify(payload),
  });
  return data;
}

export async function completeTask(
  id: string,
  etag: string,
  payload: CompleteTaskPayload,
): Promise<{ task: TaskResource; followUpTask?: TaskResource | null }> {
  const { data } = await request<{ task: TaskResource; followUpTask?: TaskResource | null }>(
    `/v1/tasks/${id}/completion`,
    {
      method: 'POST',
      ifMatch: etag,
      idempotencyKey: generateIdempotencyKey(),
      body: JSON.stringify(payload),
    },
  );
  return data;
}
