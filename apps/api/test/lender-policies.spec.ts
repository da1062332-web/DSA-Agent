// P1-04 lender policy routes, unit level (owner: Dipanshu). Permission, step-up, header and body checks all run before any database
// call (the test app has no database). Database behaviour, maker-checker and the one-active rule are in lender-policies.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (codes: PermissionCode[], authTime?: string) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        authTime,
        grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;
const POLICY = 'lpo_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const draft = {
  lenderId: 'lnd_01JD8Y3Z4K5M6N7P8Q9R0S1T2V',
  productVersionId: 'prv_01JD8Y3Z4K5M6N7P8Q9R0S1T2V',
  rateMinBps: 1050,
  rateMaxBps: 1200,
  effectiveFrom: '2026-12-01T00:00:00Z',
};

beforeEach(() => {
  // Step-up is enforced (the project has a second factor), whatever the developer's .env says.
  vi.stubEnv('SUPABASE_MFA_ENABLED', 'true');
  vi.stubEnv('DISABLE_MFA', 'false');
});
afterEach(() => vi.unstubAllEnvs());

describe('P1-04 lender policies: permissions', () => {
  it('TEST-LPO-001 reading needs lender_policy.read; lender.read is not enough', async () => {
    for (const path of ['/v1/lender-policies', `/v1/lender-policies/${POLICY}`]) {
      const res = await request(as(['lender.read', 'config.manage'])).get(path);
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-LPO-002 creating and editing need lender_policy.manage; config.manage is not enough', async () => {
    const create = await request(as(['config.manage', 'lender_policy.read']))
      .post('/v1/lender-policies')
      .set('Idempotency-Key', 'lpo-unit-000001')
      .send(draft);
    expect(create.status).toBe(403);
    const patch = await request(as(['config.manage']))
      .patch(`/v1/lender-policies/${POLICY}`)
      .set('If-Match', '"0"')
      .send({ foirCapBps: 5000 });
    expect(patch.status).toBe(403);
  });

  it('TEST-LPO-003 ACTIVATE needs rule.approve: lender_policy.manage alone is refused', async () => {
    const res = await request(as(['lender_policy.manage'], new Date().toISOString()))
      .post(`/v1/lender-policies/${POLICY}/transitions`)
      .set('If-Match', '"0"')
      .send({ action: 'ACTIVATE' });
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('TEST-LPO-004 ACTIVATE needs a recent step-up: none, or older than 900 s, is 401 STEP_UP_REQUIRED', async () => {
    const stale = new Date(Date.now() - 901_000).toISOString();
    for (const authTime of [undefined, stale]) {
      const res = await request(as(['rule.approve'], authTime))
        .post(`/v1/lender-policies/${POLICY}/transitions`)
        .set('If-Match', '"0"')
        .send({ action: 'ACTIVATE' });
      expect(res.status).toBe(401);
      expect(code(res)).toBe('STEP_UP_REQUIRED');
    }
  });

  it('TEST-LPO-005 RETIRE needs lender_policy.manage, not rule.approve', async () => {
    const res = await request(as(['rule.approve'], new Date().toISOString()))
      .post(`/v1/lender-policies/${POLICY}/transitions`)
      .set('If-Match', '"0"')
      .send({ action: 'RETIRE' });
    expect(res.status).toBe(403);
  });
});

describe('P1-04 lender policies: headers and validation (before any database call)', () => {
  const manager = () => as(['lender_policy.manage']);

  it('TEST-LPO-006 create needs an Idempotency-Key; edit and transitions need If-Match', async () => {
    const create = await request(manager()).post('/v1/lender-policies').send(draft);
    expect(create.status).toBe(400);
    const patch = await request(manager()).patch(`/v1/lender-policies/${POLICY}`).send({ foirCapBps: 5000 });
    expect(patch.status).toBe(400);
    expect(code(patch)).toBe('MALFORMED_REQUEST');
    const retire = await request(manager())
      .post(`/v1/lender-policies/${POLICY}/transitions`)
      .send({ action: 'RETIRE' });
    expect(retire.status).toBe(400);
  });

  it('TEST-LPO-007 bad terms, unknown fields and a tenant id in the body are 422', async () => {
    const bad = [
      { ...draft, rateMinBps: 1300 },
      { ...draft, serviceablePincodes: ['0411'] },
      { ...draft, allowedEmployment: ['RETIRED'] },
      { ...draft, minIncome: { amount: '1.00', currency: 'USD' } },
      { ...draft, tenantId: 'ten_x' },
      { ...draft, status: 'ACTIVE' },
    ];
    for (const body of bad) {
      const res = await request(manager())
        .post('/v1/lender-policies')
        .set('Idempotency-Key', 'lpo-unit-000002')
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-LPO-008 a patch cannot move the policy or change its status; transitions are ACTIVATE or RETIRE only', async () => {
    for (const body of [{}, { lenderId: draft.lenderId }, { status: 'ACTIVE' }]) {
      const res = await request(manager())
        .patch(`/v1/lender-policies/${POLICY}`)
        .set('If-Match', '"0"')
        .send(body);
      expect(res.status).toBe(422);
    }
    const res = await request(manager())
      .post(`/v1/lender-policies/${POLICY}/transitions`)
      .set('If-Match', '"0"')
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(422);
  });

  it('TEST-LPO-009 the list allow-lists its filters', async () => {
    const res = await request(as(['lender_policy.read'])).get('/v1/lender-policies?sort=name');
    expect(res.status).toBe(422);
  });
});
