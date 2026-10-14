// apps/api/test/verifications.spec.ts
// Unit and security tests for Module 22: Verification (MOD-VER).
import { describe, expect, it, vi } from 'vitest';
import {
  AppError,
  type CreateVerificationInput,
  type RequestContext,
} from '@dsa/contracts';
import { VerificationService } from '../src/modules/origination/verifications/verification-service';

describe('Module 22 — Verification (MOD-VER)', () => {
  const TENANT_ID = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const USER_ID = 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV';

  const mockCtx: RequestContext = {
    principal: {
      kind: 'USER',
      id: USER_ID,
      tenantId: TENANT_ID,
      grants: [
        { code: 'verification.perform', scope: 'TENANT', branchIds: [] },
        { code: 'verification.read', scope: 'TENANT', branchIds: [] },
      ],
      queueIds: [],
      managedTeamMemberIds: [],
      primaryBranchId: null,
      authTime: null,
    },
    correlationId: 'req_test_01',
    now: new Date('2026-10-13T12:00:00Z'),
  };

  const makeDeps = (overrides?: Partial<any>) => {
    const authz = {
      requirePermission: vi.fn((ctx: RequestContext, code: string) => {
        const has = ctx.principal.grants.some((g) => g.code === code);
        if (!has) throw AppError.of('FORBIDDEN', `Missing permission ${code}`);
      }),
      requireOnRecord: vi.fn(),
      scopeFilter: vi.fn(),
    };

    const audit = {
      record: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn().mockResolvedValue(undefined),
    };

    const txRunner = {
      withTenantTx: vi.fn(async (_ctx: RequestContext, fn: (tx: any) => Promise<any>) => {
        const fakeTx = {};
        return await fn(fakeTx);
      }),
    };

    return {
      authz,
      audit,
      txRunner,
      ids: { next: () => 'ver_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      userDirectory: {} as any,
      ...overrides,
    };
  };

  describe('Legal & Security Guard: Aadhaar Protection (ADR-4D-04)', () => {
    it('TEST-VER-SEC-001: rejects any verification payload containing a 12-digit Aadhaar number', async () => {
      const deps = makeDeps();
      const service = new VerificationService(deps as any);

      const payloadWithAadhaar: CreateVerificationInput = {
        subjectType: 'CUSTOMER',
        subjectId: 'cust_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkType: 'IDENTITY_DOCUMENT',
        method: 'MANUAL',
        purpose: 'KYC',
        consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        result: 'VERIFIED',
        minimalResult: {
          statusDescription: 'Verified via Aadhaar XML',
          maskedIdentifier: '987654321098', // 12-digit raw Aadhaar!
        },
        evidenceRef: 'aadhaar_scan.pdf',
      };

      await expect(
        service.createVerification(mockCtx, payloadWithAadhaar, 'idem_key_01'),
      ).rejects.toThrow('Storage of full 12-digit Aadhaar numbers is strictly prohibited');
    });

    it('TEST-VER-SEC-002: rejects raw 12-digit numbers inside notes field', async () => {
      const deps = makeDeps();
      const service = new VerificationService(deps as any);

      const payloadWithAadhaarInNotes: CreateVerificationInput = {
        subjectType: 'CUSTOMER',
        subjectId: 'cust_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkType: 'IDENTITY_DOCUMENT',
        method: 'MANUAL',
        purpose: 'KYC',
        consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        result: 'VERIFIED',
        minimalResult: {
          statusDescription: 'Verified via card inspection',
          maskedIdentifier: 'XXXXXXXX1098',
        },
        evidenceRef: 'aadhaar_scan.pdf',
        notes: 'Borrower provided card with UID 123456789012 for validation',
      };

      await expect(
        service.createVerification(mockCtx, payloadWithAadhaarInNotes, 'idem_key_02'),
      ).rejects.toThrow('Storage of full 12-digit Aadhaar numbers is strictly prohibited');
    });
  });

  describe('Authorization & RBAC Enforcement', () => {
    it('TEST-VER-AUTH-001: rejects createVerification if principal lacks verification.perform', async () => {
      const deps = makeDeps();
      const service = new VerificationService(deps as any);

      const unprivilegedCtx: RequestContext = {
        ...mockCtx,
        principal: {
          ...mockCtx.principal,
          grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
        },
      };

      const validPayload: CreateVerificationInput = {
        subjectType: 'LOAN_APPLICATION',
        subjectId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        checkType: 'PAN',
        method: 'MANUAL',
        purpose: 'KYC',
        consentRecordId: 'cnst_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        result: 'VERIFIED',
        minimalResult: {
          statusDescription: 'PAN verified',
          maskedIdentifier: 'ABCDE****F',
        },
        evidenceRef: 'doc_pan.pdf',
      };

      await expect(
        service.createVerification(unprivilegedCtx, validPayload, 'idem_key_03'),
      ).rejects.toThrow('Missing permission verification.perform');
    });

    it('TEST-VER-AUTH-002: rejects listVerifications if principal lacks verification.read', async () => {
      const deps = makeDeps();
      const service = new VerificationService(deps as any);

      const unprivilegedCtx: RequestContext = {
        ...mockCtx,
        principal: {
          ...mockCtx.principal,
          grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
        },
      };

      await expect(
        service.listVerifications(unprivilegedCtx, { limit: 10 }),
      ).rejects.toThrow('Missing permission verification.read');
    });
  });
});
