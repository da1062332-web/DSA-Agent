// MOD-PRD Products against a real database (owner: Dev 3). Each run gets a throwaway PostgreSQL 16 container with
// every migration applied, connected as dsa_api, so row-level security and the terms guard apply as in production.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const key = (n: string) => `prd-int-${n}-000001`;
const etag = (res: request.Response) => res.headers.etag as string;

async function makeLender(name: string, n: string) {
  const a = env.appAs(env.A, ALL_ADMIN);
  const res = await request(a)
    .post('/v1/lenders')
    .set('Idempotency-Key', key(`lender-${n}`))
    .send({ name, lenderType: 'NBFC' });
  return res.body as { id: string; version: number };
}

async function makeProduct(lenderId: string, name: string, n: string) {
  const a = env.appAs(env.A, ALL_ADMIN);
  return request(a)
    .post('/v1/products')
    .set('Idempotency-Key', key(`product-${n}`))
    .send({ lenderId, name, category: 'PL', applicantTypes: ['SALARIED'], secured: false });
}

const version = (overrides: Record<string, unknown>) => ({
  amountMin: '100000.00',
  amountMax: '2500000.00',
  currency: 'INR',
  tenureMinMonths: 12,
  tenureMaxMonths: 60,
  illustrativeRateText: 'Illustrative, not an offer',
  ...overrides,
});

