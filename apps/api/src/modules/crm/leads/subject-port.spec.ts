// apps/api/src/modules/crm/leads/subject-port.spec.ts — owner: Dev 5 (MOD-04 Leads)
import { describe, expect, it, vi } from 'vitest';
import { createCompositeComplaintSubjectPort, createLeadSubjectPort } from './subject-port';
import type { Tx } from '@dsa/contracts';

function makeMockTx(rows: any[] = []): Tx {
  return {
    getExecutor: () => ({
      adapter: {
        supportsReturning: () => true,
      },
      transformQuery: (node: any) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery: async () => ({ rows }),
    }),
  } as unknown as Tx;
}

describe('ComplaintSubjectPort — LEAD provider', () => {
  it('throws SUBJECT_UNSUPPORTED when called with non-LEAD subject type', async () => {
    const port = createLeadSubjectPort();
    const fakeTx = makeMockTx();

    await expect(port.exists(fakeTx, 'APPLICATION', 'app_test001')).rejects.toThrowError(
      /Complaints about APPLICATION are not supported by the lead provider/,
    );
  });

  it('delegates to database query and returns true when lead exists', async () => {
    const port = createLeadSubjectPort();
    const fakeTx = makeMockTx([{ id: 'lead_01M4TESTLEAD001' }]);

    const exists = await port.exists(fakeTx, 'LEAD', 'lead_01M4TESTLEAD001');
    expect(exists).toBe(true);
  });

  it('returns false without throwing when lead is absent', async () => {
    const port = createLeadSubjectPort();
    const fakeTx = makeMockTx([]);

    const exists = await port.exists(fakeTx, 'LEAD', 'lead_absent');
    expect(exists).toBe(false);
  });

  describe('createCompositeComplaintSubjectPort', () => {
    it('dispatches LEAD to leadPort and APPLICATION to applicationPort', async () => {
      const mockLeadPort = {
        exists: vi.fn().mockResolvedValue(true),
      };
      const mockAppPort = {
        exists: vi.fn().mockResolvedValue(true),
      };

      const composite = createCompositeComplaintSubjectPort({
        lead: mockLeadPort,
        application: mockAppPort,
      });

      const fakeTx = {} as Tx;
      const leadResult = await composite.exists(fakeTx, 'LEAD', 'lead_123');
      expect(leadResult).toBe(true);
      expect(mockLeadPort.exists).toHaveBeenCalledWith(fakeTx, 'LEAD', 'lead_123');
      expect(mockAppPort.exists).not.toHaveBeenCalled();

      const appResult = await composite.exists(fakeTx, 'APPLICATION', 'app_456');
      expect(appResult).toBe(true);
      expect(mockAppPort.exists).toHaveBeenCalledWith(fakeTx, 'APPLICATION', 'app_456');
    });
  });
});
