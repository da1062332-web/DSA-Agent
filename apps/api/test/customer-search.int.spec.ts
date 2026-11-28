// TEST-CUST-SRCH-INT POST /v1/customers/search against a real database, with the production wiring (2026-11-28). Synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const CODES: PermissionCode[] = ['customer.read', 'customer.create'];
const key = () => `srch_${Math.random().toString(36).slice(2, 10)}`;
const ids: Record<string, string> = {};

async function create(tenant: IsolationEnv['A'], fullName: string, primaryMobile?: string) {
  const res = await request(env.appAs(tenant, CODES))
    .post('/v1/customers')
    .set('Idempotency-Key', key())
    .send({
      partyType: 'INDIVIDUAL',
      fullName,
      homeBranchId: tenant.branchId,
      ...(primaryMobile ? { primaryMobile } : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}
const search = (tenant: IsolationEnv['A'], body: Record<string, unknown>) =>
  request(env.appAs(tenant, CODES)).post('/v1/customers/search').send(body);
const names = (res: request.Response) => res.body.data.map((c: { fullName: string }) => c.fullName).sort();

beforeAll(async () => {
  env = await startIsolationEnv();
  ids.asha = await create(env.A, 'Asha Synthetic Kulkarni', '9876500011');
  ids.ashok = await create(env.A, 'Ashok Synthetic Patil', '9876500022');
  ids.meera = await create(env.A, 'Meera Synthetic Rao');
  ids.other = await create(env.B, 'Asha Synthetic OtherTenant', '9876500011');
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-CUST-SRCH-INT customer search', () => {
  it('TEST-CUST-SRCH-INT-01 part of a name matches anywhere in it, case-insensitively; results are masked', async () => {
    const res = await search(env.A, { query: 'ASH' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(names(res)).toEqual(['Asha Synthetic Kulkarni', 'Ashok Synthetic Patil']);
    const asha = res.body.data.find((c: { id: string }) => c.id === ids.asha);
    expect(asha.primaryMobileMasked).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('9876500011');
    expect(names(await search(env.A, { query: 'kulk' }))).toEqual(['Asha Synthetic Kulkarni']);
  });

  it('TEST-CUST-SRCH-INT-02 a mobile matches exactly in any common form; a different mobile matches nobody', async () => {
    for (const query of ['9876500011', '+91 98765 00011', '09876500011', '919876500011']) {
      const res = await search(env.A, { query });
      expect(res.status, query).toBe(200);
      expect(
        res.body.data.map((c: { id: string }) => c.id),
        query,
      ).toEqual([ids.asha]);
    }
    expect((await search(env.A, { query: '9876500099' })).body.data).toEqual([]);
  });

  it('TEST-CUST-SRCH-INT-03 people already on the file can be left out', async () => {
    const res = await search(env.A, { query: 'synthetic', excludeIds: [ids.asha, ids.meera] });
    expect(names(res)).toEqual(['Ashok Synthetic Patil']);
  });

  it('TEST-CUST-SRCH-INT-04 a long number that is not a mobile (PAN-, Aadhaar- or account-like) is refused, never searched', async () => {
    for (const query of ['123412341234', 'ABCDE1234F', 'acct 12345678901']) {
      const res = await search(env.A, { query });
      expect(res.status, query).toBe(422);
    }
  });

  it('TEST-CUST-SRCH-INT-05 a % or _ in the term is matched literally, not as a wildcard', async () => {
    expect((await search(env.A, { query: '%%' })).body.data).toEqual([]);
    expect((await search(env.A, { query: '__' })).body.data).toEqual([]);
  });

  it('TEST-CUST-SRCH-INT-06 another tenant’s customer is never found, by name or by the same mobile', async () => {
    expect(names(await search(env.A, { query: 'OtherTenant' }))).toEqual([]);
    const b = await search(env.B, { query: '9876500011' });
    expect(b.body.data.map((c: { id: string }) => c.id)).toEqual([ids.other]);
  });
});