describe('TEST-PRD-INT products and versions against the database', () => {
  it('TEST-PRD-INT-01 creates a product under a lender; the same Idempotency-Key replays the original', async () => {
    const lender = await makeLender('Product Lender One', 'one');
    const a = env.appAs(env.A, ALL_ADMIN);
    const body = {
      lenderId: lender.id,
      name: 'Personal Loan Basic',
      category: 'PL',
      applicantTypes: ['SALARIED'],
      secured: false,
    };
    const first = await request(a).post('/v1/products').set('Idempotency-Key', key('replay')).send(body);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('ACTIVE');
    expect(first.body.version).toBe(0);
    expect(etag(first)).toBe('"0"');

    const again = await request(a).post('/v1/products').set('Idempotency-Key', key('replay')).send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
  });

  it('TEST-PRD-INT-02 a duplicate product name under the same lender is 409; the same name under another lender is fine', async () => {
    const one = await makeLender('Product Lender Two', 'two');
    const other = await makeLender('Product Lender Three', 'three');
    expect((await makeProduct(one.id, 'Dup Product', 'dup-1')).status).toBe(201);
    expect((await makeProduct(one.id, 'Dup Product', 'dup-2')).status).toBe(409);
    expect((await makeProduct(other.id, 'Dup Product', 'dup-3')).status).toBe(201);
  });

  it('TEST-PRD-INT-03 a product under a terminated lender is refused with 409 INVALID_STATE', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await makeLender('Terminated Lender', 'term');
    const ended = await request(a)
      .patch(`/v1/lenders/${lender.id}`)
      .set('If-Match', `"${lender.version}"`)
      .send({ status: 'TERMINATED', statusReason: 'Exit agreed' });
    expect(ended.status).toBe(200);
    const res = await makeProduct(lender.id, 'Too Late Product', 'term');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('TEST-PRD-INT-04 the first version is number 1 and in force; a later past-dated version retires it; a future one does not', async () => {
    const lender = await makeLender('Versioned Lender', 'ver');
    const product = await makeProduct(lender.id, 'Versioned Product', 'ver');
    const a = env.appAs(env.A, ALL_ADMIN);
    const url = `/v1/products/${product.body.id}/versions`;

    const v1 = await request(a)
      .post(url)
      .set('Idempotency-Key', key('v1'))
      .send(version({ effectiveFrom: '2020-01-01T00:00:00Z' }));
    expect(v1.status).toBe(201);
    expect(v1.body.versionNo).toBe(1);
    expect(v1.body.isCurrent).toBe(true);

    const v2 = await request(a)
      .post(url)
      .set('Idempotency-Key', key('v2'))
      .send(version({ effectiveFrom: '2021-01-01T00:00:00Z', amountMax: '3000000.00' }));
    expect(v2.status).toBe(201);
    expect(v2.body.versionNo).toBe(2);
    expect(v2.body.isCurrent).toBe(true);

    const v3 = await request(a)
      .post(url)
      .set('Idempotency-Key', key('v3'))
      .send(version({ effectiveFrom: '2099-01-01T00:00:00Z' }));
    expect(v3.status).toBe(201);
    expect(v3.body.versionNo).toBe(3);
    expect(v3.body.isCurrent).toBe(false);

    const list = await request(a).get(url);
    expect(list.body.data.map((v: { versionNo: number }) => v.versionNo)).toEqual([3, 2, 1]);
    const byNo = Object.fromEntries(
      list.body.data.map((v: { versionNo: number; status: string; isCurrent: boolean }) => [v.versionNo, v]),
    );
    expect(byNo[1].status).toBe('RETIRED');
    expect(byNo[2].status).toBe('ACTIVE'); // a future version does not retire the one in force
    expect(byNo[2].isCurrent).toBe(true);
    expect(byNo[3].status).toBe('ACTIVE');
    expect(byNo[3].isCurrent).toBe(false);
  });

  it('TEST-PRD-INT-05 a version must take effect after the latest one (422 NOT_AFTER_LATEST)', async () => {
    const lender = await makeLender('Ordering Lender', 'ord');
    const product = await makeProduct(lender.id, 'Ordering Product', 'ord');
    const a = env.appAs(env.A, ALL_ADMIN);
    const url = `/v1/products/${product.body.id}/versions`;
    await request(a)
      .post(url)
      .set('Idempotency-Key', key('ord-1'))
      .send(version({ effectiveFrom: '2099-01-01T00:00:00Z' }));

    const earlier = await request(a)
      .post(url)
      .set('Idempotency-Key', key('ord-2'))
      .send(version({ effectiveFrom: '2098-01-01T00:00:00Z' }));
    expect(earlier.status).toBe(422);
    expect(earlier.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TEST-PRD-INT-06 a version cannot be read or changed through SQL: terms are immutable (42501); status may change', async () => {
    const lender = await makeLender('Guarded Lender', 'guard');
    const product = await makeProduct(lender.id, 'Guarded Product', 'guard');
    const a = env.appAs(env.A, ALL_ADMIN);
    const created = await request(a)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', key('guard-v1'))
      .send(version({ effectiveFrom: '2020-01-01T00:00:00Z' }));
    const id = created.body.id as string;

    await expect(
      env.admin.query(`update app.loan_product_version set amount_max = 1 where id = $1`, [id]),
    ).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      env.admin.query(`update app.loan_product_version set status = 'RETIRED' where id = $1`, [id]),
    ).resolves.toMatchObject({ rowCount: 1 });
  });

  it('TEST-PRD-INT-07 deactivate needs a reason and a current If-Match; reactivation is audited; an inactive product takes no new version', async () => {
    const lender = await makeLender('Status Lender', 'status');
    const product = await makeProduct(lender.id, 'Status Product', 'status');
    const a = env.appAs(env.A, ALL_ADMIN);
    const url = `/v1/products/${product.body.id}/status`;

    const noReason = await request(a).post(url).set('If-Match', etag(product)).send({ status: 'INACTIVE' });
    expect(noReason.status).toBe(422);

    const stale = await request(a)
      .post(url)
      .set('If-Match', '"7"')
      .send({ status: 'INACTIVE', reason: 'Policy review' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const off = await request(a)
      .post(url)
      .set('If-Match', etag(product))
      .send({ status: 'INACTIVE', reason: 'Policy review' });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('INACTIVE');
    expect(off.body.version).toBe(1);

    const versionWhileOff = await request(a)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', key('status-v1'))
      .send(version({ effectiveFrom: '2020-01-01T00:00:00Z' }));
    expect(versionWhileOff.status).toBe(409);
    expect(versionWhileOff.body.error.code).toBe('INVALID_STATE');

    const on = await request(a).post(url).set('If-Match', '"1"').send({ status: 'ACTIVE' });
    expect(on.status).toBe(200);

    const audit = await env.admin.query(
      `select action from app.audit_event where entity_id = $1 order by occurred_at`,
      [product.body.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'product.created',
      'product.deactivated',
      'product.activated',
    ]);
  });

  it('TEST-PRD-INT-08 writes need config.manage (403) and reads do not', async () => {
    const lender = await makeLender('Permission Lender', 'perm');
    const product = await makeProduct(lender.id, 'Permission Product', 'perm');
    const reader = env.appAs(env.A);
    const denied = await request(reader)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', key('perm-v1'))
      .send(version({ effectiveFrom: '2020-01-01T00:00:00Z' }));
    expect(denied.status).toBe(403);
    expect((await request(reader).get(`/v1/products/${product.body.id}`)).status).toBe(200);
    expect((await request(reader).get(`/v1/products/${product.body.id}/versions`)).status).toBe(200);
  });
});
