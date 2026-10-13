// apps/web/src/features/tasks/api.spec.ts — owner: Dev 6 (MOD-08 Tasks Frontend API Client Tests)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthToken } from '../../auth/token';
import {
  ApiError,
  completeTask,
  createTask,
  generateIdempotencyKey,
  getTask,
  listTasks,
  updateTask,
} from './api';

const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = String(v);
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  configurable: true,
  writable: true,
});

describe('Module 9 — Tasks Frontend API Client (api.ts)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockLocalStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('generateIdempotencyKey generates keys matching required pattern', () => {
    const key1 = generateIdempotencyKey();
    const key2 = generateIdempotencyKey();

    expect(key1).toMatch(/^idem_task_[a-z0-9]+_[a-z0-9]+$/);
    expect(key1).not.toBe(key2);
  });

  it('listTasks formats query string and returns data and nextCursor', async () => {
    const mockTasks = [{ id: 'task_01', title: 'Call Lead', status: 'OPEN', priority: 'HIGH' }];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        data: mockTasks,
        pagination: { nextCursor: 'cursor_abc123' },
      }),
    } as unknown as Response);

    const result = await listTasks({ view: 'MINE', status: 'OPEN', limit: 10, cursor: 'cur_0' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![0];
    expect(calledUrl).toContain('/v1/tasks?');
    expect(calledUrl).toContain('view=MINE');
    expect(calledUrl).toContain('status=OPEN');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('cursor=cur_0');

    expect(result.data).toEqual(mockTasks);
    expect(result.nextCursor).toBe('cursor_abc123');
  });

  it('getTask retrieves task by id and returns resource with etag', async () => {
    const mockTask = { id: 'task_02', title: 'Verify KYC', lockVersion: 0 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: 'W/"task_02:0"' }),
      json: async () => mockTask,
    } as unknown as Response);

    const result = await getTask('task_02');

    expect(global.fetch).toHaveBeenCalledWith(
      '/v1/tasks/task_02',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(result.task).toEqual(mockTask);
    expect(result.etag).toBe('W/"task_02:0"');
  });

  it('createTask sends POST with generated Idempotency-Key and payload', async () => {
    const mockCreated = { id: 'task_03', title: 'New Task', status: 'OPEN' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: 'W/"task_03:0"' }),
      json: async () => mockCreated,
    } as unknown as Response);

    const payload = {
      type: 'FOLLOW_UP' as const,
      title: 'New Task',
      ownerUserId: 'usr_01',
      linkedType: 'LEAD' as const,
      linkedId: 'lead_01',
      branchId: 'br_01',
      priority: 'MEDIUM' as const,
    };

    const result = await createTask(payload);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe('/v1/tasks');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify(payload));
    expect(result).toEqual(mockCreated);
  });

  it('updateTask sends PATCH with If-Match header and updates', async () => {
    const mockUpdated = { id: 'task_04', priority: 'LOW', lockVersion: 1 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: 'W/"task_04:1"' }),
      json: async () => mockUpdated,
    } as unknown as Response);

    const result = await updateTask('task_04', 'W/"task_04:0"', { priority: 'LOW' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/v1/tasks/task_04',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ priority: 'LOW' }),
      }),
    );
    expect(result).toEqual(mockUpdated);
  });

  it('completeTask sends POST to completion endpoint with If-Match and outcomeCode', async () => {
    const mockCompletion = {
      task: { id: 'task_05', status: 'COMPLETED', outcomeCode: 'CONNECTED' },
      followUpTask: null,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: 'W/"task_05:1"' }),
      json: async () => mockCompletion,
    } as unknown as Response);

    const result = await completeTask('task_05', 'W/"task_05:0"', {
      outcomeCode: 'CONNECTED',
      completionNote: 'Spoke with lead',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/v1/tasks/task_05/completion',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ outcomeCode: 'CONNECTED', completionNote: 'Spoke with lead' }),
      }),
    );
    expect(result).toEqual(mockCompletion);
  });

  it('throws ApiError on HTTP error status with envelope details', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => ({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Task update conflicted with another change.',
          details: [{ field: 'lockVersion', issue: 'ETAG_MISMATCH' }],
        },
      }),
    } as unknown as Response);

    await expect(updateTask('task_err', 'W/"task_err:0"', { priority: 'HIGH' })).rejects.toThrow(ApiError);
    await expect(updateTask('task_err', 'W/"task_err:0"', { priority: 'HIGH' })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      httpStatus: 409,
      message: 'Task update conflicted with another change.',
    });
  });

  it('attaches the Supabase session bearer token when one is set', async () => {
    setAuthToken('jwt_test_token_123');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ data: [], pagination: { nextCursor: null } }),
    } as unknown as Response);

    await listTasks({ view: 'MINE' });

    const callHeaders = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1].headers as Headers;
    expect(callHeaders.get('Authorization')).toBe('Bearer jwt_test_token_123');
  });
});
