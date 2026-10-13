// MOD-PRD Products, PATCH /v1/products/{id} (API-PRD-006), against a real database (owner: Dev 3). Versions must come
// out of an edit exactly as they went in.
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

const key = (n: string) => `prd-patch-${n}-000001`;
const etag = (res: request.Response) => res.headers.etag as string;

async function makeLender(name: string, n: string) {
  const a = env.appAs(env.A, ALL_ADMIN);
  const res = await request(a)
    .post('/v1/lenders')
    .set('Idempotency-Key', key(`lender-${n}`))
    .send({ name, lenderType: 'NBFC' });
  return res.body as { id: string };
}

async function makeProduct(lenderId: string, name: string, n: string) {
  const a = env.appAs(env.A, ALL_ADMIN);
  const res = await request(a)
    .post('/v1/products')
    .set('Idempotency-Key', key(`product-${n}`))
    .send({ lenderId, name, category: 'PL', applicantTypes: ['SALARIED'], secured: false });
  expect(res.status).toBe(201);
  return res;
}

describe('TEST-PRD-PATCH-INT products PATCH against the database', () => {
  it('TEST-PRD-PATCH-INT-01 edits name, category, applicant types and secured; version and audit move on', async () => {
    const lender = await makeLender('Patch Lender One', 'one');
    const product = await makeProduct(lender.id, 'Original Name', 'one');
    const a = env.appAs(env.A, ALL_ADMIN);

    const res = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({
        name: 'Renamed Product',
        category: 'BL',
        applicantTypes: ['SELF_EMPLOYED', 'PROPRIETORSHIP'],
        secured: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed Product');
    expect(res.body.category).toBe('BL');
    expect(res.body.applicantTypes).toEqual(['SELF_EMPLOYED', 'PROPRIETORSHIP']);
    expect(res.body.secured).toBe(true);
    expect(res.body.version).toBe(1);
    expect(etag(res)).toBe('"1"');

    const audit = await env.admin.query(
      `select action, before, after from app.audit_event where entity_id = $1 and action = 'product.updated'`,
      [product.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before).toMatchObject({ name: 'Original Name', category: 'PL', secured: false });
    expect(audit.rows[0].after).toMatchObject({ name: 'Renamed Product', category: 'BL', secured: true });
  });

  it('TEST-PRD-PATCH-INT-02 a stale If-Match is 409 and changes nothing', async () => {
    const lender = await makeLender('Patch Lender Two', 'two');
    const product = await makeProduct(lender.id, 'Stale Check Product', 'two');
    const a = env.appAs(env.A, ALL_ADMIN);
    const first = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ name: 'First Edit' });
    expect(first.status).toBe(200);

    const stale = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ name: 'Too Late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const now = await request(a).get(`/v1/products/${product.body.id}`);
    expect(now.body.name).toBe('First Edit');
  });

  it('TEST-PRD-PATCH-INT-03 a name already used under the same lender is 409 and nothing changes', async () => {
    const lender = await makeLender('Patch Lender Three', 'three');
    await makeProduct(lender.id, 'Taken Name', 'taken');
    const other = await makeProduct(lender.id, 'Free Name', 'free');
    const a = env.appAs(env.A, ALL_ADMIN);
    const res = await request(a)
      .patch(`/v1/products/${other.body.id}`)
      .set('If-Match', etag(other))
      .send({ name: 'Taken Name' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    const now = await request(a).get(`/v1/products/${other.body.id}`);
    expect(now.body.name).toBe('Free Name');
    expect(now.body.version).toBe(0);
  });

  it('TEST-PRD-PATCH-INT-04 an owner must be an active user; setting null clears it', async () => {
    const lender = await makeLender('Patch Lender Four', 'four');
    const product = await makeProduct(lender.id, 'Owner Product', 'owner');
    const a = env.appAs(env.A, ALL_ADMIN);

    const missing = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ ownerUserId: 'usr_01HZX0000000000000000000ZZ' });
    expect(missing.status).toBe(422);

    const owned = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ ownerUserId: env.A.userIds[0] });
    expect(owned.status).toBe(200);
    expect(owned.body.ownerUserId).toBe(env.A.userIds[0]);

    const cleared = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', '"1"')
      .send({ ownerUserId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.ownerUserId).toBeNull();
  });

  it('TEST-PRD-PATCH-INT-05 an edit leaves every version exactly as it was', async () => {
    const lender = await makeLender('Patch Lender Five', 'five');
    const product = await makeProduct(lender.id, 'Versioned Edit Product', 'versioned');
    const a = env.appAs(env.A, ALL_ADMIN);
    await request(a)
      .post(`/v1/products/${product.body.id}/versions`)
      .set('Idempotency-Key', key('versioned-v1'))
      .send({
        amountMin: '100000.00',
        amountMax: '500000.00',
        tenureMinMonths: 12,
        tenureMaxMonths: 36,
        feeText: 'Processing fee 1%',
        effectiveFrom: '2020-01-01T00:00:00Z',
      });
    const before = await request(a).get(`/v1/products/${product.body.id}/versions`);

    const edit = await request(a)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ name: 'Versioned Edit Product Renamed', category: 'MSME' });
    expect(edit.status).toBe(200);

    const after = await request(a).get(`/v1/products/${product.body.id}/versions`);
    expect(after.body).toEqual(before.body);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].isCurrent).toBe(true);
  });

  it('TEST-PRD-PATCH-INT-06 a product cannot be deleted: DELETE is 404 and the product stays', async () => {
    const lender = await makeLender('Patch Lender Six', 'six');
    const product = await makeProduct(lender.id, 'Undeletable Product', 'undeletable');
    const a = env.appAs(env.A, ALL_ADMIN);
    const res = await request(a).delete(`/v1/products/${product.body.id}`).set('If-Match', etag(product));
    expect(res.status).toBe(404);
    expect((await request(a).get(`/v1/products/${product.body.id}`)).status).toBe(200);
  });

  it('TEST-PRD-PATCH-INT-07 a reader without config.manage is refused (403)', async () => {
    const lender = await makeLender('Patch Lender Seven', 'seven');
    const product = await makeProduct(lender.id, 'Read Only Product', 'readonly');
    const reader = env.appAs(env.A);
    const res = await request(reader)
      .patch(`/v1/products/${product.body.id}`)
      .set('If-Match', etag(product))
      .send({ name: 'Nope Name' });
    expect(res.status).toBe(403);
  });
});
