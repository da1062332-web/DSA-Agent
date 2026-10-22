// apps/web/src/features/tasks/api.ts — owner: Dev 6 (MOD-08 Tasks)
import { ApiError as SharedApiError, apiRequest, type ApiRequest } from '../../api/client';
import type { CompleteTaskPayload, CreateTaskPayload, TaskResource, UpdateTaskPayload } from './types';

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

export function generateIdempotencyKey(): string {
  const rand = Math.random().toString(36).substring(2, 12);
  const time = Date.now().toString(36);
  return `idem_task_${time}_${rand}`;
}

export async function listTasks(params: {
  view?: 'MINE' | 'QUEUES' | 'ALL';
  status?: string;
  linkedType?: string;
  linkedId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ data: TaskResource[]; nextCursor: string | null }> {
  const q = new URLSearchParams();
  if (params.view) q.set('view', params.view);
  if (params.status) q.set('status', params.status);
  if (params.linkedType) q.set('linkedType', params.linkedType);
  if (params.linkedId) q.set('linkedId', params.linkedId);
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
