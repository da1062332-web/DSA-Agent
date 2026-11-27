// TEST-SEC-001 cases for the P1-04 lender policy grid (owner: Dipanshu). Tenant B holds every lender policy permission and still must
// not see, edit, activate or retire tenant A's policies, nor attach a policy to tenant A's lender. Every refusal is 404.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, versionOf, type IsolationEnv } from '../harness';

const ALL_POLICY: PermissionCode[] = ['lender_policy.read', 'lender_policy.manage', 'rule.approve'];

let env: IsolationEnv;
let lenderId: string;
let productVersionId: string;
let policyId: string;
let policyTag: string;

beforeAll(async () => {
  env = await startIsolationEnv();
  const admin = env.appAs(env.A, ALL_ADMIN);
  const lender = await request(admin)
    .post('/v1/lenders')
    .set('Idempotency-Key', 'iso-lpo-lender-01')
    .send({ name: 'Policy Isolation Lender', lenderType: 'NBFC' });
  const product = await request(admin)
    .post('/v1/products')
    .set('Idempotency-Key', 'iso-lpo-product-01')
    .send({
      lenderId: lender.body.id,
      name: 'Iso PL',
      category: 'PL',
      applicantTypes: ['SALARIED'],
      secured: false,
    });
  const version = await request(admin)
    .post(`/v1/products/${product.body.id}/versions`)
    .set('Idempotency-Key', 'iso-lpo-version-01')
    .send({ amountMin: '50000.00', amountMax: '1000000.00', tenureMinMonths: 12, tenureMaxMonths: 60 });
  lenderId = lender.body.id;
  productVersionId = version.body.id;
  const policy = await request(env.appAs(env.A, ALL_POLICY))
    .post('/v1/lender-policies')
    .set('Idempotency-Key', 'iso-lpo-policy-01')
    .send({
      lenderId,
      productVersionId,
      rateMinBps: 1000,
      rateMaxBps: 1200,
      effectiveFrom: '2026-01-01T00:00:00Z',
    });
  policyId = policy.body.id;
  policyTag = policy.headers.etag as string;
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 lender policies: tenants never cross', () => {
  it('P1-04: tenant B cannot read tenant A policies, by id or in its list', async () => {
    const b = env.appAs(env.B, ALL_POLICY);
    expect((await request(b).get(`/v1/lender-policies/${policyId}`)).status).toBe(404);
    const list = await request(b).get(`/v1/lender-policies?lenderId=${lenderId}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  it('P1-04: tenant B cannot edit, activate or retire tenant A policies, even with the right ETag', async () => {
    const b = env.appAs(env.B, ALL_POLICY, 1);
    const patch = await request(b)
      .patch(`/v1/lender-policies/${policyId}`)
      .set('If-Match', policyTag)
      .send({ foirCapBps: 9000 });
    expect(patch.status).toBe(404);
    for (const action of ['ACTIVATE', 'RETIRE']) {
      const res = await request(b)
        .post(`/v1/lender-policies/${policyId}/transitions`)
        .set('If-Match', policyTag)
        .send({ action });
      expect(res.status, action).toBe(404);
    }
    expect(await versionOf(env.admin, 'lender_policy', policyId)).toBe(0);
    const a = await request(env.appAs(env.A, ALL_POLICY)).get(`/v1/lender-policies/${policyId}`);
    expect(a.body).toMatchObject({ status: 'DRAFT', foirCapBps: null });
  });

  it('P1-04: tenant B cannot attach a policy to tenant A lender or product version', async () => {
    const b = env.appAs(env.B, ALL_POLICY);
    const res = await request(b)
      .post('/v1/lender-policies')
      .set('Idempotency-Key', 'iso-lpo-hostile-01')
      .send({
        lenderId,
        productVersionId,
        rateMinBps: 1000,
        rateMaxBps: 1200,
        effectiveFrom: '2026-01-01T00:00:00Z',
      });
    expect(res.status).toBe(404);
    const rows = await env.admin.query(
      `select count(*)::int as n from app.lender_policy where tenant_id = $1`,
      [env.B.tenantId],
    );
    expect(rows.rows[0].n).toBe(0);
  });
});
