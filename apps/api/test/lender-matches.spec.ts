// P1-04 lender matching routes, unit level (owner: Dipanshu). Permission, header and body checks run before any database call (the
// test app has no database), and the EMI calculator is stateless. Database behaviour is in lender-matches.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;
const APP = 'app_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const emi = (body: Record<string, unknown>, codes: PermissionCode[] = ['lender_match.run']) =>
  request(as(codes)).post('/v1/emi-calculations').send(body);
const SPEC = { principal: { amount: '1000000.00', currency: 'INR' }, annualRateBps: 1200, tenureMonths: 60 };

describe('P1-04 lender matches: permissions and headers', () => {
  it('TEST-LMR-001 every match route needs lender_match.run; application.read and lender_policy.read are not enough', async () => {
    const app = as(['application.read', 'application.update', 'lender_policy.read']);
    for (const res of [
      await request(app).get(`/v1/applications/${APP}/lender-matches/inputs`),
      await request(app).get(`/v1/applications/${APP}/lender-matches/latest`),
      await request(app)
        .post(`/v1/applications/${APP}/lender-matches`)
        .set('Idempotency-Key', 'lmr-unit-01')
        .send({}),
    ]) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });

  it('TEST-LMR-002 a run needs an Idempotency-Key', async () => {
    const res = await request(as(['lender_match.run']))
      .post(`/v1/applications/${APP}/lender-matches`)
      .send({});
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-LMR-003 bad overrides, unknown fields and a tenant id in the body are 422', async () => {
    for (const body of [
      { pincode: '0411' },
      { bureauScore: 950 },
      { tenureMonths: 0 },
      { employmentType: 'RETIRED' },
      { monthlyIncome: { amount: '1.00', currency: 'USD' } },
      { tenantId: 'ten_x' },
      { panNumber: 'ABCDE1234F' },
    ]) {
      const res = await request(as(['lender_match.run']))
        .post(`/v1/applications/${APP}/lender-matches`)
        .set('Idempotency-Key', 'lmr-unit-02')
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-LMR-004 without the lender policy port a run fails closed with 503', async () => {
    const res = await request(as(['lender_match.run']))
      .post(`/v1/applications/${APP}/lender-matches`)
      .set('Idempotency-Key', 'lmr-unit-03')
      .send({});
    expect(res.status).toBe(503);
    expect(code(res)).toBe('DEPENDENCY_UNAVAILABLE');
  });
});

describe('P1-04 EMI calculator', () => {
  it('TEST-LMR-005 the spec example: ₹10,00,000 at 12 % over 60 months is ₹22,244.45 a month', async () => {
    const res = await emi(SPEC);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emi: { amount: '22244.45', currency: 'INR' },
      totalPayable: { amount: '1334667.00', currency: 'INR' },
      totalInterest: { amount: '334667.00', currency: 'INR' },
    });
  });

  it('TEST-LMR-006 a zero rate divides the principal evenly, rounded up to the paisa', async () => {
    const res = await emi({
      ...SPEC,
      principal: { amount: '100000.00', currency: 'INR' },
      annualRateBps: 0,
      tenureMonths: 3,
    });
    expect(res.body.emi).toEqual({ amount: '33333.34', currency: 'INR' });
  });

  it('TEST-LMR-007 lender_policy.read is enough; neither code is 403', async () => {
    expect((await emi(SPEC, ['lender_policy.read'])).status).toBe(200);
    expect((await emi(SPEC, ['application.read'])).status).toBe(403);
  });

  it('TEST-LMR-008 bad input is 422: not INR, rate above 100 %, tenure out of range, unknown field', async () => {
    for (const body of [
      { ...SPEC, principal: { amount: '1.00', currency: 'USD' } },
      { ...SPEC, annualRateBps: 10_001 },
      { ...SPEC, tenureMonths: 481 },
      { ...SPEC, tenantId: 'ten_x' },
    ]) {
      const res = await emi(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
  });
});
