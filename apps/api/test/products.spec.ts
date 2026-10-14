// MOD-PRD Products, unit level (owner: Dev 3; DSA Notion MODULE 15). Permissions, idempotency and input validation run
// before any database call, so these tests need no database. Database behaviour is in catalogue-products.int.spec.ts.
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
const IDEM = { 'Idempotency-Key': 'product-key-00001' };
const LENDER = 'lnd_01HZX0000000000000000000AA';
const PRODUCT = 'prd_01HZX0000000000000000000AA';

const product = {
  lenderId: LENDER,
  name: 'Personal Loan Salaried',
  category: 'PL',
  applicantTypes: ['SALARIED'],
  secured: false,
};
const version = {
  amountMin: '100000.00',
  amountMax: '2500000.00',
  currency: 'INR',
  tenureMinMonths: 12,
  tenureMaxMonths: 60,
  effectiveFrom: '2026-01-01T00:00:00Z',
};

describe('products: permissions (MOD-PRD, config.manage)', () => {
  it('TEST-PRD-001 every write is 403 without config.manage', async () => {
    const app = as('lead.read');
    const calls = [
      request(app).post('/v1/products').set(IDEM).send(product),
      request(app).post(`/v1/products/${PRODUCT}/status`).set('If-Match', '"0"').send({ status: 'ACTIVE' }),
      request(app).post(`/v1/products/${PRODUCT}/versions`).set(IDEM).send(version),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });
});

describe('products: idempotency and concurrency headers', () => {
  it('TEST-PRD-002 creates and version posts without an Idempotency-Key are 400 MALFORMED_REQUEST', async () => {
    const app = as('config.manage');
    const created = await request(app).post('/v1/products').send(product);
    expect(created.status).toBe(400);
    expect(code(created)).toBe('MALFORMED_REQUEST');

    const versioned = await request(app).post(`/v1/products/${PRODUCT}/versions`).send(version);
    expect(versioned.status).toBe(400);
    expect(code(versioned)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-PRD-003 a status change without If-Match is 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('config.manage'))
      .post(`/v1/products/${PRODUCT}/status`)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });
});

describe('products: input validation (422 VALIDATION_ERROR before any database call)', () => {
  const app = () => as('config.manage');

  it('TEST-PRD-004 product create rejects an unknown category, an empty applicant list and unknown fields', async () => {
    const bad = [
      { ...product, category: 'XX' },
      { ...product, applicantTypes: [] },
      { ...product, rate: '12%' },
      { ...product, name: 'A' },
    ];
    for (const body of bad) {
      const res = await request(app()).post('/v1/products').set(IDEM).send(body);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-PRD-005 a product name containing an identity or account number is rejected (S3 data)', async () => {
    const pan = await request(app())
      .post('/v1/products')
      .set(IDEM)
      .send({ ...product, name: 'Loan for ABCDE1234F' });
    expect(pan.status).toBe(422);
    const account = await request(app())
      .post('/v1/products')
      .set(IDEM)
      .send({ ...product, name: 'Account 123456789012' });
    expect(account.status).toBe(422);
  });

  it('TEST-PRD-006 deactivating a product needs a reason', async () => {
    const res = await request(app())
      .post(`/v1/products/${PRODUCT}/status`)
      .set('If-Match', '"0"')
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(422);
    expect(code(res)).toBe('VALIDATION_ERROR');
  });

  it('TEST-PRD-007 a version needs amounts as decimal strings and a maximum at or above the minimum', async () => {
    const badMoney = [
      { ...version, amountMin: 100000 },
      { ...version, amountMin: '1,00,000' },
      { ...version, amountMin: '100000.123' },
    ];
    for (const body of badMoney) {
      const res = await request(app()).post(`/v1/products/${PRODUCT}/versions`).set(IDEM).send(body);
      expect(res.status).toBe(422);
    }
    const inverted = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, amountMin: '500000.00', amountMax: '100000.00' });
    expect(inverted.status).toBe(422);
  });

  it('TEST-PRD-008 a version needs a tenure range that is ordered and within 1 to 600 months', async () => {
    const inverted = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, tenureMinMonths: 60, tenureMaxMonths: 12 });
    expect(inverted.status).toBe(422);
    const zero = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, tenureMinMonths: 0 });
    expect(zero.status).toBe(422);
  });

  it('TEST-PRD-009 a version cannot carry terms the schema does not define (strict)', async () => {
    const res = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, interestRate: '14%' });
    expect(res.status).toBe(422);
  });

  it('TEST-PRD-010 geo rules need a state and a boolean; the amount and fee text are length-limited', async () => {
    const badGeo = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, geoRules: [{ state: 'Karnataka' }] });
    expect(badGeo.status).toBe(422);
    const longFee = await request(app())
      .post(`/v1/products/${PRODUCT}/versions`)
      .set(IDEM)
      .send({ ...version, feeText: 'x'.repeat(501) });
    expect(longFee.status).toBe(422);
  });
});
