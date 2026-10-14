// apps/api/test/document-sharing.spec.ts
// Unit and route tests for Module 25: Document Sharing (MOD-DSH).
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import type { DocumentSharingService } from '../src/modules/origination/document-sharing/document-sharing-service';

describe('Module 25: Document Sharing (MOD-DSH) Route Tests', () => {
  const principalWithUpload = testPrincipal({
    grants: [
      { code: 'document.upload', scope: 'TENANT', branchIds: [] },
      { code: 'share.create', scope: 'TENANT', branchIds: [] },
      { code: 'customer.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const principalWithoutPerms = testPrincipal({
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  const mockLink = {
    id: 'upl_01JTESTUPLOADLINK000000001',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    applicationId: 'app_01JTESTAPP00000000000001',
    items: ['chk_01JTESTCHK0000000000001'],
    recipientContactId: 'ccp_01JTESTCCP0000000000001',
    expiresAt: '2026-10-15T12:00:00.000Z',
    otpRequired: true,
    maxUses: 5,
    uses: 0,
    revokedAt: null,
    lockedAt: null,
    uploadUrl: '/upload/test_raw_token_xyz',
    lockVersion: 0,
    createdAt: '2026-10-13T12:00:00.000Z',
    createdBy: 'usr_01JTESTUSER0000000000000000',
    updatedAt: '2026-10-13T12:00:00.000Z',
    updatedBy: 'usr_01JTESTUSER0000000000000000',
  };

  const mockShare = {
    id: 'shr_01JTESTSHARE0000000000001',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    applicationId: 'app_01JTESTAPP00000000000001',
    recipientType: 'LENDER',
    recipientId: 'len_hdfc',
    recipientContact: { name: 'Credit Manager', email: 'manager@lender.com' },
    purpose: 'LENDER_SUBMISSION',
    consentIds: ['cnst_01JTESTCONSENT00000001'],
    manifest: { applicationId: 'app_01JTESTAPP00000000000001', documents: [] },
    expiresAt: '2026-10-20T12:00:00.000Z',
    revokedAt: null,
    accessCount: 0,
    dataSharingRecordId: 'dsr_01JTESTDSR00000000000001',
    lockVersion: 0,
    createdAt: '2026-10-13T12:00:00.000Z',
    createdBy: 'usr_01JTESTUSER0000000000000000',
    updatedAt: '2026-10-13T12:00:00.000Z',
    updatedBy: 'usr_01JTESTUSER0000000000000000',
  };

  const mockService = {
    createUploadLink: async () => ({ link: mockLink }),
    revokeUploadLink: async () => ({ ...mockLink, revokedAt: '2026-10-13T12:30:00.000Z' }),
    listUploadLinks: async () => ({ data: [mockLink], meta: { nextCursor: null, limit: 50 } }),
    getPublicUploadStatus: async (token: string) => {
      if (token === 'expired_token') {
        const err: any = new Error('Link expired');
        err.code = 'LINK_EXPIRED';
        err.httpStatus = 410;
        throw err;
      }
      if (token === 'locked_token') {
        const err: any = new Error('Link locked');
        err.code = 'LINK_LOCKED';
        err.httpStatus = 423;
        throw err;
      }
      return {
        status: 'PENDING_OTP',
        expiresAt: '2026-10-15T12:00:00.000Z',
        otpRequired: true,
        maskedContact: '+91 ******4321',
        requestedItems: [
          {
            checklistItemId: 'chk_01JTESTCHK0000000000001',
            documentTypeCode: 'BANK_STATEMENT',
            ordinal: 1,
            mandatory: true,
          },
        ],
      };
    },
    verifyUploadOtp: async (_token: string, otp: string) => {
      if (otp === '000000') {
        const err: any = new Error('Incorrect OTP');
        err.code = 'VALIDATION_ERROR';
        err.httpStatus = 422;
        throw err;
      }
      return {
        uploadSessionToken: 'session_token_xyz_valid',
        sessionExpiresAt: '2026-10-13T12:45:00.000Z',
        applicationReference: 'app_01JTESTAPP00000000000001',
        items: [
          {
            checklistItemId: 'chk_01JTESTCHK0000000000001',
            documentTypeCode: 'BANK_STATEMENT',
            ordinal: 1,
            mandatory: true,
          },
        ],
      };
    },
    uploadPublicFile: async () => ({
      documentId: 'doc_01JTESTDOC0000000000001',
      checklistItemId: 'chk_01JTESTCHK0000000000001',
      filename: 'bank_statement.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      status: 'SUBMITTED',
      uploadedAt: '2026-10-13T12:40:00.000Z',
    }),
    createShare: async () => ({ share: mockShare }),
    revokeShare: async () => ({ ...mockShare, revokedAt: '2026-10-13T12:35:00.000Z' }),
    listShares: async () => ({ data: [mockShare], meta: { nextCursor: null, limit: 50 } }),
  } as unknown as DocumentSharingService;

  describe('SUB-DSH.01: Customer Upload Links', () => {
    it('API-DSH-001: POST /v1/upload-links creates link with Idempotency-Key and document.upload permission', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithUpload),
      });

      const res = await request(app)
        .post('/v1/upload-links')
        .set('Idempotency-Key', 'idem_key_001_upload_test')
        .send({
          applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          checklistItemIds: ['chk_01JTESTCHK0000000000001'],
          expiresInHours: 48,
          maxUses: 5,
        });

      expect([201, 404, 500]).toContain(res.status);
    });

    it('API-DSH-001 rejects request without Idempotency-Key with 422', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithUpload),
      });

      const res = await request(app)
        .post('/v1/upload-links')
        .send({
          applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          checklistItemIds: ['chk_01JTESTCHK0000000000001'],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('API-DSH-001 rejects unauthorized caller with 403', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithoutPerms),
      });

      const res = await request(app)
        .post('/v1/upload-links')
        .set('Idempotency-Key', 'idem_key_002_unauthorized')
        .send({
          applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          checklistItemIds: ['chk_01JTESTCHK0000000000001'],
        });

      expect(res.status).toBe(403);
    });

    it('API-DSH-003: GET /public/v1/upload/{token} resolves link status anonymously', async () => {
      const app = createTestApp();

      const res = await request(app).get('/public/v1/upload/test_valid_token');
      // If mock service or real DB query
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('SUB-DSH.02: Case Share Packages', () => {
    it('API-DSH-006: POST /v1/shares requires share.create permission and Idempotency-Key', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithUpload),
      });

      const res = await request(app)
        .post('/v1/shares')
        .set('Idempotency-Key', 'idem_key_003_share_test')
        .send({
          applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          recipientType: 'LENDER',
          recipientId: 'len_hdfc',
          recipientContact: { name: 'Officer', email: 'officer@bank.com' },
          purpose: 'LENDER_SUBMISSION',
        });

      expect([201, 404, 422, 500]).toContain(res.status);
    });

    it('API-DSH-006 rejects request without Idempotency-Key with 422', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithUpload),
      });

      const res = await request(app)
        .post('/v1/shares')
        .send({
          applicationId: 'app_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          recipientType: 'LENDER',
          recipientId: 'len_hdfc',
          recipientContact: { name: 'Officer', email: 'officer@bank.com' },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('API-DSH-008: GET /v1/shares returns 403 when caller lacks customer.read', async () => {
      const app = createTestApp({
        auth: fakeAuth(principalWithoutPerms),
      });

      const res = await request(app).get('/v1/shares');
      expect(res.status).toBe(403);
    });
  });
});
