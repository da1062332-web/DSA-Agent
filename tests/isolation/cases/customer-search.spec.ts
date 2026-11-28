// TEST-SEC-001 cases for customer search (owner: Bhushan, customers lane; 2026-11-28). A tenant B principal with every customer
// permission searching by tenant A's customer name or mobile finds nothing. The full behaviour is in
// apps/api/test/customer-search.int.spec.ts.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const CODES: PermissionCode[] = ['customer.read', 'customer.create'];
let aId = '';

beforeAll(async () => {
  env = await startIsolationEnv();
  const res = await request(env.appAs(env.A, CODES))
    .post('/v1/customers')
    .set('Idempotency-Key', `iso-srch-${Math.random().toString(36).slice(2, 10)}`)
    .send({
      partyType: 'INDIVIDUAL',
      fullName: 'Isolation Searchable Person',
      homeBranchId: env.A.branchId,
      primaryMobile: '9876500077',
    });
  expect(res.status).toBe(201);
  aId = res.body.id;
});
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 customer search: tenants never cross', () => {
  it('CUST-POST-CUSTOMERS-SEARCH: tenant B finds no tenant A customer by name or by mobile', async () => {
    const own = await request(env.appAs(env.A, CODES))
      .post('/v1/customers/search')
      .send({ query: 'Searchable' });
    expect(own.body.data.map((c: { id: string }) => c.id)).toEqual([aId]);
    const b = env.appAs(env.B, [...ALL_ADMIN, ...CODES]);
    for (const query of ['Searchable', '9876500077']) {
      const res = await request(b).post('/v1/customers/search').send({ query });
      expect(res.status, query).toBe(200);
      expect(res.body.data, query).toEqual([]);
    }
  });
});
