// apps/api/test/compliance.spec.ts — Module 29: Privacy and Consent (MOD-PRV) Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { ComplianceService } from '../src/modules/compliance/compliance-service';
import { PostgresDataSharingPort } from '../src/modules/compliance/data-sharing-port';
import { createRouter } from '../src/modules/compliance/router';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

describe('Module 29 — Privacy and Consent (MOD-PRV)', () => {
  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';

  const complianceAuditor = testPrincipal({
    tenantId: tenantA,
    grants: [
      { code: 'audit.read', scope: 'TENANT', branchIds: [] },
      { code: 'customer.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  const customerViewer = testPrincipal({
    tenantId: tenantA,
    grants: [{ code: 'customer.read', scope: 'TENANT', branchIds: [] }],
  });

  const unprivilegedUser = testPrincipal({
    tenantId: tenantA,
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  const foreignTenantAuditor = testPrincipal({
    tenantId: tenantB,
    grants: [{ code: 'audit.read', scope: 'TENANT', branchIds: [] }],
  });

  const dummyTxRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fn({} as Tx);
    },
  };

  describe('PostgresDataSharingPort (SUB-PRV.05)', () => {
    it('defines record method for data sharing inventory', async () => {
      const port = new PostgresDataSharingPort();
      expect(port.record).toBeDefined();
    });
  });

  describe('Compliance API Endpoints', () => {
    class MockComplianceService extends ComplianceService {
      public sharingRecords = [
        {
          id: 'dsr_01JTESTRECORD00000000000001',
          tenantId: tenantA,
          subjectType: 'LOAN_APPLICATION' as const,
          subjectId: 'app_01JTESTAPP0000000000000001',
          recipientType: 'LENDER' as const,
          recipientId: 'lnd_hdfc',
          purpose: 'LENDER_SUBMISSION' as const,
          consentIds: ['cns_01JTESTCONSENT00000000001'],
          items: { fields: ['PAN', 'MOBILE'], checklistItemIds: ['chk_1'] },
          channel: 'PORTAL' as const,
          sourceRef: 'shr_01JTESTSHARE00000000000001',
          actorId: 'usr_staff_1',
          sharedAt: new Date().toISOString(),
        },
      ];

      constructor(deps: any) {
        super(deps);
      }

      override async listDataSharingRecords(ctx: RequestContext, query: any): Promise<any> {
        this.checkAuthz(ctx);
        const filtered = this.sharingRecords.filter((r) => r.tenantId === ctx.principal.tenantId);
        return {
          items: filtered,
          total: filtered.length,
          limit: query.limit,
          offset: query.offset,
        };
      }

      override async getPrivacyStats(ctx: RequestContext): Promise<any> {
        this.checkAuthz(ctx);
        return {
          activeConsentsCount: 42,
          withdrawnConsentsCount: 3,
          totalSharingRecordsCount: 15,
          consentsByPurpose: {
            LOAN_PROCESSING: 25,
            SHARE_WITH_LENDER: 12,
            VERIFICATION_CHECK: 5,
          },
          sharingByRecipientType: {
            LENDER: 14,
            AUDITOR: 1,
          },
          protectionPolicies: [
            {
              field: 'auth_credentials',
              tier: 'S4',
              strategy: 'ENCRYPTION_AT_REST_AND_VAULT',
              description: 'Passwords and secrets encrypted at rest; never exposed.',
            },
            {
              field: 'government_id_aadhaar',
              tier: 'S3',
              strategy: 'STRICT_LEAK_DETECTION_REGEX',
              description: 'Aadhaar regex leak detection.',
            },
          ],
        };
      }

      override async verifyConsent(ctx: RequestContext, input: any): Promise<any> {
        this.checkAuthz(ctx);
        if (input.customerId === 'cust_active') {
          return {
            hasConsent: true,
            consentId: 'cns_active_01',
            source: 'CUSTOMER',
            purpose: input.purpose,
            purposeTarget: null,
            status: 'ACTIVE',
            channel: 'DIGITAL_FORM',
            noticeVersion: 'NV-2026.1',
            createdAt: new Date().toISOString(),
          };
        }
        if (input.customerId === 'cust_withdrawn') {
          return {
            hasConsent: false,
            consentId: 'cns_withdrawn_01',
            source: 'CUSTOMER',
            purpose: input.purpose,
            purposeTarget: null,
            status: 'WITHDRAWN',
            channel: 'DIGITAL_FORM',
            noticeVersion: 'NV-2026.1',
            createdAt: new Date().toISOString(),
          };
        }
        return {
          hasConsent: false,
          consentId: null,
          source: null,
          purpose: input.purpose,
          purposeTarget: null,
          status: 'MISSING',
          channel: null,
          noticeVersion: null,
          createdAt: null,
        };
      }
    }

    function makeApp(principal = complianceAuditor, serviceOverride?: ComplianceService) {
      const app = express();
      app.use(express.json());
      app.use(fakeAuth(principal));
      const deps = createTestDeps({ txRunner: dummyTxRunner });
      const service = serviceOverride ?? new MockComplianceService(deps);
      const router = createRouter(deps, service);
      app.use('/v1', router);
      app.use(errorHandler());
      return app;
    }

    it('rejects unprivileged user accessing data sharing inventory with 403', async () => {
      const app = makeApp(unprivilegedUser);
      const res = await request(app).get('/v1/compliance/data-sharing-records');
      expect(res.status).toBe(403);
    });

    it('allows auditor with audit.read to fetch privacy stats', async () => {
      const app = makeApp(complianceAuditor);
      const res = await request(app).get('/v1/compliance/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('protectionPolicies');
      expect(Array.isArray(res.body.protectionPolicies)).toBe(true);
      expect(res.body.protectionPolicies.some((p: any) => p.tier === 'S3')).toBe(true);
    });

    it('mirrors endpoints on /v1/privacy path aliases', async () => {
      const app = makeApp(complianceAuditor);
      const res = await request(app).get('/v1/privacy/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('protectionPolicies');
    });

    it('verifies consent successfully for active customer consent', async () => {
      const app = makeApp(complianceAuditor);
      const res = await request(app)
        .post('/v1/compliance/consent-check')
        .send({
          customerId: 'cust_active',
          purpose: 'LOAN_PROCESSING',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hasConsent');
      expect(res.body.purpose).toBe('LOAN_PROCESSING');
    });

    it('validates invalid purpose on consent check with 422 validation error', async () => {
      const app = makeApp(complianceAuditor);
      const res = await request(app)
        .post('/v1/compliance/consent-check')
        .send({
          customerId: 'cust_active',
          purpose: 'INVALID_PURPOSE_CODE',
        });

      expect(res.status).toBe(422);
    });

    it('filters data sharing records by tenant isolation', async () => {
      const appB = makeApp(foreignTenantAuditor);
      const res = await request(appB).get('/v1/compliance/data-sharing-records');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });
  });
});
