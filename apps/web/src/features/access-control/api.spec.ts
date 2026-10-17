// Role edit and delete need step-up (API-ACL-004). The screens must go through the shared client, which opens the step-up dialog when the API
// answers 401 STEP_UP_REQUIRED and then retries, not through a plain fetch that would just fail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
vi.mock('../../config', () => ({
  readConfig: () => ({ success: true, data: { VITE_API_BASE_URL: 'http://api.test' } }),
}));

import { registerStepUpHandler } from '../../api/client';
import { deleteRole, updateRole } from './api';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const stepUpRequired = () =>
  json(401, {
    error: {
      code: 'STEP_UP_REQUIRED',
      message: 'Verify with your authenticator app.',
      httpStatus: 401,
      correlationId: 'c1',
      details: [],
      retryable: false,
    },
  });

describe('role edit and delete ask for step-up and then go through', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    registerStepUpHandler(null);
    vi.unstubAllGlobals();
  });

  it('TEST-ACL-WEB-01 updating a role: 401 STEP_UP_REQUIRED opens the dialog, and after a code the same request is sent again with If-Match', async () => {
    const dialog = vi.fn().mockResolvedValue(true);
    registerStepUpHandler(dialog);
    fetchMock
      .mockResolvedValueOnce(stepUpRequired())
      .mockResolvedValueOnce(json(200, { id: 'rol_1', name: 'Renamed', version: 3, permissions: [] }));

    const role = await updateRole('rol_1', { name: 'Renamed' }, '"2"');

    expect(role).toMatchObject({ name: 'Renamed', version: 3 });
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('http://api.test/v1/roles/rol_1');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('If-Match')).toBe('"2"');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({ name: 'Renamed' });
  });

  it('TEST-ACL-WEB-02 if the user cancels the step-up dialog the edit fails with the API error and is not retried', async () => {
    registerStepUpHandler(vi.fn().mockResolvedValue(false));
    fetchMock.mockResolvedValueOnce(stepUpRequired());
    await expect(updateRole('rol_1', { name: 'x' }, '"2"')).rejects.toMatchObject({
      code: 'STEP_UP_REQUIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TEST-ACL-WEB-03 deleting a role goes through the same step-up path, and an API refusal keeps its message and code', async () => {
    registerStepUpHandler(vi.fn().mockResolvedValue(true));
    fetchMock.mockResolvedValueOnce(stepUpRequired()).mockResolvedValueOnce(json(200, { status: 'ok' }));
    await expect(deleteRole('rol_1')).resolves.toEqual({ status: 'ok' });

    fetchMock.mockResolvedValueOnce(
      json(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This role has assignment history and cannot be deleted.',
          httpStatus: 422,
          correlationId: 'c2',
          details: [],
          retryable: false,
        },
      }),
    );
    await expect(deleteRole('rol_2')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('assignment history'),
    });
  });
});
