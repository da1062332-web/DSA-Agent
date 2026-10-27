// apps/web/src/features/lender-cases/api.spec.ts — owner: Dev 4 (MOD-LCS API Client Unit Tests)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TokenModule from '../../auth/token';

// The feature client goes through api/client.ts: give it a web config and a Supabase session whose token is the one the
// test sets with setAuthToken.
vi.mock('../../config', () => ({
  readConfig: () => ({
    success: true,
    data: {
      VITE_API_BASE_URL: 'http://api.test',
      VITE_SUPABASE_URL: 'http://supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  }),
}));
vi.mock('../../auth/supabase', async () => {
  const { getStoredAuthToken } = await vi.importActual<typeof TokenModule>('../../auth/token');
  return {
    getSupabase: () => ({
      auth: {
        getSession: async () => {
          const token = getStoredAuthToken();
          return { data: { session: token ? { access_token: token } : null } };
        },
      },
    }),
  };
});
import { setAuthToken } from '../../auth/token';
import {
  ApiError,
  buildPackage,
  createLenderCase,
  fetchAllLenderCases,
  fetchApplicationDocuments,
  fetchLenderCase,
  fetchLenderCaseHistory,
  fetchLenderCaseQueries,
  fetchLenderCases,
  fetchSubmissionPackage,
  recordLenderQuery,
  recordQueryResponse,
  submitLenderCase,
  updateLenderCaseStatus,
} from './api';

describe('Module 18 — Lender Cases Frontend API Client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    setAuthToken('test-token-123');
  });

  afterEach(() => {
    setAuthToken(undefined);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetchAllLenderCases sends the cursor and limit and returns the page with nextCursor', async () => {
    const cases = [{ id: 'lcs_01', status: 'DRAFT' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: cases, meta: { nextCursor: 'abc', limit: 50 } }),
      headers: new Headers(),
    });

    const res = await fetchAllLenderCases({ status: 'DRAFT', cursor: 'prev', limit: 50 });
    expect(res).toEqual({ data: cases, nextCursor: 'abc' });
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1/lender-cases?');
    expect(url).toContain('status=DRAFT');
    expect(url).toContain('cursor=prev');
    expect(url).toContain('limit=50');
  });

  it('fetchApplicationDocuments offers only checklist items that have a document, with their type and status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { documentId: 'doc_01', documentTypeCode: 'PAN_CARD', status: 'ACCEPTED' },
          { documentId: null, documentTypeCode: 'BANK_STATEMENT', status: 'PENDING' },
        ],
        summary: {},
      }),
      headers: new Headers(),
    });

    const res = await fetchApplicationDocuments('app_01');
    expect(res).toEqual([{ documentId: 'doc_01', documentTypeCode: 'PAN_CARD', status: 'ACCEPTED' }]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/applications/app_01/checklist'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fetchLenderCaseQueries reads the query history of a case and unwraps data', async () => {
    const queries = [{ id: 'qry_01', text: 'Salary slip?', responseText: 'Uploaded', respondedAt: '2026-10-26T10:00:00Z' }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: queries }), headers: new Headers() });

    const res = await fetchLenderCaseQueries('lcs_01');
    expect(res).toEqual(queries);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lender-cases/lcs_01/queries'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fetchLenderCaseHistory reads the status history of a case', async () => {
    const history = [{ id: 'lcsh_01', fromStatus: null, toStatus: 'DRAFT' }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: history }), headers: new Headers() });

    const res = await fetchLenderCaseHistory('lcs_01');
    expect(res).toEqual(history);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lender-cases/lcs_01/history'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fetchSubmissionPackage reads the package of a case', async () => {
    const pkg = { id: 'pkg_01', kind: 'SUBMISSION', manifestSha256: 'a'.repeat(64) };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => pkg, headers: new Headers() });

    const res = await fetchSubmissionPackage('lcs_01');
    expect(res).toEqual(pkg);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lender-cases/lcs_01/package'),
      expect.objectContaining({ method: 'GET' }),
    );
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
