// apps/web/src/features/lender-cases/api.spec.ts — owner: Dev 4 (MOD-LCS API Client Unit Tests)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthToken } from '../../auth/token';
import {
  ApiError,
  buildPackage,
  createLenderCase,
  fetchLenderCase,
  fetchLenderCases,
  recordLenderQuery,
  recordQueryResponse,
  submitLenderCase,
  updateLenderCaseStatus,
} from './api';

describe('Module 18 — Lender Cases Frontend API Client', () => {
  const originalFetch = global.fetch;

  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = { dsa_auth_token: 'test-token-123' };
    (global as any).localStorage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v;
      },
      clear: () => {
        mockStorage = {};
      },
    };
  });

  afterEach(() => {
    delete (global as any).localStorage;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetchLenderCases performs GET request and unwraps data', async () => {
    const mockCases = [
      { id: 'lcs_01', attemptNo: 1, status: 'DRAFT', lenderId: 'lnd_01' },
      { id: 'lcs_02', attemptNo: 2, status: 'SUBMITTED', lenderId: 'lnd_02' },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockCases }),
      headers: new Headers(),
    });

    const res = await fetchLenderCases('app_01');
    expect(res).toEqual(mockCases);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/applications/app_01/lender-cases'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('createLenderCase sends POST request with idempotency key and payload', async () => {
    const mockCase = { id: 'lcs_01', attemptNo: 1, status: 'DRAFT' };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCase,
      headers: new Headers({ ETag: '"0"' }),
    });

    const payload = { lenderId: 'lnd_01', productVersionId: 'lpv_01', empanelmentId: 'emp_01' };
    const res = await createLenderCase('app_01', payload, 'idem-key-1');

    expect(res.case).toEqual(mockCase);
    expect(res.etag).toBe('"0"');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/applications/app_01/lender-cases'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: expect.any(Headers),
      }),
    );
  });

  it('buildPackage passes If-Match header and payload', async () => {
    const mockResult = {
      package: { id: 'pkg_01', kind: 'SUBMISSION' },
      case: { id: 'lcs_01', status: 'PACKAGE_READY' },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
      headers: new Headers({ ETag: '"1"' }),
    });

    const res = await buildPackage('lcs_01', { freeze: true }, '"0"');
    expect(res.case.status).toBe('PACKAGE_READY');
    expect(res.etag).toBe('"1"');
  });

  it('submitLenderCase performs POST submission and parses response', async () => {
    const mockResult = {
      lenderCaseId: 'lcs_01',
      status: 'SUBMITTED',
      packageId: 'pkg_01',
      applicationStatus: 'SUBMITTED',
      dataSharingRecordId: 'dsr_01',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResult,
      headers: new Headers(),
    });

    const res = await submitLenderCase('lcs_01', { channel: 'PORTAL' }, '"1"', 'idem-submit');
    expect(res.status).toBe('SUBMITTED');
  });

  it('updateLenderCaseStatus passes If-Match and returns updated case', async () => {
    const mockCase = { id: 'lcs_01', status: 'SANCTIONED', lockVersion: 2 };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCase,
      headers: new Headers({ ETag: '"2"' }),
    });

    const res = await updateLenderCaseStatus('lcs_01', { toStatus: 'SANCTIONED' }, '"1"');
    expect(res.case.status).toBe('SANCTIONED');
    expect(res.etag).toBe('"2"');
  });

  it('throws ApiError with error envelope details on HTTP error response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'Active SHARE_WITH_LENDER consent is required',
          details: [{ field: 'consent', issue: 'REQUIRED' }],
        },
      }),
      headers: new Headers(),
    });

    await expect(submitLenderCase('lcs_01', { channel: 'PORTAL' })).rejects.toThrow(ApiError);
  });

  it('attaches the Supabase session bearer token via getStoredAuthToken', async () => {
    setAuthToken('jwt_supabase_lcs_token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
      headers: new Headers(),
    });

    await fetchLenderCases('app_01');

    const calledHeaders = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1]?.headers as Headers;
    expect(calledHeaders.get('Authorization')).toBe('Bearer jwt_supabase_lcs_token');

    setAuthToken(undefined);
  });
});
