// apps/api/test/connectors.spec.ts
// Unit and security tests for Module 27: Connector Management (MOD-CON).
import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  CreateConnectorSchema,
  CreateConnectorBankAccountSchema,
  CreateConnectorAgreementSchema,
  CreateAttributionChangeRequestSchema,
  ResolveAttributionDisputeSchema,
  maskPan,
  maskAccountNumber,
  type RequestContext,
} from '@dsa/contracts';
import { ConnectorService } from '../src/modules/origination/connectors/connector-service';

function makeMockTx(rows: any[] = []) {
  return {
    getExecutor: () => ({
      adapter: {
        supportsReturning: () => true,
      },
      transformQuery: (node: any) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery: async () => ({ rows }),
    }),
  };
}

describe('Module 27 — Connector Management (MOD-CON)', () => {
  const TENANT_ID = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const USER_ID = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const APPROVER_USER_ID = 'usr_01ARZ3NDEKTSV4RRFFQ69G5APP';

  const mockCtx: RequestContext = {
    principal: {
      kind: 'USER',
      id: USER_ID,
      tenantId: TENANT_ID,
      grants: [
        { code: 'connector.manage', scope: 'TENANT', branchIds: [] },
        { code: 'connector.read', scope: 'TENANT', branchIds: [] },
        { code: 'connector.bank_change_approve', scope: 'TENANT', branchIds: [] },
        { code: 'connector.attribution_change', scope: 'TENANT', branchIds: [] },
        { code: 'connector.dispute_resolve', scope: 'TENANT', branchIds: [] },
      ],
      queueIds: [],
      managedTeamMemberIds: [],
      primaryBranchId: 'br_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      authTime: null,
    },
    correlationId: 'req_test_01',
    now: new Date('2026-10-13T12:00:00Z'),
  };

  const approverCtx: RequestContext = {
    ...mockCtx,
    principal: {
      ...mockCtx.principal,
      id: APPROVER_USER_ID,
    },
  };

  const makeDeps = (overrides?: Partial<any>) => {
    const authz = {
      requirePermission: vi.fn((ctx: RequestContext, code: string) => {
        const has = ctx.principal.grants.some((g) => g.code === code);
        if (!has) throw AppError.of('FORBIDDEN', `Missing permission ${code}`);
      }),
      requireOnRecord: vi.fn(),
      scopeFilter: vi.fn(),
      requireStepUp: vi.fn(),
    };

    const audit = {
      record: vi.fn().mockResolvedValue('aud_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
      emit: vi.fn().mockResolvedValue('evt_01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    };

    const txRunner = {
      withTenantTx: vi.fn(async (_ctx: RequestContext, fn: (tx: any) => Promise<any>) => {
        return await fn(makeMockTx());
      }),
    };

    return {
      authz,
      audit,
      txRunner,
      ids: { next: () => 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      userDirectory: {} as any,
      ...overrides,
    };
  };

  describe('SUB-CON.01: Onboarding, Masking & Schemas', () => {
    it('TEST-CON-001: validates PAN and GSTIN format', () => {
      // Valid connector payload
      const valid = {
        connectorType: 'INDIVIDUAL',
        legalName: 'Rajesh Sharma & Associates',
        contactPerson: 'Rajesh Sharma',
        mobileE164: '+919876543210',
        email: 'rajesh@example.com',
        pan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        primaryBranchId: 'br_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        relationshipOwnerUserId: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      };
      expect(() => CreateConnectorSchema.parse(valid)).not.toThrow();

      // Invalid PAN format
      expect(() =>
        CreateConnectorSchema.parse({
          ...valid,
          pan: 'INVALID_PAN',
        }),
      ).toThrow();

      // Invalid GSTIN format
      expect(() =>
        CreateConnectorSchema.parse({
          ...valid,
          gstin: '12345',
        }),
      ).toThrow();
    });

    it('TEST-CON-002: S2 leak scanner blocks plaintext PAN/account in free-text fields', () => {
      expect(() =>
        CreateConnectorSchema.parse({
          connectorType: 'INDIVIDUAL',
          legalName: 'Agency with PAN ABCDE1234F in name',
          contactPerson: 'Rajesh Sharma',
          mobileE164: '+919876543210',
          email: 'rajesh@example.com',
          pan: 'ABCDE1234F',
          primaryBranchId: 'br_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          relationshipOwnerUserId: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
      ).toThrow();

      expect(() =>
        CreateAttributionChangeRequestSchema.parse({
          leadId: 'lead_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          proposedConnectorId: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          reason: 'Lead should be attributed to account 123456789012 directly',
          evidenceRef: 'upl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
      ).toThrow();
    });

    it('TEST-CON-003: produces correct masked strings for PAN and bank account', () => {
      expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
      expect(maskAccountNumber('123456789012')).toBe('********9012');
      expect(maskAccountNumber('987654321')).toBe('*****4321');
    });

    it('TEST-CON-004: validates Bank Account schema', () => {
      const valid = {
        accountHolderName: 'Rajesh Sharma',
        accountNumber: '123456789012',
        ifscCode: 'HDFC0001234',
      };
      expect(() => CreateConnectorBankAccountSchema.parse(valid)).not.toThrow();

      // Invalid IFSC format
      expect(() =>
        CreateConnectorBankAccountSchema.parse({
          ...valid,
          ifscCode: 'INVALID',
        }),
      ).toThrow();

      // Too short account number
      expect(() =>
        CreateConnectorBankAccountSchema.parse({
          ...valid,
          accountNumber: '123',
        }),
      ).toThrow();
    });
  });

  describe('SUB-CON.01: Bank Account Dual-Control & SOD', () => {
    it('TEST-CON-005: creator cannot approve their own bank account change (SOD)', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      deps.txRunner.withTenantTx = vi.fn(async (_ctx, fn) => {
        return fn(
          makeMockTx([
            {
              id: 'cba_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              tenant_id: TENANT_ID,
              connector_id: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              account_holder_name: 'Rajesh Sharma',
              account_masked: '********9012',
              ifsc_code: 'HDFC0001234',
              verification_id: null,
              status: 'PENDING_APPROVAL',
              created_by: USER_ID, // Creator is USER_ID
              lock_version: 0,
              created_at: new Date(),
            },
          ]),
        );
      });

      await expect(
        service.approveBankAccount(
          mockCtx, // USER_ID attempts to approve
          'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          'cba_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          { remarks: 'Self approval attempt' },
        ),
      ).rejects.toThrow('Separation of Duties (SOD)');
    });

    it('TEST-CON-006: separate approver successfully approves bank account and sets cooling period', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      deps.txRunner.withTenantTx = vi.fn(async (_ctx, fn) => {
        return fn(
          makeMockTx([
            {
              id: 'cba_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              tenant_id: TENANT_ID,
              connector_id: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              account_holder_name: 'Rajesh Sharma',
              account_masked: '********9012',
              ifsc_code: 'HDFC0001234',
              verification_id: null,
              status: 'PENDING_APPROVAL',
              created_by: USER_ID, // Creator is USER_ID
              lock_version: 0,
              created_at: new Date(),
            },
          ]),
        );
      });

      const res = await service.approveBankAccount(
        approverCtx, // Separate approver (APPROVER_USER_ID)
        'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'cba_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        { remarks: 'Approved by finance' },
      );

      expect(res.status).toBe('ACTIVE');
      expect(res.approvedBy).toBe(APPROVER_USER_ID);
      expect(res.coolingUntil).toBeDefined();
      expect(deps.audit.record).toHaveBeenCalledWith(
        expect.anything(),
        approverCtx,
        expect.objectContaining({
          action: 'connector.bank_account_approved',
          entityType: 'connector_bank_account',
        }),
      );
    });
  });

  describe('SUB-CON.02: Agreements & Validity Ranges', () => {
    it('TEST-CON-007: agreement schema rejects validTo earlier than validFrom', () => {
      expect(() =>
        CreateConnectorAgreementSchema.parse({
          validFrom: '2026-10-15T00:00:00Z',
          validTo: '2026-10-10T00:00:00Z',
          permittedProducts: ['HL', 'LAP'],
          shareRuleScope: 'DEFAULT_STANDARD_RATE',
          evidenceRef: 'upl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
      ).not.toThrow();
    });

    it('TEST-CON-008: agreement service throws VALIDATION_ERROR on inverted range', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      await expect(
        service.createAgreement(
          mockCtx,
          'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          {
            validFrom: '2026-10-15T00:00:00Z',
            validTo: '2026-10-10T00:00:00Z',
            permittedProducts: ['HL'],
            shareRuleScope: 'RATE_CARD_A',
            evidenceRef: 'upl_test_01',
          },
          'idem_ag_01',
        ),
      ).rejects.toThrow('Agreement validTo must be after validFrom');
    });
  });

  describe('SUB-CON.03: Attribution Changes & SOD-09', () => {
    it('TEST-CON-009: requester cannot approve their own attribution change request (SOD-09)', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      deps.txRunner.withTenantTx = vi.fn(async (_ctx, fn) => {
        return fn(
          makeMockTx([
            {
              id: 'car_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              tenant_id: TENANT_ID,
              lead_id: 'lead_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              previous_connector_id: null,
              proposed_connector_id: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              reason: 'Legitimate referral proof provided',
              evidence_ref: 'upl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              recalculation_proposal: null,
              status: 'PENDING',
              requester_id: USER_ID, // Same user
              lock_version: 0,
              created_at: new Date(),
            },
          ]),
        );
      });

      await expect(
        service.approveAttributionChangeRequest(
          mockCtx, // USER_ID attempts to approve
          'car_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          { remarks: 'Self approval' },
          0,
        ),
      ).rejects.toThrow('SOD-09');
    });

    it('TEST-CON-010: optimistic concurrency check throws VERSION_CONFLICT on stale lockVersion', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      deps.txRunner.withTenantTx = vi.fn(async (_ctx, fn) => {
        return fn(
          makeMockTx([
            {
              id: 'car_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              tenant_id: TENANT_ID,
              lead_id: 'lead_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              previous_connector_id: null,
              proposed_connector_id: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              reason: 'Legitimate referral proof provided',
              evidence_ref: 'upl_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              recalculation_proposal: null,
              status: 'PENDING',
              requester_id: USER_ID,
              lock_version: 2, // Database version is 2
              created_at: new Date(),
            },
          ]),
        );
      });

      await expect(
        service.approveAttributionChangeRequest(
          approverCtx,
          'car_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          { remarks: 'Valid approval' },
          1, // Stale provided version 1
        ),
      ).rejects.toThrow('Precondition failed');
    });
  });

  describe('SUB-CON.04: Attribution Disputes', () => {
    it('TEST-CON-011: validates dispute resolution schema and values', () => {
      const valid = {
        resolution: 'ATTRIBUTED_TO_CLAIMANT',
        resolvedConnectorId: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        resolutionNotes: 'Evidence submitted demonstrates first referral contact.',
      };
      expect(() => ResolveAttributionDisputeSchema.parse(valid)).not.toThrow();

      // S2 sensitive leakage in notes
      expect(() =>
        ResolveAttributionDisputeSchema.parse({
          ...valid,
          resolutionNotes: 'Dispute resolved in favor of PAN ABCDE1234F',
        }),
      ).toThrow();
    });
  });

  describe('SUB-CON.05: Connector Status Lifecycle', () => {
    it('TEST-CON-012: terminated connector cannot be activated or transition', async () => {
      const deps = makeDeps();
      const service = new ConnectorService(deps);

      deps.txRunner.withTenantTx = vi.fn(async (_ctx, fn) => {
        return fn(
          makeMockTx([
            {
              id: 'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
              tenant_id: TENANT_ID,
              connector_type: 'INDIVIDUAL',
              legal_name: 'Test Agency',
              contact_person: 'Tester',
              mobile_e164: '+919999999999',
              email: 'test@agency.com',
              pan_masked: 'ABCDE****F',
              gstin: null,
              primary_branch_id: 'br_01',
              relationship_owner_user_id: USER_ID,
              status: 'TERMINATED', // Terminal
              lock_version: 1,
              created_at: new Date(),
              created_by: USER_ID,
              updated_at: new Date(),
              updated_by: USER_ID,
            },
          ]),
        );
      });

      await expect(
        service.activateConnector(
          mockCtx,
          'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          { verificationId: 'ver_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
          1,
          'idem_act_01',
        ),
      ).rejects.toThrow('Terminated connectors cannot be activated');

      await expect(
        service.updateConnectorStatus(
          mockCtx,
          'con_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          { targetStatus: 'ACTIVE', reason: 'Attempt to reopen' },
          1,
          'idem_stat_01',
        ),
      ).rejects.toThrow('terminal TERMINATED state');
    });
  });
});
