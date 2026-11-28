// apps/api/test/workforce.spec.ts — Module 26: Workforce (MOD-WRK) attendance tests. Capacity and delegation tests were removed with task P0-02.
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryWorkforceRepository } from '../src/modules/crm/workforce/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module 26 — Workforce (MOD-WRK)', () => {
  let repository: InMemoryWorkforceRepository;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';

  const userAgentA1 = testPrincipal({
    id: 'usr_agent_01',
    tenantId: tenantA,
    primaryBranchId: 'br_mumbai',
    grants: [],
  });

  const userAgentA2 = testPrincipal({
    id: 'usr_agent_02',
    tenantId: tenantA,
    primaryBranchId: 'br_mumbai',
    grants: [],
  });

  const userManagerA = testPrincipal({
    id: 'usr_manager_01',
    tenantId: tenantA,
    primaryBranchId: 'br_mumbai',
    grants: [
      { code: 'user.manage', scope: 'TENANT', branchIds: [] },
      { code: 'attendance.manage', scope: 'TENANT', branchIds: [] },
    ],
  });

  const userTenantB = testPrincipal({
    id: 'usr_agent_b1',
    tenantId: tenantB,
    primaryBranchId: 'br_delhi',
    grants: [
      { code: 'user.manage', scope: 'TENANT', branchIds: [] },
      { code: 'attendance.manage', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryWorkforceRepository();
  });

  function getApp(principal = userAgentA1) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        workforceRepository: repository,
      },
    });
  }

  describe('SUB-WRK.03: Attendance Tracking', () => {
    it('records check-in via POST /v1/attendance/check-in', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app)
        .post('/v1/attendance/check-in')
        .send({ notes: 'Logged in from Mumbai branch' });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(userAgentA1.id);
      expect(res.body.checkIn).toBeDefined();
      expect(res.body.status).toBe('PRESENT');
      expect(res.body.notes).toBe('Logged in from Mumbai branch');

      // Idempotent check-in returns existing
      const resSecond = await request(app).post('/v1/attendance/check-in');
      expect(resSecond.status).toBe(201);
      expect(resSecond.body.id).toBe(res.body.id);
    });

    it('records check-out via POST /v1/attendance/check-out', async () => {
      const app = getApp(userAgentA1);

      // Check in first
      await request(app).post('/v1/attendance/check-in');

      // Check out
      const resOut = await request(app).post('/v1/attendance/check-out').send({ notes: 'Day complete' });

      expect(resOut.status).toBe(200);
      expect(resOut.body.checkOut).toBeDefined();
      expect(resOut.body.notes).toBe('Day complete');
    });

    it('rejects check-out if user has not checked in today', async () => {
      const app = getApp(userAgentA2);

      const res = await request(app).post('/v1/attendance/check-out');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('retrieves current user today attendance via GET /v1/attendance/me/today', async () => {
      const app = getApp(userAgentA1);

      await request(app).post('/v1/attendance/check-in');

      const res = await request(app).get('/v1/attendance/me/today');
      expect(res.status).toBe(200);
      expect(res.body.attendance).not.toBeNull();
      expect(res.body.attendance.userId).toBe(userAgentA1.id);
    });

    it('attendance.manage role can list attendance of all agents', async () => {
      const appUser1 = getApp(userAgentA1);
      await request(appUser1).post('/v1/attendance/check-in');

      const appManager = getApp(userManagerA);
      const res = await request(appManager).get('/v1/attendance');
      expect(res.status).toBe(200);
      expect(res.body.records.length).toBeGreaterThanOrEqual(1);
    });

    it('non-manager listing attendance only gets own records', async () => {
      const appUser1 = getApp(userAgentA1);
      await request(appUser1).post('/v1/attendance/check-in');

      const appUser2 = getApp(userAgentA2);
      const res = await request(appUser2).get('/v1/attendance');
      expect(res.status).toBe(200);
      // User 2 has not checked in, should not see User 1's record
      expect(res.body.records.length).toBe(0);
    });
  });

  describe('Multi-Tenant Isolation', () => {
    it('strictly isolates workforce attendance between tenants', async () => {
      const appTenantA = getApp(userManagerA);
      const appTenantB = getApp(userTenantB);

      // Check-in in Tenant A
      await request(appTenantA).post('/v1/attendance/check-in');

      // Tenant B lists attendance -> should see 0
      const attB = await request(appTenantB).get('/v1/attendance');
      expect(attB.status).toBe(200);
      expect(attB.body.records.length).toBe(0);
    });
  });
});
