// apps/web/src/features/verification/api.spec.ts — owner: Developer 2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attestChecklistItem,
  completeVerification,
  createVerification,
  fetchVerification,
  fetchVerifications,
  updateVerification,
} from './api';

describe('Module 19 — Verification Frontend API Client', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('fetchVerifications calls GET /v1/verifications with query params', async () => {
    const mockResponse = { data: [], meta: { limit: 50, nextCursor: null } };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await fetchVerifications({ status: 'INITIATED', limit: 20 });
    expect(result).toEqual(mockResponse);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('/v1/verifications?status=INITIATED&limit=20');
    expect(callArgs[1].method).toBe('GET');
  });

  it('fetchVerification calls GET /v1/verifications/:id', async () => {
    const mockRecord = { id: 'vrf_123', status: 'INITIATED' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockRecord,
    });

    const result = await fetchVerification('vrf_123');
    expect(result).toEqual(mockRecord);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('/v1/verifications/vrf_123');
  });

  it('createVerification sends POST /v1/verifications with payload', async () => {
    const mockCreated = { id: 'vrf_new', status: 'INITIATED' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCreated,
    });

    const input = {
      applicationId: 'app_1',
      verificationType: 'DOCUMENT_REVIEW' as const,
      branchId: 'br_mumbai',
    };
    const result = await createVerification(input);
    expect(result).toEqual(mockCreated);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBe('POST');
    expect(JSON.parse(callArgs[1].body as string)).toEqual(input);
  });

  it('updateVerification sends PATCH with If-Match header', async () => {
    const mockUpdated = { id: 'vrf_123', status: 'IN_PROGRESS', lockVersion: 1 };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockUpdated,
    });

    const result = await updateVerification('vrf_123', 0, { status: 'IN_PROGRESS' });
    expect(result).toEqual(mockUpdated);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].method).toBe('PATCH');
    expect((callArgs[1].headers as Record<string, string>)['If-Match']).toBe('"0"');
  });

  it('completeVerification sends POST /v1/verifications/:id/complete', async () => {
    const mockCompleted = { id: 'vrf_123', status: 'VERIFIED', outcome: 'POSITIVE' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCompleted,
    });

    const result = await completeVerification('vrf_123', 1, {
      outcome: 'POSITIVE',
      findingsSummary: 'All checks verified',
      markStatus: 'VERIFIED',
    });
    expect(result).toEqual(mockCompleted);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('/v1/verifications/vrf_123/complete');
    expect((callArgs[1].headers as Record<string, string>)['If-Match']).toBe('"1"');
  });

  it('attestChecklistItem sends POST /v1/verifications/:id/checklist-review', async () => {
    const mockAttest = { checklistItemId: 'chk_1', status: 'ACCEPTED' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAttest,
    });

    const result = await attestChecklistItem('vrf_123', {
      checklistItemId: 'chk_1',
      status: 'ACCEPTED',
      attestationNote: 'Clear proof',
    });
    expect(result).toEqual(mockAttest);

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toContain('/v1/verifications/vrf_123/checklist-review');
    expect(callArgs[1].method).toBe('POST');
  });
});
