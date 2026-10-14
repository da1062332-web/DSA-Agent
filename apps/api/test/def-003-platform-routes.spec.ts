// apps/api/test/def-003-platform-routes.spec.ts
// Regression & Boundary Verification for DEF-003 (Platform Sub-Routers: Organisations, Teams, Work Queues)
// Validates route mounting, authorization controls, and request boundaries across all 13 affected endpoints.

import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        tenantId: 'ten_01JTESTTENANT00000000000000',
        grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });

const asOtherTenant = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        tenantId: 'ten_01JOTHERTENANT0000000000000',
        grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });

const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;

describe('DEF-003: Platform Sub-Routers Authorization & Boundary Verification', () => {
  describe('1. Unauthenticated Requests (401 UNAUTHENTICATED)', () => {
    const unauthedApp = createTestApp(); // No fakeAuth provided

    it('rejects unauthenticated requests to all organisation routes', async () => {
      const getOrgs = await request(unauthedApp).get('/v1/organisations');
      expect(getOrgs.status).toBe(401);
      expect(code(getOrgs)).toBe('UNAUTHENTICATED');

      const getOrg = await request(unauthedApp).get('/v1/organisations/org_1');
      expect(getOrg.status).toBe(401);
      expect(code(getOrg)).toBe('UNAUTHENTICATED');

      const patchOrg = await request(unauthedApp).patch('/v1/organisations/org_1').send({ legalName: 'New Org' });
      expect(patchOrg.status).toBe(401);
      expect(code(patchOrg)).toBe('UNAUTHENTICATED');
    });

    it('rejects unauthenticated requests to all team routes', async () => {
      const getTeams = await request(unauthedApp).get('/v1/teams');
      expect(getTeams.status).toBe(401);
      expect(code(getTeams)).toBe('UNAUTHENTICATED');

      const getTeam = await request(unauthedApp).get('/v1/teams/team_1');
      expect(getTeam.status).toBe(401);
      expect(code(getTeam)).toBe('UNAUTHENTICATED');

      const postTeam = await request(unauthedApp).post('/v1/teams').send({ name: 'Alpha' });
      expect(postTeam.status).toBe(401);
      expect(code(postTeam)).toBe('UNAUTHENTICATED');

      const patchTeam = await request(unauthedApp).patch('/v1/teams/team_1').send({ name: 'Alpha 2' });
      expect(patchTeam.status).toBe(401);
      expect(code(patchTeam)).toBe('UNAUTHENTICATED');

      const putMembers = await request(unauthedApp).put('/v1/teams/team_1/members').send({ userIds: [] });
      expect(putMembers.status).toBe(401);
      expect(code(putMembers)).toBe('UNAUTHENTICATED');
    });

    it('rejects unauthenticated requests to all work-queue routes', async () => {
      const getQueues = await request(unauthedApp).get('/v1/work-queues');
      expect(getQueues.status).toBe(401);
      expect(code(getQueues)).toBe('UNAUTHENTICATED');

      const getQueue = await request(unauthedApp).get('/v1/work-queues/wq_1');
      expect(getQueue.status).toBe(401);
      expect(code(getQueue)).toBe('UNAUTHENTICATED');

      const postQueue = await request(unauthedApp).post('/v1/work-queues').send({ name: 'Intake Q' });
      expect(postQueue.status).toBe(401);
      expect(code(postQueue)).toBe('UNAUTHENTICATED');

      const patchQueue = await request(unauthedApp).patch('/v1/work-queues/wq_1').send({ name: 'Updated Q' });
      expect(patchQueue.status).toBe(401);
      expect(code(patchQueue)).toBe('UNAUTHENTICATED');

      const putMembers = await request(unauthedApp).put('/v1/work-queues/wq_1/members').send({ members: [] });
      expect(putMembers.status).toBe(401);
      expect(code(putMembers)).toBe('UNAUTHENTICATED');
    });
  });

  describe('2. Authorization & RBAC Permission Boundaries (403 FORBIDDEN)', () => {
    const unprivileged = as('lead.read');

    it('rejects organisation routes without config.manage', async () => {
      const getOrgs = await request(unprivileged).get('/v1/organisations');
      expect(getOrgs.status).toBe(403);
      expect(code(getOrgs)).toBe('FORBIDDEN');

      const getOrg = await request(unprivileged).get('/v1/organisations/org_1');
      expect(getOrg.status).toBe(403);
      expect(code(getOrg)).toBe('FORBIDDEN');

      const patchOrg = await request(unprivileged)
        .patch('/v1/organisations/org_1')
        .set('If-Match', '"0"')
        .send({ legalName: 'Forbidden Corp' });
      expect(patchOrg.status).toBe(403);
      expect(code(patchOrg)).toBe('FORBIDDEN');
    });

    it('rejects team mutations without config.manage / user.manage', async () => {
      const postTeam = await request(unprivileged)
        .post('/v1/teams')
        .set('Idempotency-Key', 'key-test-team-01')
        .send({ name: 'Forbidden Team' });
      expect(postTeam.status).toBe(403);
      expect(code(postTeam)).toBe('FORBIDDEN');

      const patchTeam = await request(unprivileged)
        .patch('/v1/teams/team_1')
        .set('If-Match', '"0"')
        .send({ name: 'Forbidden Team' });
      expect(patchTeam.status).toBe(403);
      expect(code(patchTeam)).toBe('FORBIDDEN');

      const putMembers = await request(unprivileged)
        .put('/v1/teams/team_1/members')
        .set('If-Match', '"0"')
        .send({ userIds: [] });
      expect(putMembers.status).toBe(403);
      expect(code(putMembers)).toBe('FORBIDDEN');
    });

    it('rejects work-queue mutations without config.manage / user.manage', async () => {
      const postQueue = await request(unprivileged)
        .post('/v1/work-queues')
        .set('Idempotency-Key', 'key-test-wq-01')
        .send({ code: 'Q_FORBIDDEN', name: 'Q', kind: 'INTAKE', recordTypes: ['LEAD'] });
      expect(postQueue.status).toBe(403);
      expect(code(postQueue)).toBe('FORBIDDEN');

      const patchQueue = await request(unprivileged)
        .patch('/v1/work-queues/wq_1')
        .set('If-Match', '"0"')
        .send({ name: 'Updated' });
      expect(patchQueue.status).toBe(403);
      expect(code(patchQueue)).toBe('FORBIDDEN');

      const putMembers = await request(unprivileged)
        .put('/v1/work-queues/wq_1/members')
        .set('If-Match', '"0"')
        .send({ members: [] });
      expect(putMembers.status).toBe(403);
      expect(code(putMembers)).toBe('FORBIDDEN');
    });
  });

  describe('3. Request Protocol Boundaries (If-Match & Idempotency-Key)', () => {
    it('requires Idempotency-Key on team creation (400 MALFORMED_REQUEST)', async () => {
      const app = as('config.manage');
      const res = await request(app).post('/v1/teams').send({ name: 'Valid Name' });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires Idempotency-Key on work queue creation (400 MALFORMED_REQUEST)', async () => {
      const app = as('config.manage');
      const res = await request(app).post('/v1/work-queues').send({
        code: 'Q1',
        name: 'Valid Queue',
        kind: 'INTAKE',
        recordTypes: ['LEAD'],
      });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires If-Match on organisation update (400 MALFORMED_REQUEST)', async () => {
      const app = as('config.manage');
      const res = await request(app).patch('/v1/organisations/org_1').send({ legalName: 'Acme Corp' });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires If-Match on team update (400 MALFORMED_REQUEST)', async () => {
      const app = as('config.manage');
      const res = await request(app).patch('/v1/teams/team_1').send({ name: 'Updated Team' });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires If-Match on team members update (400 MALFORMED_REQUEST)', async () => {
      const app = as('user.manage');
      const res = await request(app).put('/v1/teams/team_1/members').send({ userIds: [] });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires If-Match on work queue update (400 MALFORMED_REQUEST)', async () => {
      const app = as('config.manage');
      const res = await request(app).patch('/v1/work-queues/wq_1').send({ name: 'Updated Queue' });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });

    it('requires If-Match on work queue members update (400 MALFORMED_REQUEST)', async () => {
      const app = as('user.manage');
      const res = await request(app).put('/v1/work-queues/wq_1/members').send({ members: [] });
      expect(res.status).toBe(400);
      expect(code(res)).toBe('MALFORMED_REQUEST');
    });
  });

  describe('4. Input Validation Boundaries (422 VALIDATION_ERROR)', () => {
    it('rejects empty or invalid team update bodies (422 VALIDATION_ERROR)', async () => {
      const app = as('config.manage');
      const res = await request(app)
        .patch('/v1/teams/team_1')
        .set('If-Match', '"0"')
        .send({}); // empty body violates atLeastOne refine
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    });

    it('rejects empty or invalid organisation update bodies (422 VALIDATION_ERROR)', async () => {
      const app = as('config.manage');
      const res = await request(app)
        .patch('/v1/organisations/org_1')
        .set('If-Match', '"0"')
        .send({}); // empty body violates atLeastOne refine
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid work queue create payloads (422 VALIDATION_ERROR)', async () => {
      const app = as('config.manage');
      // INTAKE queues require branchId per Zod refine
      const res = await request(app)
        .post('/v1/work-queues')
        .set('Idempotency-Key', 'key-test-wq-invalid')
        .send({
          code: 'Q_BAD',
          name: 'Bad Queue',
          kind: 'INTAKE',
          recordTypes: [], // min(1) violated
        });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    });
  });
});
