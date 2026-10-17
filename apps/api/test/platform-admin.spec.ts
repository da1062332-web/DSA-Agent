// apps/api/test/platform-admin.spec.ts — Module 30: Administration and Platform Operations (MOD-ADM) Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin-service';
import { createRouter } from '../src/modules/platform-admin/router';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

describe('Module 30 — Administration and Platform Operations (MOD-ADM)', () => {
  const platformAdmin = testPrincipal({
    id: 'usr_superadmin_01',
    tenantId: 'ten_platform_01',
    grants: [
      { code: 'platform.console', scope: 'TENANT', branchIds: [] },
      { code: 'platform.flags', scope: 'TENANT', branchIds: [] },
      { code: 'platform.master_data', scope: 'TENANT', branchIds: [] },
      { code: 'platform.jobs', scope: 'TENANT', branchIds: [] },
      { code: 'platform.support_access', scope: 'TENANT', branchIds: [] },
      { code: 'platform.release', scope: 'TENANT', branchIds: [] },
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.request', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

  const tenantAdmin = testPrincipal({
    id: 'usr_tenant_admin_99',
    tenantId: 'ten_demo_01',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.request', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

  const unprivilegedUser = testPrincipal({
    id: 'usr_regular_rm_01',
    tenantId: 'ten_demo_01',
    grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }],
  });

  const dummyTxRunner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fn({} as Tx);
    },
  };

  const sharedService = new PlatformAdminService(createTestDeps({ txRunner: dummyTxRunner }));

  const createTestApp = (principal = platformAdmin) => {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    const deps = createTestDeps({ txRunner: dummyTxRunner });
    app.use(createRouter(deps, sharedService));
    app.use(errorHandler());
    return app;
  };

  // ==========================================
  // SUB-ADM.01: Platform Console (API-TEN-002)
  // ==========================================
  describe('SUB-ADM.01 — Platform Console (API-TEN-002)', () => {
    it('returns tenant metadata without business data when requested by authorized operator', async () => {
      const app = createTestApp(platformAdmin);
      const res = await request(app).get('/platform/v1/tenants');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const firstTenant = res.body.data[0];
      expect(firstTenant).toHaveProperty('id');
      expect(firstTenant).toHaveProperty('slug');
      expect(firstTenant).toHaveProperty('legalName');
      expect(firstTenant).toHaveProperty('status');
      expect(firstTenant).toHaveProperty('healthStatus');

      // Crucial constraint: NO customer business data fields exposed
      expect(firstTenant).not.toHaveProperty('leads');
      expect(firstTenant).not.toHaveProperty('customers');
      expect(firstTenant).not.toHaveProperty('pan');
    });

    it('rejects access when user lacks platform.console permission', async () => {
      const app = createTestApp(unprivilegedUser);
      const res = await request(app).get('/platform/v1/tenants');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ==========================================
  // SUB-ADM.02: Feature Flags (API-ADM-001 / API-ADM-002)
  // ==========================================
  describe('SUB-ADM.02 — Feature Flags (API-ADM-001 / API-ADM-002)', () => {
    it('lists active feature flags and supports If-Match optimistic concurrency', async () => {
      const app = createTestApp(platformAdmin);

      // 1. List flags
      const listRes = await request(app).get('/platform/v1/flags');
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);

      // 2. Read single flag with ETag
      const getRes = await request(app).get('/platform/v1/flags/bre.v2_engine');
      expect(getRes.status).toBe(200);
      expect(getRes.headers.etag).toBeDefined();
      const currentEtag = getRes.headers.etag;

      // 3. Update flag with valid If-Match
      const updateRes = await request(app)
        .put('/platform/v1/flags/bre.v2_engine')
        .set('If-Match', currentEtag!)
        .send({
          scope: 'GLOBAL',
          value: false,
          owner: 'QA Engineer',
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.value).toBe(false);

      // 4. Update flag with stale If-Match triggers 409 VERSION_CONFLICT
      const staleRes = await request(app)
        .put('/platform/v1/flags/bre.v2_engine')
        .set('If-Match', '"999"')
        .send({
          scope: 'GLOBAL',
          value: true,
        });
      expect(staleRes.status).toBe(409);
      expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  // ==========================================
  // SUB-ADM.03: Master Data (API-ADM-003)
  // ==========================================
  describe('SUB-ADM.03 — Master Data Management (API-ADM-003)', () => {
    it('supports preview dry-run before permanent import', async () => {
      const app = createTestApp(platformAdmin);

      const payload = {
        listCode: 'PINCODES',
        dryRun: true,
        items: [
          { code: '400050', label: 'Bandra West', attributes: { state: 'Maharashtra', tier: 1 } },
          { code: '400051', label: 'Bandra Kurla Complex', attributes: { state: 'Maharashtra', tier: 1 } },
        ],
      };

      // Preview dry-run
      const previewRes = await request(app).post('/platform/v1/master-data/imports').send(payload);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.dryRun).toBe(true);
      expect(previewRes.body.preview.length).toBe(2);

      // Real import
      const commitRes = await request(app)
        .post('/platform/v1/master-data/imports')
        .send({ ...payload, dryRun: false });
      expect(commitRes.status).toBe(201);
      expect(commitRes.body.dryRun).toBe(false);

      // Verify items present
      const listRes = await request(app).get('/platform/v1/master-data?listCode=PINCODES');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.PINCODES.some((i: { code: string }) => i.code === '400050')).toBe(true);
    });
  });

  // ==========================================
  // SUB-ADM.04: Background Jobs (API-ADM-004 / API-ADM-005)
  // ==========================================
  describe('SUB-ADM.04 — Background Jobs and Queues (API-ADM-004 / API-ADM-005)', () => {
    it('enforces mandatory reason when pausing or resuming a queue', async () => {
      const app = createTestApp(platformAdmin);

      // 1. Pausing without reason fails validation
      const invalidPause = await request(app)
        .post('/platform/v1/queues/outbox-relay/pause')
        .send({ reason: '' });
      expect(invalidPause.status).toBe(422);

      // 2. Pausing with valid reason succeeds
      const validPause = await request(app)
        .post('/platform/v1/queues/outbox-relay/pause')
        .send({ reason: 'Emergency maintenance window scheduled' });
      expect(validPause.status).toBe(200);
      expect(validPause.body.paused).toBe(true);
      expect(validPause.body.pausedReason).toBe('Emergency maintenance window scheduled');

      // 3. Resuming queue succeeds
      const resumeRes = await request(app)
        .post('/platform/v1/queues/outbox-relay/resume')
        .send({ reason: 'Maintenance window completed successfully' });
      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.paused).toBe(false);
    });

    it('supports dead letter inspection and replay', async () => {
      const app = createTestApp(platformAdmin);
      const jobsRes = await request(app).get('/platform/v1/jobs');
      expect(jobsRes.status).toBe(200);
      expect(jobsRes.body.deadLetters.length).toBeGreaterThan(0);

      const dlId = jobsRes.body.deadLetters[0].id;
      const replayRes = await request(app).post(`/platform/v1/dead-letters/${dlId}/replay`);
      expect(replayRes.status).toBe(200);
      expect(replayRes.body.status).toBe('REPLAYED');
    });
  });

  // ==========================================
  // SUB-ADM.05: System Health (CMP-ADM.05.1)
  // ==========================================
  describe('SUB-ADM.05 — System Health', () => {
    it('returns system health and dependencies status', async () => {
      const app = createTestApp(platformAdmin);
      const res = await request(app).get('/platform/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.dependencies.database.status).toBe('UP');
      expect(res.body.dependencies.redisQueue.status).toBe('SIMULATED');
    });
  });

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // ==========================================
  describe('SUB-ADM.06 — Break-Glass Support Access & SOD-06', () => {
    it('enforces 4-hour duration constraint and SOD-06 separation of duties', async () => {
      const app = createTestApp(platformAdmin);

      // 1. Duration > 4.0 hours rejected
      const invalidDuration = await request(app).post('/platform/v1/support-access-requests').send({
        tenantId: 'ten_demo_01',
        reason: 'Diagnose critical bug',
        incidentRef: 'INC-9999',
        durationHours: 6.0, // Exceeds 4 hours max!
      });
      expect(invalidDuration.status).toBe(422);

      // 2. Valid request created (duration <= 4h)
      const validReq = await request(app).post('/platform/v1/support-access-requests').send({
        tenantId: 'ten_demo_01',
        reason: 'Investigate duplicate lead sync exception in Mumbai branch',
        incidentRef: 'INC-2026-4401',
        durationHours: 2.5,
      });
      expect(validReq.status).toBe(201);
      expect(validReq.body.status).toBe('PENDING');
      const grantId = validReq.body.id;

      // 3. SOD-06: Requester CANNOT approve their own request!
      const selfApproval = await request(app)
        .post(`/v1/support-access-requests/${grantId}/approval`)
        .send({ decision: 'APPROVED' });
      expect(selfApproval.status).toBe(403);
      expect(selfApproval.body.error.code).toBe('SOD_VIOLATION');

      // 4. Different tenant admin approves successfully
      const tenantAdminApp = createTestApp(tenantAdmin);
      const approvedRes = await request(tenantAdminApp)
        .post(`/v1/support-access-requests/${grantId}/approval`)
        .send({ decision: 'APPROVED', comments: 'Access approved for 2.5 hours' });
      expect(approvedRes.status).toBe(200);
      expect(approvedRes.body.status).toBe('APPROVED');
      expect(approvedRes.body.approver).toBe(tenantAdmin.id);
    });
  });

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009)
  // ==========================================
  describe('SUB-ADM.07 — Governed Data Correction & SOD-08', () => {
    it('enforces dry-run diff preview and SOD-08 separation of duties', async () => {
      const requesterApp = createTestApp(platformAdmin);

      // 1. Create correction request
      const createRes = await request(requesterApp).post('/v1/data-corrections').send({
        tenantId: 'ten_demo_01',
        justification: 'Remediate malformed pincode metadata in legacy imported customers',
        scriptRef: 'SCR-2026-CORR-01',
        targetEntity: 'CUSTOMER',
        changeDescription: 'Set pincode to 400008 for orphaned branch records',
      });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('PENDING');
      expect(createRes.body.dryRunDiffKey).toBeDefined();
      expect(createRes.body.dryRunDiff).toBeDefined();
      const corrId = createRes.body.id;

      // 2. SOD-08: Requester CANNOT approve their own correction!
      const selfApproval = await request(requesterApp)
        .post(`/v1/data-corrections/${corrId}/approval`)
        .send({ decision: 'APPROVED' });
      expect(selfApproval.status).toBe(403);
      expect(selfApproval.body.error.code).toBe('SOD_VIOLATION');

      // 3. Different approver approves
      const approverApp = createTestApp(tenantAdmin);
      const approveRes = await request(approverApp)
        .post(`/v1/data-corrections/${corrId}/approval`)
        .send({ decision: 'APPROVED', comments: 'Script diff verified against audit criteria' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // 4. Execution succeeds under service identity
      const execRes = await request(approverApp).post(`/v1/data-corrections/${corrId}/execute`);
      expect(execRes.status).toBe(200);
      expect(execRes.body.status).toBe('EXECUTED');
      expect(execRes.body.executedAt).toBeDefined();
    });
  });

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================
  describe('SUB-ADM.08 — Release Management Register', () => {
    it('returns release register with candidate v0.1.0-rc.1 and gate tracking', async () => {
      const app = createTestApp(platformAdmin);
      const res = await request(app).get('/platform/v1/releases');
      expect(res.status).toBe(200);
      expect(res.body.candidate).toBe('v0.1.0-rc.1');
      expect(res.body.releases.length).toBeGreaterThan(0);
      expect(res.body.releases[0].gates.rel001).toBe(true);
    });
  });
});
