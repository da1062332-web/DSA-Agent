import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthToken } from '../../auth/token';
import { sanctionsApi } from './api';

describe('Module 19 — Sanctions Frontend API Client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('listSanctions fetches sanctions for lender case', async () => {
    const mockSanctions = [{ id: 'snc_01', version: 1, amount: 1500000, status: 'ACTIVE' }];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockSanctions }),
      headers: new Headers(),
    });

    const res = await sanctionsApi.listSanctions('lcs_test_01');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.amount).toBe(1500000);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lender-cases/lcs_test_01/sanctions'),
      expect.anything(),
    );
  });

  it('recordSanction sends POST with sanction terms and returns created sanction', async () => {
    const mockCreated = {
      id: 'snc_02',
      version: 1,
      amount: 2000000,
      status: 'ACTIVE',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCreated,
      headers: new Headers(),
    });

    const res = await sanctionsApi.recordSanction('lcs_test_01', {
      amount: 2000000,
      tenureMonths: 120,
      rateValue: 8.5,
      rateType: 'FLOATING',
      sanctionDate: '2026-10-01',
      validUntil: '2027-01-01',
    });

    expect(res.id).toBe('snc_02');
    expect(res.amount).toBe(2000000);
  });

  it('recordTranche sends POST to /v1/sanctions/:id/tranches', async () => {
    const mockRes = {
      tranche: { id: 'trn_01', trancheNo: 1, amount: 500000, status: 'RECORDED' },
      remainingSanctionAmount: 1500000,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRes,
      headers: new Headers(),
    });

    const res = await sanctionsApi.recordTranche('snc_01', {
      amount: 500000,
      disbursedOn: '2026-10-05',
    });

    expect(res.tranche.id).toBe('trn_01');
    expect(res.remainingSanctionAmount).toBe(1500000);
  });

  it('verifyTranche sends POST to /v1/tranches/:id/verification', async () => {
    const mockVerified = {
      id: 'trn_01',
      status: 'VERIFIED',
      verifiedBy: 'usr_mgr_01',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockVerified,
      headers: new Headers(),
    });

    const res = await sanctionsApi.verifyTranche('trn_01', {
      decision: 'VERIFY',
    });

    expect(res.status).toBe('VERIFIED');
    expect(res.verifiedBy).toBe('usr_mgr_01');
  });

  it('extracts API error message and code on error responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'EXCEEDS_SANCTION',
          message: 'Tranche exceeds remaining limit',
        },
      }),
      headers: new Headers(),
    });

    await expect(
      sanctionsApi.recordTranche('snc_01', {
        amount: 99999999,
        disbursedOn: '2026-10-05',
      }),
    ).rejects.toThrow('Tranche exceeds remaining limit');
  });

  it('attaches the Supabase session bearer token via getStoredAuthToken', async () => {
    setAuthToken('jwt_supabase_sanctions_token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
      headers: new Headers(),
    });

    await sanctionsApi.listSanctions('lcs_test_01');

    const calledHeaders = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1]?.headers as Headers;
    expect(calledHeaders.get('Authorization')).toBe('Bearer jwt_supabase_sanctions_token');

    setAuthToken(undefined);
  });
});
