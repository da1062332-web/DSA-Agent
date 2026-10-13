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
      .send({ status: 'SUSPENDED' });
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
});
