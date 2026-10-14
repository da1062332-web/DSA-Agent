// MOD-LND Lenders, unit level (owner: Dev 3). Permissions and input validation run before any database call, so these
// tests need no database. Database behaviour is in catalogue.int.spec.ts.
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
const IDEM = { 'Idempotency-Key': 'lender-key-00001' };

describe('lenders: permissions (MOD-LND, config.manage)', () => {
  it('TEST-LND-001 writes are 403 without config.manage', async () => {
    const app = as('lead.read');
    const calls = [
      request(app).post('/v1/lenders').set(IDEM).send({ name: 'HDFC Bank', lenderType: 'BANK' }),
      request(app).patch('/v1/lenders/lnd_1').set('If-Match', '"0"').send({ name: 'X Bank' }),
      request(app)
        .post('/v1/lenders/lnd_1/empanelments')
        .set(IDEM)
        .send({ dsaCode: 'DSA001', validFrom: '2026-01-01', permittedCategories: ['PL'] }),
      request(app).patch('/v1/empanelments/emp_1').set('If-Match', '"0"').send({ status: 'SUSPENDED' }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-LND-002 writes without an Idempotency-Key are 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('config.manage'))
      .post('/v1/lenders')
      .send({ name: 'HDFC Bank', lenderType: 'BANK' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-LND-003 invalid bodies are 422 VALIDATION_ERROR', async () => {
    const app = as('config.manage');
    const bad = [
      request(app).post('/v1/lenders').set(IDEM).send({ name: 'HDFC Bank', lenderType: 'PRIVATE_EQUITY' }),
      request(app).post('/v1/lenders').set(IDEM).send({ name: 'PAN ABCDE1234F', lenderType: 'NBFC' }),
      request(app).post('/v1/lenders').set(IDEM).send({ name: 'Bank', lenderType: 'NBFC', extra: 1 }),
      request(app).patch('/v1/lenders/lnd_1').set('If-Match', '"1"').send({}),
      // Pausing or terminating a lender needs a reason.
      request(app).patch('/v1/lenders/lnd_1').set('If-Match', '"1"').send({ status: 'PAUSED' }),
      request(app)
        .post('/v1/lenders/lnd_1/empanelments')
        .set(IDEM)
        .send({ dsaCode: 'D1', validFrom: '2026-06-01', validTo: '2026-01-01', permittedCategories: ['PL'] }),
      request(app)
        .post('/v1/lenders/lnd_1/empanelments')
        .set(IDEM)
        .send({ dsaCode: 'DSA001', validFrom: '2026-01-01', permittedCategories: [] }),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-LND-004 PATCH without If-Match is 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('config.manage')).patch('/v1/lenders/lnd_1').send({ name: 'HDFC Bank' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });
});
