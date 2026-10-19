// apps/api/test/platform-admin.spec.ts — Module 30: Administration and Platform Operations (MOD-ADM) Test Suite
import {
  PLATFORM_TENANT_ID,
  type AuditEventInput,
  type RequestContext,
  type Tx,
  type TxRunner,
} from '@dsa/contracts';
import express from 'express';
import {
  Kysely,
  PostgresAdapter,
  type DatabaseConnection,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { PlatformAdminService } from '../src/modules/platform-admin/platform-admin-service';
import { InMemoryPlatformStore } from '../src/modules/platform-admin/platform-store';
import { createPlatformRouter, createRouter } from '../src/modules/platform-admin/router';
import { createTestDeps, fakeAuth, testPrincipal } from './support/fake-auth';

describe('Module 30 — Administration and Platform Operations (MOD-ADM)', () => {
  // Platform realm: a user of the platform tenant. Platform operators never hold tenant permissions.
  const platformAdmin = testPrincipal({
    id: 'usr_superadmin_01',
    tenantId: PLATFORM_TENANT_ID,
    grants: [
      { code: 'platform.console', scope: 'TENANT', branchIds: [] },
      { code: 'platform.flags', scope: 'TENANT', branchIds: [] },
      { code: 'platform.master_data', scope: 'TENANT', branchIds: [] },
      { code: 'platform.jobs', scope: 'TENANT', branchIds: [] },
      { code: 'platform.support_access', scope: 'TENANT', branchIds: [] },
      { code: 'platform.release', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Tenant realm: an administrator of a customer tenant. It holds the tenant permissions only.
  const tenantAdmin = testPrincipal({
    id: 'usr_tenant_admin_99',
    tenantId: 'ten_demo_01',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.request', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Someone who may ask for a data correction but not approve one.
  const tenantRequester = testPrincipal({
    id: 'usr_branch_mgr_07',
    tenantId: 'ten_demo_01',
    grants: [{ code: 'data_correction.request', scope: 'TENANT', branchIds: [] }],
  });

  // The correction executor: a service identity bound to one tenant by its token.
  const executorFor = (tenantId: string) =>
    testPrincipal({ kind: 'SERVICE', id: 'SYSTEM:data-correction-executor', tenantId, grants: [] });

  // An administrator of a different customer tenant.
  const otherTenantAdmin = testPrincipal({
    id: 'usr_other_admin_55',
    tenantId: 'ten_other_01',
    grants: [
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.request', scope: 'TENANT', branchIds: [] },
      { code: 'data_correction.approve', scope: 'TENANT', branchIds: [] },
    ],
  });

  // The bug this realm model closes: a tenant administrator who holds platform permission codes (as migration 0046 granted).
  const tenantAdminWithPlatformCodes = testPrincipal({
    id: 'usr_tenant_admin_98',
    tenantId: 'ten_demo_01',
    grants: [
      { code: 'platform.console', scope: 'TENANT', branchIds: [] },
      { code: 'platform.flags', scope: 'TENANT', branchIds: [] },
      { code: 'platform.support_access', scope: 'TENANT', branchIds: [] },
      { code: 'platform.jobs', scope: 'TENANT', branchIds: [] },
      { code: 'platform.release', scope: 'TENANT', branchIds: [] },
      { code: 'platform.master_data', scope: 'TENANT', branchIds: [] },
      { code: 'config.manage', scope: 'TENANT', branchIds: [] },
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

  const auditLog: AuditEventInput[] = [];
  const recordingAudit = {
    async record(_tx: Tx, _ctx: RequestContext, e: AuditEventInput): Promise<string> {
      auditLog.push(e);
      return 'aud_test';
    },
  };
  const store = new InMemoryPlatformStore();
  store.tenants.push(
    {
      id: 'ten_demo_01',
      slug: 'demo-alpha',
      legalName: 'Alpha Demo Finserv Pvt Ltd',
      tenantType: 'DSA_ORG',
      dataRegion: 'IN',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: 'SYSTEM:platform',
      healthStatus: 'HEALTHY',
      activeUsersCount: 14,
      applicationsCount: null,
      entitlements: [],
    },
    {
      id: 'ten_other_01',
      slug: 'other-tenant',
      legalName: 'Other Tenant',
      tenantType: 'DSA_ORG',
      dataRegion: 'IN',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      createdAt: '2026-10-02T00:00:00.000Z',
      createdBy: 'SYSTEM:platform',
      healthStatus: 'HEALTHY',
      activeUsersCount: 3,
      applicationsCount: null,
      entitlements: [],
    },
  );
  const testDeps = () => createTestDeps({ txRunner: dummyTxRunner, audit: recordingAudit });
  const sharedService = new PlatformAdminService(testDeps(), store);

  const createTestApp = (principal = platformAdmin) => {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    app.use('/platform', createPlatformRouter(testDeps(), sharedService));
    app.use('/v1', createRouter(testDeps(), sharedService));
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

    it('TEST-REALM-001 a tenant administrator holding every platform permission code is still refused on every platform route', async () => {
      const app = createTestApp(tenantAdminWithPlatformCodes);
      const routes: [string, string][] = [
        ['get', '/platform/v1/tenants'],
        ['get', '/platform/v1/flags'],
        ['get', '/platform/v1/master-data'],
        ['get', '/platform/v1/jobs'],
        ['get', '/platform/v1/health'],
        ['get', '/platform/v1/releases'],
        ['post', '/platform/v1/support-access-requests'],
      ];
      for (const [method, path] of routes) {
        const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(
          path,
        ).send({});
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });

    it('TEST-REALM-009 a refused attempt on a platform route is itself audited, with the permission it wanted', async () => {
      auditLog.length = 0;
      const res = await request(createTestApp(tenantAdminWithPlatformCodes)).get('/platform/v1/flags');
      expect(res.status).toBe(403);
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]).toMatchObject({
        action: 'platform.access_denied',
        permissionUsed: 'platform.flags',
        after: { realm: 'platform', principalKind: 'USER' },
      });
    });

    it('TEST-REALM-002 a service identity gets no shortcut: it is refused on platform and tenant routes', async () => {
      const service = testPrincipal({
        kind: 'SERVICE',
        id: 'SYSTEM:test',
        tenantId: PLATFORM_TENANT_ID,
        grants: [],
      });
      const app = createTestApp(service);
      expect((await request(app).get('/platform/v1/tenants')).status).toBe(403);
      expect((await request(app).get('/v1/data-corrections')).status).toBe(403);
    });

    it('TEST-REALM-003 a platform action is written to the audit trail with the reason and the permission used', async () => {
      auditLog.length = 0;
      await request(createTestApp(platformAdmin))
        .post('/platform/v1/queues/outbox-relay/pause')
        .send({ reason: 'Audit trail check for the platform realm' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]).toMatchObject({
        action: 'platform.queue_paused',
        entityId: 'outbox-relay',
        reason: 'Audit trail check for the platform realm',
        permissionUsed: 'platform.jobs',
      });
      await request(createTestApp(platformAdmin))
        .post('/platform/v1/queues/outbox-relay/resume')
        .send({ reason: 'Audit trail check finished here' });
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
    it('TEST-ADM-JOBS-01 the queue figures and dead letters say they are sample data, so nobody mistakes them for a live queue', async () => {
      const res = await request(createTestApp(platformAdmin)).get('/platform/v1/jobs');
      expect(res.status).toBe(200);
      expect(res.body.sampleData).toBe(true);
      expect(res.body.notice).toMatch(/Sample data/);
      expect(res.body.notice).toMatch(/Release 2/);
    });

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
    /** A transaction runner whose database answers the health probe like Postgres would (50 of 200 connection slots in use). */
    const answeringRunner = (): TxRunner => {
      const connection: DatabaseConnection = {
        async executeQuery<R>() {
          return { rows: [{ in_use: 50, max_connections: 200 }] as R[] };
        },
        // eslint-disable-next-line require-yield
        async *streamQuery() {
          throw new Error('not used');
        },
      };
      const db = new Kysely<Record<string, never>>({
        dialect: {
          createAdapter: () => new PostgresAdapter(),
          createDriver: () => ({
            async init() {},
            async acquireConnection() {
              return connection;
            },
            async beginTransaction() {},
            async commitTransaction() {},
            async rollbackTransaction() {},
            async releaseConnection() {},
            async destroy() {},
          }),
          createIntrospector: (kdb) => new PostgresIntrospector(kdb),
          createQueryCompiler: () => new PostgresQueryCompiler(),
        },
      });
      return { withTenantTx: async (_ctx, fn) => fn(db as unknown as Tx) };
    };
    const healthApp = (txRunner: TxRunner) => {
      const app = express();
      app.use(express.json());
      app.use(fakeAuth(platformAdmin));
      const auditedDeps = createTestDeps({ txRunner, audit: recordingAudit });
      const auditedService = new PlatformAdminService(auditedDeps, store);
      app.use('/platform', createPlatformRouter(auditedDeps, auditedService));
      app.use(
        '/v1',
        createRouter(auditedDeps, auditedService),
      );
      app.use(errorHandler());
      return app;
    };

    it('TEST-ADM-HEALTH-01 a database that answers is UP, and pool utilisation is the real share of connection slots in use', async () => {
      const res = await request(healthApp(answeringRunner())).get('/platform/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.dependencies.database.status).toBe('UP');
      expect(res.body.dependencies.database.poolUtilization).toBe(25);
      expect(res.body.dependencies.redisQueue.status).toBe('SIMULATED'); // the accepted ADR-4D-02 pipeline is reported as what it is
    });

    it('TEST-ADM-HEALTH-02 a database that cannot be reached is DOWN and the report says so (it used to say UP with an invented latency)', async () => {
      const broken: TxRunner = {
        async withTenantTx() {
          throw new Error('connection refused');
        },
      };
      const res = await request(healthApp(broken)).get('/platform/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DOWN');
      expect(res.body.dependencies.database.status).toBe('DOWN');
      expect(res.body.dependencies.database.latencyMs).not.toBe(4.2);
    });

    it('TEST-ADM-HEALTH-03 a database that answers slowly is DEGRADED', async () => {
      const spy = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(900);
      try {
        const res = await request(healthApp(answeringRunner())).get('/platform/v1/health');
        expect(res.body.dependencies.database.status).toBe('DEGRADED');
        expect(res.body.status).toBe('DEGRADED');
        expect(res.body.dependencies.database.latencyMs).toBeGreaterThanOrEqual(500);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ==========================================
  // SUB-ADM.06: Support Access (API-ADM-006 / API-ADM-007)
  // ==========================================
  describe('SUB-ADM.06 — Break-Glass Support Access & SOD-06', () => {
    it('enforces the 4-hour limit; only the target tenant administrator can decide; the operator cannot approve', async () => {
      const app = createTestApp(platformAdmin);

      // 1. Duration > 4.0 hours rejected
      const invalidDuration = await request(app).post('/platform/v1/support-access-requests').send({
        tenantId: 'ten_demo_01',
        reason: 'Diagnose critical bug',
        incidentRef: 'INC-9999',
        durationHours: 6.0,
      });
      expect(invalidDuration.status).toBe(422);

      // 2. Valid request created by a platform operator
      const validReq = await request(app).post('/platform/v1/support-access-requests').send({
        tenantId: 'ten_demo_01',
        reason: 'Investigate duplicate lead sync exception in Mumbai branch',
        incidentRef: 'INC-2026-4401',
        durationHours: 2.5,
      });
      expect(validReq.status).toBe(201);
      expect(validReq.body.status).toBe('PENDING');
      const grantId = validReq.body.id;

      // 3. The operator cannot approve their own request: approval belongs to the tenant realm
      const selfApproval = await request(app)
        .post(`/v1/support-access-requests/${grantId}/approval`)
        .send({ decision: 'APPROVED' });
      expect(selfApproval.status).toBe(403);

      // 4. An administrator of a different tenant cannot see or decide it
      const otherApp = createTestApp(otherTenantAdmin);
      const otherList = await request(otherApp).get('/v1/support-access-requests');
      expect(otherList.status).toBe(200);
      expect(otherList.body.data).toEqual([]);
      const otherApproval = await request(otherApp)
        .post(`/v1/support-access-requests/${grantId}/approval`)
        .send({ decision: 'APPROVED' });
      expect(otherApproval.status).toBe(404);

      // 5. The target tenant's administrator sees it and approves
      const tenantAdminApp = createTestApp(tenantAdmin);
      const mine = await request(tenantAdminApp).get('/v1/support-access-requests');
      expect(mine.body.data.map((g: { id: string }) => g.id)).toContain(grantId);
      const approvedRes = await request(tenantAdminApp)
        .post(`/v1/support-access-requests/${grantId}/approval`)
        .send({ decision: 'APPROVED', comments: 'Access approved for 2.5 hours' });
      expect(approvedRes.status).toBe(200);
      expect(approvedRes.body.status).toBe('APPROVED');
      expect(approvedRes.body.approver).toBe(tenantAdmin.id);
    });

    it('TEST-REALM-008 the target tenant can revoke an approved access; others cannot, and a pending one cannot be revoked', async () => {
      const operator = createTestApp(platformAdmin);
      const made = await request(operator).post('/platform/v1/support-access-requests').send({
        tenantId: 'ten_demo_01',
        reason: 'Investigate stuck queue after the outage',
        incidentRef: 'INC-2026-7777',
        durationHours: 1,
      });
      const id = made.body.id;
      const admin = createTestApp(tenantAdmin);

      expect(
        (await request(admin).post(`/v1/support-access-requests/${id}/revocation`).send({})).status,
      ).toBe(409); // still pending
      await request(admin).post(`/v1/support-access-requests/${id}/approval`).send({ decision: 'APPROVED' });

      expect(
        (await request(operator).post(`/v1/support-access-requests/${id}/revocation`).send({})).status,
      ).toBe(403);
      expect(
        (
          await request(createTestApp(otherTenantAdmin))
            .post(`/v1/support-access-requests/${id}/revocation`)
            .send({})
        ).status,
      ).toBe(404);
      const revoked = await request(admin).post(`/v1/support-access-requests/${id}/revocation`).send({});
      expect(revoked.status).toBe(200);
      expect(revoked.body.status).toBe('REVOKED');
      expect(
        (await request(admin).post(`/v1/support-access-requests/${id}/revocation`).send({})).status,
      ).toBe(409);
    });

    it('TEST-REALM-004 a tenant administrator cannot list another tenant by passing tenantId', async () => {
      const res = await request(createTestApp(tenantAdmin)).get(
        '/v1/support-access-requests?tenantId=ten_other_01',
      );
      expect(res.status).toBe(403);
    });
  });

  // ==========================================
  // SUB-ADM.07: Data Correction (API-ADM-008 / API-ADM-009)
  // ==========================================
  describe('SUB-ADM.07 — Governed Data Correction & SOD-08', () => {
    const body = {
      justification: 'Remediate malformed pincode metadata in legacy imported customers',
      scriptRef: 'SCR-2026-CORR-01',
      targetEntity: 'CUSTOMER',
      changeDescription: 'Set pincode to 400008 for orphaned branch records',
    };

    it('enforces dry-run diff preview and SOD-08 separation of duties inside one tenant', async () => {
      const requesterApp = createTestApp(tenantRequester);

      const createRes = await request(requesterApp)
        .post('/v1/data-corrections')
        .send({ ...body, tenantId: 'ten_demo_01' });
      expect(createRes.status).toBe(201);
      expect(createRes.body.status).toBe('PENDING');
      expect(createRes.body.tenantId).toBe('ten_demo_01');
      // No dry-run diff is invented: it stays null until the executor attaches a real one.
      expect(createRes.body.dryRunDiffKey).toBeNull();
      expect(createRes.body.dryRunDiff).toBeNull();
      const corrId = createRes.body.id;

      // The requester cannot approve (no approve permission at all)
      expect(
        (
          await request(requesterApp)
            .post(`/v1/data-corrections/${corrId}/approval`)
            .send({ decision: 'APPROVED' })
        ).status,
      ).toBe(403);

      // SOD-08: an administrator who also requested cannot approve their own correction
      const adminApp = createTestApp(tenantAdmin);
      const own = await request(adminApp).post('/v1/data-corrections').send(body);
      const selfApproval = await request(adminApp)
        .post(`/v1/data-corrections/${own.body.id}/approval`)
        .send({ decision: 'APPROVED' });
      expect(selfApproval.status).toBe(403);
      expect(selfApproval.body.error.code).toBe('SOD_VIOLATION');

      // A different administrator of the same tenant approves, then it executes
      const approveRes = await request(adminApp)
        .post(`/v1/data-corrections/${corrId}/approval`)
        .send({ decision: 'APPROVED' });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');
      // A person cannot mark it executed; only the executor service identity of that tenant can.
      expect((await request(adminApp).post(`/v1/data-corrections/${corrId}/execute`)).status).toBe(403);
      const execRes = await request(createTestApp(executorFor('ten_demo_01'))).post(
        `/v1/data-corrections/${corrId}/execute`,
      );
      expect(execRes.status).toBe(200);
      expect(execRes.body.status).toBe('EXECUTED');
      // and not twice
      expect(
        (
          await request(createTestApp(executorFor('ten_demo_01'))).post(
            `/v1/data-corrections/${corrId}/execute`,
          )
        ).status,
      ).toBe(409);
    });

    it('TEST-REALM-005 the tenant comes from the signed-in user: another tenant is refused and cannot see or act on the record', async () => {
      const mine = await request(createTestApp(tenantRequester)).post('/v1/data-corrections').send(body);
      expect(mine.status).toBe(201);

      // Asking for a correction in someone else's tenant is refused
      const forOther = await request(createTestApp(tenantRequester))
        .post('/v1/data-corrections')
        .send({ ...body, tenantId: 'ten_other_01' });
      expect(forOther.status).toBe(422);

      // Another tenant's administrator sees nothing and cannot approve or execute it (404, not 403)
      const otherApp = createTestApp(otherTenantAdmin);
      const list = await request(otherApp).get('/v1/data-corrections');
      expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(mine.body.id);
      expect(
        (
          await request(otherApp)
            .post(`/v1/data-corrections/${mine.body.id}/approval`)
            .send({ decision: 'APPROVED' })
        ).status,
      ).toBe(404);
      expect((await request(otherApp).post(`/v1/data-corrections/${mine.body.id}/execute`)).status).toBe(403);
      // another tenant's executor cannot see it either
      expect(
        (
          await request(createTestApp(executorFor('ten_other_01'))).post(
            `/v1/data-corrections/${mine.body.id}/execute`,
          )
        ).status,
      ).toBe(404);
    });

    it('TEST-REALM-006 a platform operator cannot request, approve or list data corrections', async () => {
      const app = createTestApp(platformAdmin);
      expect((await request(app).get('/v1/data-corrections')).status).toBe(403);
      expect((await request(app).post('/v1/data-corrections').send(body)).status).toBe(403);
    });

    it('TEST-REALM-007 requests and approvals are audited by the store, in the same transaction as the change', async () => {
      store.audit.length = 0;
      const created = await request(createTestApp(tenantRequester)).post('/v1/data-corrections').send(body);
      await request(createTestApp(tenantAdmin))
        .post(`/v1/data-corrections/${created.body.id}/approval`)
        .send({ decision: 'APPROVED' });
      expect(store.audit).toEqual(['data_correction.requested', 'data_correction.approved']);
    });
  });

  // ==========================================
  // SUB-ADM.08: Release Management (Release Register)
  // ==========================================
  describe('SUB-ADM.08 — Release Management Register', () => {
    const freshOperator = { ...platformAdmin, authTime: new Date().toISOString() }; // passed an authenticator check just now

    it('returns the release register with the candidate, and no gate is shown as passed until an operator records it', async () => {
      const res = await request(createTestApp(platformAdmin)).get('/platform/v1/releases');
      expect(res.status).toBe(200);
      expect(res.body.candidate).toBe('v0.1.0-rc.1');
      expect(res.body.releases.length).toBeGreaterThan(0);
      expect(res.body.releases[0].gates).toEqual({
        rel001: false,
        rel002: false,
        rel003: false,
        rel004: false,
      });
    });

    it('TEST-ADM-REL-01 an operator records a gate as passed (step-up, ETag), and the register shows it afterwards', async () => {
      const app = createTestApp(freshOperator);
      const put = await request(app)
        .put('/platform/v1/releases/v0.1.0-rc.1')
        .send({ gates: { rel001: true } });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.gates).toEqual({ rel001: true, rel002: false, rel003: false, rel004: false });
      expect(put.headers.etag).toBe(`"${put.body.lockVersion}"`);
      const after = await request(app).get('/platform/v1/releases');
      expect(after.body.releases[0].gates.rel001).toBe(true);
      expect(store.audit).toContain('release.updated');
    });

    it('TEST-ADM-REL-02 without a recent authenticator check the change is refused and nothing changes', async () => {
      const before = (await request(createTestApp(freshOperator)).get('/platform/v1/releases')).body
        .releases[0];
      const res = await request(createTestApp(platformAdmin))
        .put('/platform/v1/releases/v0.1.0-rc.1')
        .send({ status: 'PUBLISHED' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
      const after = (await request(createTestApp(freshOperator)).get('/platform/v1/releases')).body
        .releases[0];
      expect(after.status).toBe(before.status);
    });

    it('TEST-ADM-REL-03 a stale If-Match, an unknown version, an empty change and a tenant administrator are each refused', async () => {
      const app = createTestApp(freshOperator);
      const stale = await request(app)
        .put('/platform/v1/releases/v0.1.0-rc.1')
        .set('If-Match', '"999"')
        .send({ gitTag: 'v0.1.0-rc.1' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      expect(
        (await request(app).put('/platform/v1/releases/v9.9.9').send({ status: 'ARCHIVED' })).status,
      ).toBe(404);
      expect((await request(app).put('/platform/v1/releases/v0.1.0-rc.1').send({})).status).toBe(422);
      const tenant = await request(createTestApp({ ...tenantAdmin, authTime: new Date().toISOString() }))
        .put('/platform/v1/releases/v0.1.0-rc.1')
        .send({ status: 'PUBLISHED' });
      expect(tenant.status).toBe(403);
    });
  });
});
