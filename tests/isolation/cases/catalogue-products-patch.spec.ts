// TEST-SEC-001 cases for API-PRD-006 (owner: Dev 3). Tenant B holds every admin permission and still must not see or edit
// tenant A's product basics, and must not assign its own users as owners on tenant A products.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
});
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 catalogue (products PATCH): tenants never cross', () => {
  it('API-PRD-006: tenant B cannot edit tenant A product basics, even with the right version', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-prd-patch-lender')
      .send({ name: 'Patch Isolation Lender', lenderType: 'NBFC' });
    const product = await request(a)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-patch-own')
      .send({
        lenderId: lender.body.id,
        name: 'A Basics Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });

    const hostile = await request(b)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', product.headers.etag as string)
      .send({ name: 'Hijacked Name', category: 'HL' });
    expect(hostile.status).toBe(404);

    const after = await request(a).get(`/v1/products/${product.body.id}`);
    expect(after.body.name).toBe('A Basics Product');
    expect(after.body.category).toBe('PL');
    expect(after.body.version).toBe(0);
  });

  it('API-PRD-006: tenant B cannot make its own user the owner of a tenant A product', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-prd-owner-lender')
      .send({ name: 'Owner Isolation Lender', lenderType: 'NBFC' });
    const product = await request(a)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-owner-own')
      .send({
        lenderId: lender.body.id,
        name: 'Owner A Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });

    const res = await request(b)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', product.headers.etag as string)
      .send({ ownerUserId: env.B.userIds[0] });
    expect(res.status).toBe(404);
  });
});
