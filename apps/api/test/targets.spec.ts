// apps/api/test/targets.spec.ts — owner: Dev 5 (MOD-PERF SUB-PERF.01 Targets Unit Tests)
import type { AuditPort, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTargetRepository } from '../src/modules/crm/targets/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

const inMemoryAudit: AuditPort = {
  record: async () => 'aud_01JTESTAUDIT00000000000000',
};

describe('Module 20 — Performance Targets (MOD-PERF SUB-PERF.01)', () => {
  let repository: InMemoryTargetRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';
  const branch1 = 'br_01JTESTBRANCH00000000000001';
  const branch2 = 'br_01JTESTBRANCH00000000000002';
  const productId = 'prd_01JTESTPRODUCT000000000001';

  // Target Creator (Supervisor with target.manage at tenant level)
  const creatorAdmin = testPrincipal({
    tenantId: tenantA,
    id: 'usr_creator_01',
    primaryBranchId: branch1,
    grants: [
      { code: 'target.manage', scope: 'TENANT', branchIds: [] },
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Approver (Separate Manager with target.manage at tenant level)
  const approverManager = testPrincipal({
    tenantId: tenantA,
    id: 'usr_approver_02',
    primaryBranchId: branch1,
    grants: [
      { code: 'target.manage', scope: 'TENANT', branchIds: [] },
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  // Branch-scoped user (Branch 1 only)
  const branchUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_branch_03',
    primaryBranchId: branch1,
    grants: [
      { code: 'target.manage', scope: 'BRANCH', branchIds: [branch1] },
      { code: 'report.read', scope: 'BRANCH', branchIds: [branch1] },
    ],
  });

  // User without target.manage (Read-only Agent)
  const readOnlyAgent = testPrincipal({
    tenantId: tenantA,
    id: 'usr_agent_04',
    primaryBranchId: branch1,
    grants: [{ code: 'report.read', scope: 'TENANT', branchIds: [] }],
  });

  // Other tenant user
  const otherTenantUser = testPrincipal({
    tenantId: tenantB,
    id: 'usr_other_tenant',
    grants: [
      { code: 'target.manage', scope: 'TENANT', branchIds: [] },
      { code: 'report.read', scope: 'TENANT', branchIds: [] },
    ],
  });

  function getApp(principal = creatorAdmin) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        targetRepository: repository,
        audit: inMemoryAudit,
      },
    });
  }

  beforeEach(() => {
    repository = new InMemoryTargetRepository();

    // Seed test branches
    repository.branches.add(`${tenantA}:${branch1}`);
    repository.branches.add(`${tenantA}:${branch2}`);

    // Seed test users
    repository.users.set(`${tenantA}:${creatorAdmin.id}`, branch1);
    repository.users.set(`${tenantA}:${approverManager.id}`, branch1);
    repository.users.set(`${tenantA}:${branchUser.id}`, branch1);
    repository.users.set(`${tenantA}:${readOnlyAgent.id}`, branch1);

    // Seed test product
    repository.products.add(`${tenantA}:${productId}`);
  });

  describe('API-PERF-001: Target Creation', () => {
    it('creates a target in PENDING_APPROVAL status with version 1', async () => {
      const app = getApp(creatorAdmin);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_create_001')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'DISBURSEMENT_AMOUNT',
          targetValue: 5000000,
          unit: 'INR',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^trg_/);
      expect(res.body.version).toBe(1);
      expect(res.body.status).toBe('PENDING_APPROVAL');
      expect(res.body.createdBy).toBe(creatorAdmin.id);
      expect(res.body.approvedBy).toBeNull();
      expect(res.body.actualValue).toBeNull();
      expect(res.body.achievementPercentage).toBeNull();
    });

    it('rejects creation if caller lacks target.manage permission', async () => {
      const app = getApp(readOnlyAgent);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_create_unauth')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'DISBURSEMENT_AMOUNT',
          targetValue: 100000,
          unit: 'INR',
        });

      expect(res.status).toBe(403);
    });

    it('rejects invalid period format', async () => {
      const app = getApp(creatorAdmin);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_bad_period')
        .send({
          period: '2026-13',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'DISBURSEMENT_AMOUNT',
          targetValue: 100000,
          unit: 'INR',
        });

      expect(res.status).toBe(422);
    });

    it('accepts quarterly period format (YYYY-Q#)', async () => {
      const app = getApp(creatorAdmin);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_quarterly')
        .send({
          period: '2026-Q4',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 150,
          unit: 'COUNT',
        });

      expect(res.status).toBe(201);
      expect(res.body.period).toBe('2026-Q4');
      expect(res.body.unit).toBe('COUNT');
    });

    it('rejects unit mismatch with metric code', async () => {
      const app = getApp(creatorAdmin);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_bad_unit')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'DISBURSEMENT_AMOUNT',
          targetValue: 100000,
          unit: 'COUNT', // Should be INR
        });

      expect(res.status).toBe(422);
    });

    it('enforces branch scoping for branch-scoped managers', async () => {
      const app = getApp(branchUser); // only branch1

      // Attempting to create target for branch2 should fail with 403
      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_branch_scope')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch2,
          metricCode: 'SANCTION_COUNT',
          targetValue: 25,
          unit: 'COUNT',
        });

      expect(res.status).toBe(403);
    });

    it('rejects non-existent dimension ID with 404 NOT_FOUND', async () => {
      const app = getApp(creatorAdmin);

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_missing_branch')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: 'br_doesnotexist',
          metricCode: 'LEAD_COUNT',
          targetValue: 50,
          unit: 'COUNT',
        });

      expect(res.status).toBe(404);
    });

    it('rejects second pending target for same slice with 409 INVALID_STATE', async () => {
      const app = getApp(creatorAdmin);

      await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_slice_first')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 50,
          unit: 'COUNT',
        });

      const res = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_slice_second')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 60,
          unit: 'COUNT',
        });

      expect(res.status).toBe(409);
    });

    it('replays identical response for replayed Idempotency-Key', async () => {
      const app = getApp(creatorAdmin);
      const payload = {
        period: '2026-10',
        dimensionType: 'BRANCH',
        dimensionId: branch1,
        metricCode: 'LEAD_COUNT',
        targetValue: 75,
        unit: 'COUNT',
      };

      const first = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_replay_test')
        .send(payload);

      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_target_replay_test')
        .send(payload);

      expect(second.status).toBe(201);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.id).toBe(first.body.id);
    });
  });

  describe('API-PERF-003: Approval Lifecycle and Dual Control (SOD-04)', () => {
    let targetId: string;
    let lockVersion: number;

    beforeEach(async () => {
      const app = getApp(creatorAdmin);

      const createRes = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_prep_target')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'DISBURSEMENT_AMOUNT',
          targetValue: 10000000,
          unit: 'INR',
        });

      targetId = createRes.body.id;
      lockVersion = createRes.body.lockVersion;
    });

    it('enforces SOD-04 dual control: creator cannot approve their own target', async () => {
      const app = getApp(creatorAdmin); // Same creator

      const res = await request(app)
        .post(`/v1/targets/${targetId}/approval`)
        .set('If-Match', `"${lockVersion}"`)
        .send({
          decision: 'APPROVE',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SOD_VIOLATION');
    });

    it('allows a separate authorized manager to approve target', async () => {
      const app = getApp(approverManager); // Separate manager

      const res = await request(app)
        .post(`/v1/targets/${targetId}/approval`)
        .set('If-Match', `"${lockVersion}"`)
        .send({
          decision: 'APPROVE',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approvedBy).toBe(approverManager.id);
      expect(res.body.approvedAt).toBeDefined();
    });

    it('allows a separate authorized manager to reject target with reason', async () => {
      const app = getApp(approverManager);

      const res = await request(app)
        .post(`/v1/targets/${targetId}/approval`)
        .set('If-Match', `"${lockVersion}"`)
        .send({
          decision: 'REJECT',
          rejectionReason: 'Disbursement target is unrealistically high for Q4',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejectionReason).toBe(
        'Disbursement target is unrealistically high for Q4',
      );
    });

    it('rejects approval when If-Match version mismatches (optimistic concurrency)', async () => {
      const app = getApp(approverManager);

      const res = await request(app)
        .post(`/v1/targets/${targetId}/approval`)
        .set('If-Match', '"999"') // Mismatched version
        .send({
          decision: 'APPROVE',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('Target Revision and Superseding Lifecycle', () => {
    it('creates version 2 when revising an approved target and supersedes version 1 on approval', async () => {
      // 1. Creator creates target v1
      const creatorApp = getApp(creatorAdmin);

      const res1 = await request(creatorApp)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_rev_v1')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 100,
          unit: 'COUNT',
        });

      expect(res1.status).toBe(201);
      const idV1 = res1.body.id;
      expect(res1.body.version).toBe(1);

      // 2. Approver approves target v1
      const approverApp = getApp(approverManager);

      await request(approverApp)
        .post(`/v1/targets/${idV1}/approval`)
        .set('If-Match', `"${res1.body.lockVersion}"`)
        .send({ decision: 'APPROVE' });

      // 3. Creator creates revision (v2) for the same slice
      const res2 = await request(creatorApp)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_rev_v2')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 120, // Revised target
          unit: 'COUNT',
        });

      expect(res2.status).toBe(201);
      const idV2 = res2.body.id;
      expect(res2.body.version).toBe(2);
      expect(res2.body.status).toBe('PENDING_APPROVAL');

      // 4. Approver approves v2
      const approveRes2 = await request(approverApp)
        .post(`/v1/targets/${idV2}/approval`)
        .set('If-Match', `"${res2.body.lockVersion}"`)
        .send({ decision: 'APPROVE' });

      expect(approveRes2.status).toBe(200);
      expect(approveRes2.body.status).toBe('APPROVED');

      // 5. Verify v1 is now SUPERSEDED
      const v1Fetch = await request(creatorApp).get(`/v1/targets/${idV1}`);
      expect(v1Fetch.body.status).toBe('SUPERSEDED');

      // 6. Verify history lists both versions
      const historyRes = await request(creatorApp).get(`/v1/targets/${idV2}/history`);
      expect(historyRes.status).toBe(200);
      expect(historyRes.body.items).toHaveLength(2);
      expect(historyRes.body.items[0].version).toBe(2);
      expect(historyRes.body.items[0].status).toBe('APPROVED');
      expect(historyRes.body.items[1].version).toBe(1);
      expect(historyRes.body.items[1].status).toBe('SUPERSEDED');
    });
  });

  describe('API-PERF-002: Retrieval and Tenant Isolation', () => {
    it('isolates targets between tenants', async () => {
      // Create target in Tenant A
      const appA = getApp(creatorAdmin);

      const resA = await request(appA)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_tenant_iso_01')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'SANCTION_COUNT',
          targetValue: 40,
          unit: 'COUNT',
        });

      const targetId = resA.body.id;

      // User from Tenant B attempts to retrieve Tenant A target
      const appB = getApp(otherTenantUser);

      const resB = await request(appB).get(`/v1/targets/${targetId}`);
      expect(resB.status).toBe(404);

      // User from Tenant B lists targets -> does not see Tenant A target
      const listB = await request(appB).get('/v1/targets?period=2026-10');
      expect(listB.status).toBe(200);
      expect(listB.body.items.some((t: any) => t.id === targetId)).toBe(false);

      // User from Tenant B attempts to approve Tenant A target -> 404
      const approveB = await request(appB)
        .post(`/v1/targets/${targetId}/approval`)
        .set('If-Match', '"1"')
        .send({ decision: 'APPROVE', comment: 'Cross-tenant approval attempt' });
      expect(approveB.status).toBe(404);

      // User from Tenant B attempts to view history of Tenant A target -> 404
      const histB = await request(appB).get(`/v1/targets/${targetId}/history`);
      expect(histB.status).toBe(404);
    });

    it('returns actualValue as null in MVP since MOD-RPT is unbuilt', async () => {
      const app = getApp(creatorAdmin);

      const createRes = await request(app)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_actuals_check')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 80,
          unit: 'COUNT',
        });

      const targetId = createRes.body.id;
      const getRes = await request(app).get(`/v1/targets/${targetId}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.actualValue).toBeNull();
      expect(getRes.body.achievementPercentage).toBeNull();
    });

    it('filters targets by branch scope for branch managers', async () => {
      const adminApp = getApp(creatorAdmin);

      // Create target for Branch 1
      await request(adminApp)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_list_b1')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch1,
          metricCode: 'LEAD_COUNT',
          targetValue: 10,
          unit: 'COUNT',
        });

      // Create target for Branch 2
      await request(adminApp)
        .post('/v1/targets')
        .set('Idempotency-Key', 'idem_list_b2')
        .send({
          period: '2026-10',
          dimensionType: 'BRANCH',
          dimensionId: branch2,
          metricCode: 'LEAD_COUNT',
          targetValue: 20,
          unit: 'COUNT',
        });

      // Branch User (authorized for branch1 only) queries list
      const branchApp = getApp(branchUser);
      const listRes = await request(branchApp).get('/v1/targets');

      expect(listRes.status).toBe(200);
      // Must only contain Branch 1 target
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].dimensionId).toBe(branch1);
    });
  });
});
