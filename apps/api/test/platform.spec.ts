// Route tests for module platform that need no database: permission, If-Match, Idempotency-Key and body
// validation all fail before the transaction starts. Behaviour against PostgreSQL is in platform.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;

describe('platform writes (TASK-104 / TASK-412)', () => {
  it('TEST-ORG-001 403 without config.manage / user.manage', async () => {
    const app = as('lead.read');
    const calls = [
      request(app)
        .post('/v1/branches')
        .set('Idempotency-Key', 'key-12345678')
        .send({ code: 'X1', name: 'X' }),
      request(app).patch('/v1/organisations/org_1').set('If-Match', '"0"').send({ legalName: 'X' }),
      request(app).post('/v1/teams').set('Idempotency-Key', 'key-12345678').send({ name: 'T' }),
      request(app).put('/v1/work-queues/wq_1/members').set('If-Match', '"0"').send({ members: [] }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-ORG-002 POST without Idempotency-Key is 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('config.manage')).post('/v1/branches').send({ code: 'X1', name: 'X' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-ORG-003 PATCH without If-Match is 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('config.manage')).patch('/v1/branches/br_1').send({ name: 'X' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-ORG-004 invalid bodies are 422 VALIDATION_ERROR', async () => {
    const app = as('config.manage', 'user.manage');
    const bad = [
      request(app)
        .post('/v1/branches')
        .set('Idempotency-Key', 'key-12345678')
        .send({ code: 'lower', name: 'X' }),
      request(app)
        .post('/v1/branches')
        .set('Idempotency-Key', 'key-12345678')
        .send({ code: 'X1', name: 'ABCDE1234F' }),
      request(app)
        .post('/v1/work-queues')
        .set('Idempotency-Key', 'key-12345678')
        .send({ code: 'Q1', name: 'Q', kind: 'INTAKE', recordTypes: ['LEAD'] }),
      request(app).patch('/v1/teams/team_1').set('If-Match', '"1"').send({}),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-ORG-005 permissions per the MOD-ORG spec', async () => {
    // Organisation profile is config.manage only, even for reads (API-ORG-001).
    const orgs = await request(as('user.manage')).get('/v1/organisations');
    expect(orgs.status).toBe(403);
    // Queue membership is user.manage (API-ORG-014): config.manage alone is not enough.
    const members = await request(as('config.manage'))
      .put('/v1/work-queues/wq_1/members')
      .set('If-Match', '"0"')
      .send({ members: [] });
    expect(members.status).toBe(403);
  });
});
