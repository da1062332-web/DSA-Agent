// TEST-SEC-001 cases for origination/catalogue (owner: Dev 3) — MOD-LND Lenders (Module 14).
// Tenant B holds every admin permission and still must not see or change tenant A's lenders, empanelments or contacts.
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

describe('TEST-SEC-001 catalogue (lenders): tenants never cross', () => {
  it('API-LND-001 API-LND-002 API-LND-002-GET: creates and reads stay in the caller tenant', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const created = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-create-01')
      .send({ name: 'Tenant A Lender', lenderType: 'BANK' });
    expect(created.status).toBe(201);

    // The same natural key is free in tenant B: it is a different lender, not a collision.
    const sameNameInB = await request(b)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-create-02')
      .send({ name: 'Tenant A Lender', lenderType: 'BANK' });
    expect(sameNameInB.status).toBe(201);
    expect(sameNameInB.body.id).not.toBe(created.body.id);

    expect((await request(b).get(`/v1/lenders/${created.body.id}`)).status).toBe(404);
    const list = await request(b).get('/v1/lenders');
    expect(list.body.data.map((l: { id: string }) => l.id)).not.toContain(created.body.id);
  });

  it('API-LND-003: tenant B cannot change tenant A lender, even with the right version', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const created = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-patch-01')
      .send({ name: 'Protected Lender', lenderType: 'NBFC' });
    const res = await request(b)
      .patch(`/v1/lenders/${created.body.id}`)
      .set('If-Match', created.headers.etag)
      .send({ status: 'TERMINATED', statusReason: 'hostile change' });
    expect(res.status).toBe(404);
    const after = await request(a).get(`/v1/lenders/${created.body.id}`);
    expect(after.body.status).toBe('ACTIVE');
  });

  it('API-LND-004 API-LND-005: tenant B cannot add or change empanelments on tenant A lenders', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-emp-lender')
      .send({ name: 'Empanelled A Lender', lenderType: 'NBFC' });
    const addToA = await request(b)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', 'iso-lnd-emp-add')
      .send({ dsaCode: 'HIJACK', validFrom: '2026-01-01', permittedCategories: ['PL'] });
    expect(addToA.status).toBe(404);

    const emp = await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', 'iso-lnd-emp-own')
      .send({ dsaCode: 'OWN-1', validFrom: '2026-01-01', permittedCategories: ['PL'] });
    const patchFromB = await request(b)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', emp.headers.etag)
      .send({ status: 'SUSPENDED', reason: 'hostile change' });
    expect(patchFromB.status).toBe(404);
  });

  it('API-LND-006 API-LND-006-GET: tenant B cannot read or replace tenant A lender contacts', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-con-lender')
      .send({ name: 'Contact Owner Lender', lenderType: 'NBFC' });
    const id = lender.body.id as string;
    await request(a)
      .put(`/v1/lenders/${id}/contacts`)
      .set('If-Match', lender.headers.etag)
      .send({ contacts: [{ name: 'A Person', escalationLevel: 1 }] });

    expect((await request(b).get(`/v1/lenders/${id}/contacts`)).status).toBe(404);
    const replaced = await request(b)
      .put(`/v1/lenders/${id}/contacts`)
      .set('If-Match', '"1"')
      .send({ contacts: [] });
    expect(replaced.status).toBe(404);
    const still = await request(a).get(`/v1/lenders/${id}/contacts`);
    expect(still.body.data.map((c: { name: string }) => c.name)).toEqual(['A Person']);
  });

  it('API-LND-004-LIST: tenant B cannot list tenant A empanelments', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-emp-list-lender')
      .send({ name: 'Listed A Lender', lenderType: 'NBFC' });
    await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', 'iso-lnd-emp-list-own')
      .send({ dsaCode: 'LIST-1', validFrom: '2026-01-01', permittedCategories: ['PL'] });

    expect((await request(b).get(`/v1/lenders/${lender.body.id}/empanelments`)).status).toBe(404);
    const own = await request(a).get(`/v1/lenders/${lender.body.id}/empanelments`);
    expect(own.body.data).toHaveLength(1);
  });

  it('API-LND-006-DEL: tenant B cannot remove tenant A lender contacts', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-lnd-del-lender')
      .send({ name: 'Removal Owner Lender', lenderType: 'NBFC' });
    const put = await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', lender.headers.etag as string)
      .send({ contacts: [{ name: 'Protected Person', escalationLevel: 1 }] });
    const contactId = put.body.data[0].id as string;

    const res = await request(b)
      .delete(`/v1/lenders/${lender.body.id}/contacts/${contactId}`)
      .set('If-Match', put.headers.etag as string);
    expect(res.status).toBe(404);
    const still = await request(a).get(`/v1/lenders/${lender.body.id}/contacts`);
    expect(still.body.data.map((c: { name: string }) => c.name)).toEqual(['Protected Person']);
  });

  it('API-PRD-001 API-PRD-002 API-PRD-002-GET: tenant B cannot create a product under a tenant A lender, nor read tenant A products', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-prd-lender')
      .send({ name: 'Product Owner Lender', lenderType: 'NBFC' });
    const product = await request(a)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-own')
      .send({
        lenderId: lender.body.id,
        name: 'Own A Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });
    expect(product.status).toBe(201);

    const hijack = await request(b)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-hijack')
      .send({
        lenderId: lender.body.id,
        name: 'Hijacked Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });
    expect(hijack.status).toBe(404);

    expect((await request(b).get(`/v1/products/${product.body.id}`)).status).toBe(404);
    const list = await request(b).get('/v1/products');
    expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(product.body.id);
  });

  it('API-PRD-005: tenant B cannot change the status of a tenant A product, even with the right version', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-prd-status-lender')
      .send({ name: 'Status Owner Lender', lenderType: 'NBFC' });
    const product = await request(a)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-status-own')
      .send({
        lenderId: lender.body.id,
        name: 'Status A Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });
    const res = await request(b)
      .post(`/v1/products/${product.body.id}/status`)
      .set('If-Match', product.headers.etag as string)
      .send({ status: 'INACTIVE', reason: 'hostile change' });
    expect(res.status).toBe(404);
    const after = await request(a).get(`/v1/products/${product.body.id}`);
    expect(after.body.status).toBe('ACTIVE');
  });

  it('API-PRD-003 API-PRD-003-LIST API-PRD-004: tenant B cannot add, list or read tenant A product versions', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const b = env.appAs(env.B, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'iso-prd-ver-lender')
      .send({ name: 'Version Owner Lender', lenderType: 'NBFC' });
    const product = await request(a)
      .post('/v1/products')
      .set('Idempotency-Key', 'iso-prd-ver-own')
      .send({
        lenderId: lender.body.id,
        name: 'Version A Product',
        category: 'PL',
        applicantTypes: ['SALARIED'],
        secured: false,
      });
    const terms = {
      amountMin: '100000.00',
      amountMax: '500000.00',
      tenureMinMonths: 12,
      tenureMaxMonths: 36,
      effectiveFrom: '2020-01-01T00:00:00Z',
    };
    const own = await request(a)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', 'iso-prd-ver-own-v1')
      .send(terms);
    expect(own.status).toBe(201);

    const add = await request(b)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', 'iso-prd-ver-hijack')
      .send({ ...terms, amountMax: '9999999.00' });
    expect(add.status).toBe(404);
    expect((await request(b).get(`/v1/products/${product.body.id}/versions`)).status).toBe(404);
    expect((await request(b).get(`/v1/product-versions/${own.body.id}`)).status).toBe(404);

    const still = await request(a).get(`/v1/products/${product.body.id}/versions`);
    expect(still.body.data).toHaveLength(1);
  });
});
