// The security screen talks to the real endpoints with the right query, If-Match and Idempotency-Key, and shows the API refusals.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
vi.mock('../../config', () => ({
  readConfig: () => ({ success: true, data: { VITE_API_BASE_URL: 'http://api.test' } }),
}));

import { ApiError } from '../../api/client';
import { createIncident, listIncidents, listSecurityEvents, updateIncident } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('security screen API calls', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('TEST-UI-SEC-05 lists events and incidents with only the filters that are set, and a cursor for the next page', async () => {
    fetchMock.mockImplementation(async () => json(200, { data: [], meta: { nextCursor: null, limit: 50 } }));
    await listSecurityEvents({ type: 'AUTH_FAILURE', severity: '', principal: undefined });
    await listIncidents({ status: 'OPEN' }, 'cur_1');
    const events = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(events.pathname).toBe('/v1/security/events');
    expect(events.searchParams.get('type')).toBe('AUTH_FAILURE');
    expect(events.searchParams.has('severity')).toBe(false);
    const incidents = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(incidents.pathname).toBe('/v1/incidents');
    expect(incidents.searchParams.get('cursor')).toBe('cur_1');
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('TEST-UI-SEC-06 recording an incident sends an Idempotency-Key; updating sends If-Match with the version', async () => {
    fetchMock.mockImplementation(async () => json(200, { id: 'inc_1', lockVersion: 2 }));
    await createIncident({
      type: 'OTHER',
      severity: 'LOW',
      detectedAt: '2026-10-16T10:00:00.000Z',
      personalDataInvolved: false,
      affectedTenants: [],
      notifications: {},
      status: 'OPEN',
    });
    await updateIncident('inc_1', { status: 'INVESTIGATING' }, 4);
    const [, create] = fetchMock.mock.calls[0]!;
    expect(create.method).toBe('POST');
    expect(new Headers(create.headers).get('Idempotency-Key')).toBeTruthy();
    const [url, update] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('http://api.test/v1/incidents/inc_1');
    expect(update.method).toBe('PATCH');
    expect(new Headers(update.headers).get('If-Match')).toBe('"4"');
  });

  it('TEST-UI-SEC-07 a stale version and a missing permission come back as errors the screen can show', async () => {
    const error = (code: string, httpStatus: number) =>
      json(httpStatus, {
        error: { code, message: code, httpStatus, correlationId: 'c', details: [], retryable: false },
      });
    fetchMock
      .mockResolvedValueOnce(error('VERSION_CONFLICT', 409))
      .mockResolvedValueOnce(error('FORBIDDEN', 403));
    await expect(updateIncident('inc_1', { status: 'RESOLVED' }, 1)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      httpStatus: 409,
    });
    await expect(listIncidents({})).rejects.toBeInstanceOf(ApiError);
  });
});
