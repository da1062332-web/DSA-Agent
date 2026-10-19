// apps/api/test/workforce.spec.ts — Module 26: Workforce (MOD-WRK) test suite
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

    // Seed test users
    repository.seedUser({
      id: userAgentA1.id,
      tenant_id: tenantA,
      email: 'aarav@example.com',
      display_name: 'Aarav Patel',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      capacity: 10,
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
    });

    repository.seedUser({
      id: userAgentA2.id,
      tenant_id: tenantA,
      email: 'priya@example.com',
      display_name: 'Priya Sharma',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      capacity: 15,
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
    });

    repository.seedUser({
      id: userManagerA.id,
      tenant_id: tenantA,
      email: 'vikram@example.com',
      display_name: 'Vikram Mehta',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      capacity: 5,
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
    });

    repository.seedUser({
      id: userTenantB.id,
      tenant_id: tenantB,
      email: 'rohan@example.com',
      display_name: 'Rohan Gupta',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      capacity: 12,
      primary_branch_id: 'br_delhi',
      lock_version: 0,
    });
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

  describe('SUB-WRK.01: Capacity and Availability', () => {
    it('allows signed-in user to toggle their own availability via PATCH /v1/me/availability', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app).patch('/v1/me/availability').set('If-Match', '"0"').send({ availability: 'BUSY' });

      expect(res.status).toBe(200);
      expect(res.body.availability).toBe('BUSY');
      expect(res.body.id).toBe(userAgentA1.id);
      expect(res.headers['etag']).toBe('"1"');

      // Verify in repository
      const updated = await repository.findUserById({} as any, tenantA, userAgentA1.id);
      expect(updated?.availability).toBe('BUSY');
      expect(updated?.lock_version).toBe(1);
    });

    it('allows signed-in user to toggle their own availability via PATCH /v1/me', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app).patch('/v1/me').set('If-Match', '"0"').send({ availability: 'ON_LEAVE' });

      expect(res.status).toBe(200);
      expect(res.body.availability).toBe('ON_LEAVE');
    });

    it('rejects invalid availability status with 422 validation error', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app).patch('/v1/me/availability').set('If-Match', '"0"').send({ availability: 'SLEEPING' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TEST-WRK-AUD-01 availability changes require If-Match (API-USR-009)', async () => {
      const res = await request(getApp(userAgentA1)).patch('/v1/me/availability').send({ availability: 'BUSY' });
      expect(res.status).toBe(422);
      expect(res.body.error.details[0].field).toBe('If-Match');
    });

    it('TEST-WRK-AUD-02 a PATCH /v1/me mixing preferences and availability is refused, not half-applied', async () => {
      const res = await request(getApp(userAgentA1))
        .patch('/v1/me')
        .set('If-Match', '"0"')
        .send({ availability: 'BUSY', notificationPreferences: { channels: { IN_APP: true } } });
      expect(res.status).toBe(422);
      const user = await repository.findUserById({} as any, tenantA, userAgentA1.id);
      expect(user?.lock_version).toBe(0);
    });

    it('honours optimistic concurrency via If-Match header', async () => {
      const app = getApp(userAgentA1);

      // Stale lock version mismatch
      const resMismatch = await request(app)
        .patch('/v1/me/availability')
        .set('If-Match', '"99"')
        .send({ availability: 'OFF_DUTY' });

      expect(resMismatch.status).toBe(409);

      // Correct lock version match
      const resMatch = await request(app)
        .patch('/v1/me/availability')
        .set('If-Match', '"0"')
        .send({ availability: 'OFF_DUTY' });

      expect(resMatch.status).toBe(200);
      expect(resMatch.body.availability).toBe('OFF_DUTY');
    });

    it('allows managers to read agent capacity list via GET /v1/workforce/agents', async () => {
      const app = getApp(userManagerA);

      const res = await request(app).get('/v1/workforce/agents');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.agents)).toBe(true);
      expect(res.body.agents.length).toBe(3); // Aarav, Priya, Vikram
      const aarav = res.body.agents.find((a: any) => a.id === userAgentA1.id);
      expect(aarav).toBeDefined();
      expect(aarav.capacity).toBe(10);
    });

    it('allows user.manage role to update an agent capacity limit', async () => {
      const app = getApp(userManagerA);

      const res = await request(app)
        .patch(`/v1/workforce/agents/${userAgentA1.id}/capacity`)
        .send({ capacity: 25 });

      expect(res.status).toBe(200);
      expect(res.body.capacity).toBe(25);

      const updated = await repository.findUserById({} as any, tenantA, userAgentA1.id);
      expect(updated?.capacity).toBe(25);
    });

    it('forbids normal user from updating another user capacity limit', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app)
        .patch(`/v1/workforce/agents/${userAgentA2.id}/capacity`)
        .send({ capacity: 30 });

      expect(res.status).toBe(403);
    });
  });

  describe('SUB-WRK.02: Leave Coverage & Delegations', () => {
    it('creates a delegation covering leave and returns 201', async () => {
      const app = getApp(userManagerA);

      const startsAt = '2026-11-01T00:00:00.000Z';
      const endsAt = '2026-11-07T23:59:59.000Z';

      const res = await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt,
        endsAt,
        reason: 'Annual Leave Coverage',
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^dlg_/);
      expect(res.body.delegatorId).toBe(userAgentA1.id);
      expect(res.body.delegateId).toBe(userAgentA2.id);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('prevents overlapping active delegations for the same delegator (ENT-038 EXCLUDE)', async () => {
      const app = getApp(userManagerA);

      // Create initial delegation
      await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-11-07T23:59:59.000Z',
        reason: 'Initial leave',
      });

      // Attempt overlapping delegation
      const resOverlap = await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-11-05T00:00:00.000Z',
        endsAt: '2026-11-10T23:59:59.000Z',
        reason: 'Overlapping request',
      });

      expect(resOverlap.status).toBe(409);
      expect(resOverlap.body.error.code).toBe('EFFECTIVE_OVERLAP');
    });

    it('allows self to delegate own work', async () => {
      const app = getApp(userAgentA1);

      const res = await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-12-01T00:00:00.000Z',
        endsAt: '2026-12-05T23:59:59.000Z',
        reason: 'Sick leave coverage',
      });

      expect(res.status).toBe(201);
      expect(res.body.delegatorId).toBe(userAgentA1.id);
    });

    it('allows delegator or manager to end delegation via POST /v1/delegations/:id/end', async () => {
      const app = getApp(userManagerA);

      const createRes = await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-12-10T00:00:00.000Z',
        endsAt: '2026-12-15T23:59:59.000Z',
      });

      const delegationId = createRes.body.id;

      const endRes = await request(app).post(`/v1/delegations/${delegationId}/end`);
      expect(endRes.status).toBe(200);
      expect(endRes.body.status).toBe('ENDED');

      // Now a new delegation in that range should succeed because old one is ENDED
      const newRes = await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-12-10T00:00:00.000Z',
        endsAt: '2026-12-15T23:59:59.000Z',
      });
      expect(newRes.status).toBe(201);
    });

    it('lists delegations via GET /v1/delegations', async () => {
      const app = getApp(userManagerA);

      await request(app).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-10-01T00:00:00.000Z',
        endsAt: '2026-10-05T23:59:59.000Z',
      });

      const listRes = await request(app).get('/v1/delegations');
      expect(listRes.status).toBe(200);
      expect(listRes.body.delegations.length).toBeGreaterThanOrEqual(1);
    });
  });

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
    it('strictly isolates workforce delegations and attendance between tenants', async () => {
      const appTenantA = getApp(userManagerA);
      const appTenantB = getApp(userTenantB);

      // Create delegation in Tenant A
      await request(appTenantA).post('/v1/delegations').send({
        delegatorId: userAgentA1.id,
        delegateId: userAgentA2.id,
        startsAt: '2026-11-15T00:00:00.000Z',
        endsAt: '2026-11-20T23:59:59.000Z',
      });

      // Check-in in Tenant A
      await request(appTenantA).post('/v1/attendance/check-in');

      // Tenant B lists delegations -> should see 0
      const dlgB = await request(appTenantB).get('/v1/delegations');
      expect(dlgB.status).toBe(200);
      expect(dlgB.body.delegations.length).toBe(0);

      // Tenant B lists attendance -> should see 0
      const attB = await request(appTenantB).get('/v1/attendance');
      expect(attB.status).toBe(200);
      expect(attB.body.records.length).toBe(0);
    });
  });
});
